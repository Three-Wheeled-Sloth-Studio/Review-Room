# Review Author

Review Author is a Chrome Manifest V3 extension that drafts Amazon product reviews from reviewer notes and basic product-page context. It supports local Ollama models and remote Gemini models using only a user-supplied Gemini API key.

## Current Status

The Gemini BYOK implementation is ready for Chrome smoke testing.

- The popup supports provider and provider-specific model selection.
- Ollama remains available through `http://localhost:11434`.
- Gemini uses the current Interactions API with structured JSON responses.
- Gemini credentials are stored in `chrome.storage.session` by default.
- Users may optionally remember a key in trusted local extension storage on the current device.
- Keys are never stored in synchronized settings, review sessions, iteration history, logs, or exported review text.
- Initial generation, regeneration, and follow-up questions use the selected provider.
- The review workspace locks during generation and shows a dominant indeterminate progress state.
- Existing review sessions without a provider field continue to open as Ollama sessions.
- Amazon scraping remains limited to product title and description or feature bullets.

## Files

- `manifest.json`: Chrome MV3 configuration, service worker, options page, permissions, icons, and host access.
- `popup.html` and `popup.js`: Provider and model selection, product scraping, guidance, session creation, and settings entry points.
- `settings.html` and `settings.js`: Gemini API key validation, session or remembered storage choice, model default, and key clearing.
- `service-worker.js`: Trusted provider runtime, credential access, provider routing, and error serialization.
- `ollama-provider.js`: Local Ollama model discovery and generation transport.
- `gemini-provider.js`: Gemini model allowlist, structured schemas, validation, generation, response extraction, and transient retry behavior.
- `provider-errors.js`: Normalized provider errors and secret-safe serialization.
- `review.html` and `review.js`: Durable review workspace, copy controls, feedback iteration, follow-up questions, session persistence, and blocking generation state.
- `review-core.js`: Provider-neutral prompts, messaging, parsing, cleanup, clipboard helpers, and error presentation.
- `styles.css`: Popup, workspace, settings, and blocking-operation styling.
- `tests/`: Node tests for structured parsing, secret boundaries, model allowlisting, response extraction, and cleanup.
- `refs/`: Durable planning, architecture, testing, and handoff notes.

## Requirements

- Google Chrome with extension developer mode.
- For Ollama: Ollama installed, running, and at least one model pulled.
- For Gemini: A Gemini API key created in Google AI Studio.

Example Ollama model:

```cmd
ollama pull qwen2.5:7b-instruct
```

## Load the Extension

1. Clone or pull the repository branch you want to test.
2. Open Chrome at:

```text
chrome://extensions
```

3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select the repository directory.
6. Open an Amazon product page.
7. Open Review Author and choose either `Local Ollama` or `Gemini`.

## Configure Gemini BYOK

1. Open the Review Author popup.
2. Click `Settings`, or select Gemini and click `Configure Gemini`.
3. Create or retrieve a Gemini API key from Google AI Studio.
4. Paste the key into Provider Settings.
5. Choose whether to remember it on the current device.
6. Click `Save and Validate`.
7. Return to the Amazon page, reopen the popup, select Gemini, and create the review.

Session-only keys are cleared when Chrome restarts. Remembered keys are stored in Chrome extension storage on the current device. Chrome extension storage is not an encrypted password vault.

Review Author does not use a studio-owned API key and does not call a Three-Wheeled Sloth Studio generation service.

## Remote Data Boundary

When Gemini is selected, Review Author may send:

- Reviewer notes.
- Scraped product title.
- Scraped product description or feature bullets.
- Previous generated draft during regeneration.
- User feedback, missing topics, and follow-up answers supplied for the request.

It does not send:

- Gemini credentials inside the review request object.
- Amazon cookies or account data.
- Purchase history.
- Full page HTML.
- Unrelated page content.
- Source tab IDs or URLs.

## Review Workspace

The popup opens a durable full-tab workspace with editable fields for:

- Suggested Stars.
- Generated Review.
- Title.

The workspace also provides copy actions, regeneration feedback, missing-topic input, and product-specific follow-up questions.

During generation, the workspace is locked behind a full-screen operation layer with:

- A dominant `Generating Review` message.
- Provider and model context.
- A large animated indeterminate progress bar.
- A clear operation message.

The workspace unlocks after success or failure. Failed regeneration preserves the prior usable draft.

## Ollama Origin Handling

Ollama must allow browser extension origins. Run:

```cmd
restart-ollama-for-extension.cmd
```

The helper sets:

```cmd
OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,safari-web-extension://*
```

If Windows denies process termination, quit Ollama from the tray or run the script as administrator.

## Guidance Behavior

The default guidance requests separate structured fields for suggested stars, review body, and title. Reviewer notes remain the primary source of truth. Product-page text is factual context only.

Generated text is deterministically cleaned to remove common LLM preambles, Markdown, and non-US-keyboard punctuation before display.

## Validation

Run:

```cmd
npm test
npm run check
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest json ok')"
```

Then complete the manual Chrome smoke path in `refs/testing/validationCommands.yaml`.

## Known Limitations

- A real Gemini key is required for live Gemini smoke testing and is never used by normal automated tests.
- Chrome smoke testing is still required for service-worker messaging, extension storage, options-page navigation, and the blocking operation layer.
- Amazon markup changes may require updates to `scrapeProductInfo`.
- Existing-review enrichment is planned as a later, low-priority enhancement.
