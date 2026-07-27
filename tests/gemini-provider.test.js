const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGeminiProvider() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    REVIEW_AUTHOR_PROVIDER_GEMINI: 'gemini',
    createProviderError: details => Object.assign(new Error(details.message), details),
    parseGeneratedResult: value => value,
    parseFollowUpQuestions: value => value,
    buildPrompt: () => 'prompt',
    buildFollowUpPrompt: () => 'prompt'
  });
  const code = fs.readFileSync(require.resolve('../gemini-provider.js'), 'utf8');
  vm.runInContext(`${code}\nthis.__exports = { extractGeminiOutputText, geminiIsAllowedModel, cleanProviderMessage };`, context);
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

test('provider messages redact API key-shaped values', () => {
  const provider = loadGeminiProvider();
  const cleaned = provider.cleanProviderMessage('Bad key AIzaabcdefghijklmnopqrstuvwxyz123456');
  assert.doesNotMatch(cleaned, /AIza/);
});
