# Gemini BYOK QA Pass

Updated: 2026-07-27
Repository: `Three-Wheeled-Sloth-Studio/Review-Room`
Pull request: #1

## QA status

Automated QA is green. A live Chrome smoke test with a real Gemini authorization key remains required before merging.

Validated in GitHub Actions:

- Node automated tests.
- JavaScript syntax checks for extension scripts.
- Manifest JSON parsing.

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

## Manual smoke test required

1. Check out `chore/update-project-ownership-and-gitignore`.
2. Open `chrome://extensions`.
3. Reload or load the repository as an unpacked extension.
4. Open Provider Settings.
5. Enter a current Gemini authorization key from Google AI Studio.
6. Validate and save it in session-only mode.
7. Open an Amazon product page.
8. Select Gemini and create a review.
9. Confirm the blocking `Generating Review` layer is unmistakable and controls cannot be used underneath it.
10. Confirm the completed title, stars, and review appear after generation.
11. Regenerate using feedback and confirm the prior draft survives any forced failure.
12. Generate follow-up questions.
13. Restart Chrome and confirm a session-only key is cleared.
14. Repeat with `Remember this key on this device` and confirm it persists.
15. Clear the key and confirm Gemini becomes unavailable until reconfigured.
16. Repeat initial generation and regeneration with Ollama to confirm no local-provider regression.

## Non-blocking follow-ups

- Domino's Pizza Tracker-style stage display remains a nice-to-have.
- Add reduced-motion styling for the progress animation.
- Improve modal focus management and restoration.
- Expand browser-level automated coverage when an extension test harness is introduced.
- Existing-review sampling remains low priority.
