# Gemini BYOK Provider Handoff

Updated: 2026-07-27
Repository: `Three-Wheeled-Sloth-Studio/Review-Room`
Working branch: `chore/update-project-ownership-and-gitignore`
Related pull request: #1

## Purpose

Add an optional remote Gemini provider to Review Author while preserving Ollama as the local provider. Gemini access is strictly bring-your-own-key (BYOK). This project will not operate a hosted generation service and will never ship or manage a studio-owned Gemini key.

This document is the primary handoff for the next implementation machine.

## Current application shape

Review Author is a plain JavaScript Chrome Manifest V3 extension.

- `popup.js` collects reviewer notes and product context, selects the current Ollama model, and creates a persisted review session.
- `review.js` owns the full-tab review workspace, initial generation, regeneration, follow-up questions, copy actions, and session persistence.
- `review-core.js` currently combines provider-neutral prompt and cleanup logic with Ollama-specific HTTP and stream handling.
- `manifest.json` currently grants host access only to local Ollama endpoints.
- Review sessions currently store a model name but do not store a provider identifier.

The provider boundary should be introduced around the existing generation functions rather than rewriting the review workflow.

## Locked decisions

### Provider scope

- Ollama remains supported as the local provider.
- Gemini is the initial remote provider.
- Gemini access is BYOK only.
- There will be no studio-owned Gemini key.
- There will be no hosted proxy, studio generation API, account system, quota service, or billing layer.
- The architecture may support additional BYOK providers later, but no provider beyond Gemini is in the current increment.

### Credential handling

- The Gemini key must never be committed to the public repository.
- The Gemini key must never be bundled into extension JavaScript through a build-time `.env` substitution.
- The key must never be stored in `chrome.storage.sync`.
- The key must never be copied into review sessions, review history, iteration records, logs, error messages, or exported data.
- Default behavior: store the key in `chrome.storage.session`, requiring re-entry after Chrome restarts.
- Optional user preference: `Remember this key on this device`, stored in `chrome.storage.local` with a clear warning that extension storage is not an encrypted password vault.
- Restrict local storage access to trusted extension contexts where supported.
- Provide an explicit `Clear Key` action.

### Settings access

Add a proper extension options page through `options_ui` in `manifest.json`.

Users must be able to open settings from the product UI through `chrome.runtime.openOptionsPage()`.

Required entry points:

1. A compact settings control in the popup header.
2. A `Configure Gemini` action shown when Gemini is selected but no key is available.
3. A provider settings action near the provider and model controls.

Do not wait for a generation request to fail before explaining that Gemini is not configured.

### Remote data disclosure

When Gemini is selected, the UI must clearly state that the following content will be sent to Gemini:

- Reviewer notes.
- Scraped product title.
- Scraped product description or feature bullets.
- Previous generated draft when regenerating.
- User feedback, missing topics, and follow-up answers when supplied.

Do not send Amazon cookies, account data, purchase history, full page HTML, unrelated page text, source tab IDs, or source URLs.

### Generation behavior

The first Gemini implementation will use a complete non-streaming response.

Incremental text streaming is not required. User confidence during the wait is required.

### Blocking wait state

Generation and regeneration are blocking operations for the review workspace.

Required first implementation, referred to as Option A:

- Cover the affected workspace with a visually dominant operation layer.
- Lock editable fields and conflicting controls.
- Prevent duplicate requests.
- Show `Generating Review` as the dominant message.
- Show the active provider and model as secondary context.
- Display a large animated indeterminate progress bar.
- Set `aria-busy="true"` on the affected workspace.
- Keep the operation layer visible until the response is accepted or the request fails.
- On failure, unlock the workspace, preserve the previous usable state, and show a clear retry path.
- Do not use a passive status line or changed button label as the only wait feedback.
- Do not fabricate percentage completion.

Honest status messages may change as the workflow advances:

1. `Preparing review context...`
2. `Sending request to Gemini...`
3. `Generating review...`
4. `Validating response...`
5. `Formatting review...`

Most elapsed time will probably remain on `Generating review...`. That is fine. The UI should report reality, not produce motivational fiction.

Nice-to-have follow-up, referred to as Option B:

- Evolve the operation layer toward a Domino's Pizza Tracker-style stage display.
- Show a small number of named stages with completed, active, and pending states.
- Keep the progress model stage-based rather than percentage-based unless the provider eventually exposes meaningful measurable progress.
- Do not block the initial Gemini release on this enhancement.

Suggested stages:

