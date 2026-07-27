const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redactProviderSecrets,
  serializeProviderError
} = require('../provider-errors.js');

test('redacts standard AIza API keys', () => {
  const redacted = redactProviderSecrets('Rejected AIzaabcdefghijklmnopqrstuvwxyz1234567890');
  assert.doesNotMatch(redacted, /AIza/);
  assert.match(redacted, /\[redacted\]/);
});

test('redacts AQ authorization keys', () => {
  const redacted = redactProviderSecrets('Rejected AQ.abcdefghijklmnopqrstuvwxyz_1234567890');
  assert.doesNotMatch(redacted, /AQ\./);
  assert.match(redacted, /\[redacted\]/);
});

test('serialized provider errors do not expose either key type', () => {
  const serialized = serializeProviderError({
    provider: 'gemini',
    code: 'INVALID_CREDENTIALS',
    message: 'Bad AIzaabcdefghijklmnopqrstuvwxyz1234567890 or AQ.abcdefghijklmnopqrstuvwxyz_1234567890'
  });

  assert.doesNotMatch(serialized.message, /AIza|AQ\./);
});
