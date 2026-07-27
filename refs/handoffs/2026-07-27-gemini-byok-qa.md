# Gemini BYOK QA Pass

Updated: 2026-07-27
Repository: `Three-Wheeled-Sloth-Studio/Review-Room`
Pull request: #1

## QA status

Automated and manual QA are green. The Gemini BYOK increment is cleared for merge.

Validated in GitHub Actions:

- Node automated tests.
- JavaScript syntax checks for extension scripts.
- Manifest JSON parsing.

Validated manually in Chrome with a real Gemini authorization key:

- Provider selection and model selection.
- Gemini key validation and session-only storage.
- Remember-key-on-device behavior.
- Key clearing and missing-key recovery.
- Initial Gemini review generation.
- Gemini regeneration with feedback.
- Gemini follow-up question generation.
- Blocking `Generating Review` operation layer.
- Locked controls during generation.
- Completed title, stars, and review rendering.
- Failure recovery without losing the prior usable draft.
- Ollama initial generation and regeneration regression checks.

## Blocking findings corrected

### Stable API surface

Gemini calls originally targeted `v1beta`. They now use the stable endpoints:

- `https://generativelanguage.googleapis.com/v1/interactions`
- `https://generativelanguage.googleapis.com/v1/models`

### Stateless remote generation

The Interactions API stores requests by default. Review Author now sends:

```json
{
  "store": false
}
```

This prevents Review Author from creating server-side Interaction history for reviewer notes and generated reviews.

### Service-worker request lifetime

Chrome may terminate an extension service worker when a fetch response takes more than 30 seconds to arrive. Gemini generation now uses SSE streaming internally so response headers arrive promptly and the service worker receives ongoing stream activity.

The UI remains intentionally non-streaming:

- The workspace stays behind the blocking generation layer.
- Partial review text is not displayed.
- The completed structured JSON is parsed and shown only after generation finishes.

A lightweight extension API keepalive runs during the stream to reset Chrome's idle timer. The request remains subject to Chrome's five-minute single-operation limit, which is acceptable for this review workflow.

### Current Gemini authorization keys

Google AI Studio now creates authorization keys, commonly using the `AQ.` prefix, while older standard keys generally use `AIza`.

Provider error serialization now redacts both formats. Automated tests cover both patterns.

### Remote-data disclosure

The popup and Provider Settings now disclose that Gemini may receive:

- Reviewer notes.
- Scraped product title and description.
- Current draft during regeneration.
- Feedback, missing topics, and follow-up answers used for revision.

They also state that Review Author requests stateless generation and does not send Amazon account data, cookies, purchase history, source URLs, or page HTML.

## CI added

The repository now includes `.github/workflows/qa.yml`.

It runs on pull requests and on pushes to `master`, covering tests, syntax validation, and manifest parsing. Pull-request branches do not receive a duplicate push-triggered run.

## Release recommendation

PR #1 is ready to merge. After merge, pull `master` on the development machine and reload the unpacked extension from the merged checkout.

## Non-blocking follow-ups

- Domino's Pizza Tracker-style stage display remains a nice-to-have.
- Add reduced-motion styling for the progress animation.
- Improve modal focus management and restoration.
- Expand browser-level automated coverage when an extension test harness is introduced.
- Existing-review sampling remains low priority.