1. Preparing context
2. Contacting Gemini
3. Generating review
4. Validating response
5. Formatting review

### Structured output and cleanup

- Continue using the existing review result fields: `suggestedStars`, `generatedReview`, and `title`.
- Use Gemini structured JSON output with an explicit schema when supported by the selected API surface.
- Use a separate structured schema for follow-up questions.
- Keep deterministic validation and cleanup after the provider response.
- Continue stripping markdown and normalizing punctuation to plain US-keyboard ASCII.
- User reviewer notes remain the primary source of truth.
- Product page text remains factual context and must not turn the review into product-listing copy.

### Model selection

- Maintain a small application allowlist of appropriate Gemini text models.
- Use an explicit stable model identifier rather than a moving `latest` alias.
- Confirm the current stable Gemini model choices during implementation because provider model catalogs change.
- Store provider and model in each review session, but never store credentials there.

## Proposed file changes

### New files

```text
settings.html
settings.js
service-worker.js
providers/provider-registry.js
providers/provider-errors.js
providers/ollama-provider.js
providers/gemini-provider.js
providers/provider-schemas.js
```

A flatter file layout is acceptable if loading subdirectory scripts directly in the extension becomes awkward. Preserve the separation of responsibilities even if the physical structure is adjusted.

### Existing files

`manifest.json`

- Add the extension service worker.
- Add `options_ui` for the settings page.
- Add Gemini API host permission.
- Preserve local Ollama host permissions.

`popup.html` and `popup.js`

- Replace the Ollama-only model control with provider and provider-specific model controls.
- Add settings access.
- Add the missing-key `Configure Gemini` route.
- Persist non-secret provider preferences.
- Save provider and model into new sessions.

`review.html`, `review.js`, and `styles.css`

- Add provider and model context.
- Add the blocking generation operation layer.
- Lock controls during initial generation, regeneration, and follow-up generation as appropriate.
- Restore the last usable state on failure.

`review-core.js`

- Keep prompt construction, parsing, cleanup, copy helpers, and provider-neutral result validation.
- Remove direct Ollama networking and stream parsing from the provider-neutral path.

`refs/project.yaml`

- Ownership and repository URL have already been corrected on the working branch.

`.gitignore`

- Local secrets, private config, generated output, logs, and common local artifacts have already been added on the working branch.

## Provider interface

The exact syntax can change, but the boundary should support these responsibilities:

```javascript
provider.generateReview(request)
provider.generateFollowUpQuestions(request)
provider.validateConfiguration()
provider.getAvailableModels()
```

The provider registry should resolve the selected implementation from the session provider field.

Normalized request data should include only provider-neutral content:

```javascript
{
  provider,
  model,
  comments,
  guidance,
  productInfo,
  previousDraft,
  feedback,
  missingTopics,
  followUpAnswers
}
```

Provider credentials should be resolved by the trusted extension runtime and never added to that object when it is persisted.

## Session migration

Existing sessions lack a provider field.

During session normalization:

```javascript
if (!session.provider) {
  session.provider = 'ollama';
}
```

New sessions should store:

```javascript
{
  provider: 'ollama' | 'gemini',
  model: '<provider model id>',
  providerConfigVersion: 1
}
```

The migration must preserve existing Ollama sessions without requiring user intervention.

## Error handling

Normalize provider errors before presenting them to the UI.

Suggested codes:

```text
MISSING_CREDENTIALS
INVALID_CREDENTIALS
MODEL_UNAVAILABLE
RATE_LIMITED
PROVIDER_OVERLOADED
NETWORK_ERROR
SAFETY_BLOCKED
INVALID_RESPONSE
REQUEST_TOO_LARGE
UNKNOWN_PROVIDER_ERROR
```

Retry only transient failures such as rate limiting, provider overload, temporary server failures, and network interruption. Do not retry invalid credentials, invalid configuration, or safety blocks.

Errors must not echo the API key or complete provider response headers.

## Testing plan

Introduce automated tests around provider-neutral logic and mocked provider requests. Node's built-in test runner is sufficient unless the implementation creates a stronger need for another framework.

Required coverage:

- Provider registry selection.
- Legacy session migration to Ollama.
- Gemini request serialization.
- Gemini structured response parsing.
- Follow-up question parsing.
- Missing and invalid key behavior.
- Secret redaction from errors and persisted objects.
- Ollama regression coverage.
- Review cleanup and ASCII punctuation normalization.
- Blocking state enters before generation and exits on success.
- Blocking state exits on failure while preserving the previous usable draft.
- Duplicate generation requests are prevented.
- Settings page opens from each intended UI entry point.

