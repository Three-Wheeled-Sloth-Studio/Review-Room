const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGeneratedResult,
  parseFollowUpQuestions,
  cleanReviewText,
  sanitizeProviderRequest,
  formatGenerationError
} = require('../review-core.js');

test('parseGeneratedResult cleans structured review fields', () => {
  const result = parseGeneratedResult({
    suggestedStars: '4 stars',
    generatedReview: '**Solid product**\n\nWorks as expected.',
    title: 'A useful thing'
  });

  assert.equal(result.suggestedStars, '4');
  assert.equal(result.generatedReview, 'Solid product\n\nWorks as expected.');
  assert.equal(result.title, 'A useful thing');
});

test('parseFollowUpQuestions caps and cleans questions', () => {
  const questions = parseFollowUpQuestions({
    questions: ['**How loud is it?**', 'How long did setup take?', '', 'A', 'B', 'C']
  });

  assert.deepEqual(questions, ['How loud is it?', 'How long did setup take?', 'A', 'B', 'C']);
});

test('cleanReviewText normalizes non-ASCII punctuation', () => {
  assert.equal(cleanReviewText('Good\u2014but not magic\u2026'), 'Good - but not magic...');
});

test('sanitizeProviderRequest excludes credentials and source tab details', () => {
  const request = sanitizeProviderRequest({
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    apiKey: 'should-not-survive',
    sourceTab: { url: 'https://example.com' },
    productInfo: { title: 'Widget', description: 'Stuff' }
  });

  assert.equal(request.provider, 'gemini');
  assert.equal(request.model, 'gemini-3.6-flash');
  assert.equal(Object.hasOwn(request, 'apiKey'), false);
  assert.equal(Object.hasOwn(request, 'sourceTab'), false);
});

test('formatGenerationError gives a direct missing-key route', () => {
  assert.match(formatGenerationError({ code: 'MISSING_CREDENTIALS' }), /Provider Settings/);
});
