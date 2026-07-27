const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGeminiProvider() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    REVIEW_AUTHOR_PROVIDER_GEMINI: 'gemini',
    createProviderError: details => Object.assign(new Error(details.message), details),
    parseGeneratedResult: value => value,
    parseFollowUpQuestions: value => value,
    buildPrompt: () => 'prompt',
    buildFollowUpPrompt: () => 'prompt'
  });
  const code = fs.readFileSync(require.resolve('../gemini-provider.js'), 'utf8');
  vm.runInContext(`${code}\nthis.__exports = {
    REVIEW_AUTHOR_GEMINI_INTERACTIONS_URL,
    REVIEW_AUTHOR_GEMINI_MODELS_URL,
    buildGeminiInteractionRequest,
    parseGeminiSseEventBlock,
    extractGeminiStreamEventText,
    extractGeminiOutputText,
    geminiIsAllowedModel,
    cleanProviderMessage
  };`, context);
  return context.__exports;
}

test('extractGeminiOutputText reads current REST steps shape', () => {
  const provider = loadGeminiProvider();
  const text = provider.extractGeminiOutputText({
    steps: [{
      type: 'model_output',
      content: [{ type: 'text', text: '{"title":"Good"}' }]
    }]
  });
  assert.equal(text, '{"title":"Good"}');
});

test('Gemini model allowlist uses stable models', () => {
  const provider = loadGeminiProvider();
  assert.equal(provider.geminiIsAllowedModel('gemini-3.6-flash'), true);
  assert.equal(provider.geminiIsAllowedModel('gemini-flash-latest'), false);
});

test('Gemini uses stable v1 REST endpoints', () => {
  const provider = loadGeminiProvider();
  assert.equal(provider.REVIEW_AUTHOR_GEMINI_INTERACTIONS_URL, 'https://generativelanguage.googleapis.com/v1/interactions');
  assert.equal(provider.REVIEW_AUTHOR_GEMINI_MODELS_URL, 'https://generativelanguage.googleapis.com/v1/models?pageSize=1');
});

test('Gemini requests use stateless streaming transport', () => {
  const provider = loadGeminiProvider();
  const request = provider.buildGeminiInteractionRequest({
    model: 'gemini-3.6-flash',
    prompt: 'Draft a review',
    schema: { type: 'object' }
  });

  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  assert.equal(request.model, 'gemini-3.6-flash');
  assert.equal(request.input, 'Draft a review');
  assert.equal(request.response_format.mime_type, 'application/json');
});

test('Gemini SSE parser reads text deltas', () => {
  const provider = loadGeminiProvider();
  const event = provider.parseGeminiSseEventBlock([
    'event: step.delta',
    'data: {"index":1,"delta":{"type":"text","text":"{\\"title\\":\\"Good\\"}"},"event_type":"step.delta"}'
  ].join('\n'));

  assert.equal(provider.extractGeminiStreamEventText(event), '{"title":"Good"}');
});

test('Gemini SSE parser ignores the terminal done marker', () => {
  const provider = loadGeminiProvider();
  assert.equal(provider.parseGeminiSseEventBlock('event: done\ndata: [DONE]'), null);
});

test('provider messages redact API key-shaped values', () => {
  const provider = loadGeminiProvider();
  const cleaned = provider.cleanProviderMessage('Bad key AIzaabcdefghijklmnopqrstuvwxyz123456');
  assert.doesNotMatch(cleaned, /AIza/);
});