Manual smoke testing must cover:

- Ollama initial generation, regeneration, and follow-up questions.
- Gemini initial generation, regeneration, and follow-up questions.
- Session-only key behavior across browser restart.
- Remembered local key behavior.
- Key clearing.
- Missing-key settings route.
- Obvious locked wait state during slow generation.
- Failure recovery.

Live Gemini integration tests must be opt-in and must never require a real key in normal pull-request CI.

## Implementation sequence

### Increment 1: Provider boundary without behavior change

- Extract Ollama transport from `review-core.js`.
- Add provider registry and normalized errors.
- Add provider fields to sessions.
- Migrate existing sessions to Ollama.
- Confirm all existing Ollama workflows still work.

### Increment 2: Settings and credential handling

- Add `options_ui` settings page.
- Add session-only Gemini key storage.
- Add optional remember-on-device behavior.
- Add validate and clear actions.
- Add popup routes to settings.
- Add remote-data disclosure.

### Increment 3: Gemini generation

- Add Gemini provider.
- Add structured review and follow-up schemas.
- Add provider/model selection.
- Support initial generation, regeneration, and follow-up questions.
- Add provider-aware error messages.

### Increment 4: Blocking operation UX

This may be implemented alongside Increment 3 if the changes remain reviewable.

- Add the full-workspace operation layer.
- Add the indeterminate progress bar.
- Add honest stage messages.
- Lock controls and block duplicate requests.
- Add accessible busy state and failure recovery.

### Increment 5: Tests and documentation

- Add automated provider and migration tests.
- Expand manual validation commands.
- Update README setup instructions.
- Document Gemini key creation without embedding any project-specific key.
- Document exactly what data is sent remotely.

### Nice-to-have increment: Stage tracker

- Replace or augment the indeterminate operation presentation with a Domino's Pizza Tracker-style stage display.
- Preserve honest stage semantics.
- Do not imply measurable percentage completion.

## Low-priority backlog: Existing review enrichment

The scraper may later sample a small number of existing reviews visible on the Amazon product page.

Purpose:

- Identify product-specific vocabulary.
- Identify commonly discussed strengths and complaints.
- Identify use cases and practical questions missing from the user's notes.

Guardrails:

- Existing reviews provide topic context only.
- Do not copy wording.
- Do not treat another reviewer's experience as the user's experience.
- Do not add claims unless supported by the user's notes or direct product facts.
- Cap the number of reviews and total characters collected.
- Strip reviewer names and unnecessary metadata.
- Keep sampled review material separate from reviewer notes in the request shape.
- Update the remote-data disclosure before sending sampled review text to Gemini.

This is explicitly lower priority than provider abstraction, Gemini BYOK, settings, and the blocking generation state.

## Definition of done for the Gemini BYOK release

- Ollama remains fully functional.
- Gemini works using a user-supplied key.
- No studio-owned key or hosted service exists.
- The Gemini key is absent from the repository, build output, synchronized storage, review sessions, logs, and exports.
- Users can open provider settings directly from the popup and missing-key state.
- Initial review generation works through Gemini.
- Regeneration uses the previous draft and user feedback.
- Follow-up question generation works through Gemini.
- Provider and model are stored with each session.
- Gemini output uses a structured contract and deterministic cleanup.
- The review workspace is visibly locked during generation.
- `Generating Review` and the indeterminate progress bar are impossible to miss.
- Failure unlocks the workspace and preserves the previous usable state.
- Automated tests cover provider selection, migration, serialization, validation, secret handling, and wait-state behavior.
- README and project references explain local Ollama use, Gemini BYOK setup, and remote data handling.

## Next machine start here

1. Pull PR #1 or check out `chore/update-project-ownership-and-gitignore`.
2. Read this document.
3. Read `refs/project.yaml`, `refs/planning/roadmap.yaml`, `refs/planning/todos.yaml`, and `refs/testing/validationCommands.yaml`.
4. Read the shared TWS design principles, especially:
   - `apps/App-Design-Principles.md`
   - `apps/Studio-UI-Style-Guide.md`
   - `apps/Interaction-Behavior-Standards.md`
5. Begin with Increment 1. Do not begin by inserting Gemini fetch logic directly into `review-core.js`.
6. Keep the first implementation branch narrow enough to review. Provider abstraction and session migration should be verifiable before remote calls are layered on top.
