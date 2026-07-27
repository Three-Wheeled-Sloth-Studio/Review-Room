const REVIEW_AUTHOR_PROVIDER_OLLAMA = 'ollama';
const REVIEW_AUTHOR_PROVIDER_GEMINI = 'gemini';

function buildPrompt({
  comments,
  guidance,
  productInfo,
  previousDraft,
  feedback,
  missingTopics,
  followUpAnswers
}) {
  const reviewerComments = comments?.trim() || '(No user notes were provided. In this case, write cautiously and avoid inventing personal experience.)';
  const previousDraftBlock = previousDraft ? `

Previous draft to improve:
Suggested stars: ${previousDraft.suggestedStars || ''}
Title: ${previousDraft.title || ''}
Review:
${previousDraft.generatedReview || ''}
` : '';
  const feedbackBlock = feedback?.trim() ? `

User feedback for this revision:
${feedback.trim()}
` : '';
  const missingTopicsBlock = missingTopics?.trim() ? `

Amazon-requested keywords or topics missing from the current draft. Incorporate these naturally only when supported by the reviewer notes or product context:
${missingTopics.trim()}
` : '';
  const followUpAnswersBlock = followUpAnswers?.trim() ? `

User answers to follow-up questions. Treat these as reviewer notes for this revision:
${followUpAnswers.trim()}
` : '';

  return `
Return only valid JSON with this exact shape:
{
  "suggestedStars": "1-5",
  "generatedReview": "plain text review body",
  "title": "plain text review title"
}

Do not include an introduction, explanation, markdown code fence, bullets, headers, or sign-off outside the JSON.
Use only plain ASCII punctuation available on a standard US keyboard. Do not use em dashes, en dashes, curly quotes, ellipses, bullets, or decorative punctuation. Prefer commas, periods, colons, semicolons, parentheses, or short sentences.

Voice and formatting guidance:
${guidance}

Reviewer notes. Treat these as the main source of truth and give them more weight than the product page:
${reviewerComments}
${previousDraftBlock}${feedbackBlock}${missingTopicsBlock}${followUpAnswersBlock}
Product page context. Use this only to avoid factual mistakes; do not let it turn the review into marketing copy:
Title: ${productInfo.title}
Description: ${productInfo.description || '(none found)'}

If the reviewer notes conflict with the product page, follow the reviewer notes. If the page has details not mentioned in the notes, include them only when they support the review naturally.
If the reviewer notes include a narrative comment, dry joke, sarcastic observation, wry phrasing, or specific angle, incorporate that idea into generatedReview. Do not flatten it into generic product commentary.
For suggestedStars, infer the rating from the reviewer notes. Use a whole number from 1 to 5 as a string. If the notes are mixed, choose the honest middle value instead of defaulting high.
For generatedReview, write only the review body. It must contain at least 2 real paragraphs separated by a blank line unless the reviewer notes are empty. Do not satisfy this by splitting one sentence into multiple paragraphs.
For title, write a short Amazon review title that sounds like a real customer, not an ad.
  `.trim();
}

function buildFollowUpPrompt({ comments, productInfo, currentDraft }) {
  const reviewerComments = comments?.trim() || '(No user notes were provided.)';

  return `
Return only valid JSON with this exact shape:
{
  "questions": ["question 1", "question 2", "question 3"]
}

Ask what questions a good review of this specific product would answer that were not covered in the original pass.

Make the questions practical, specific, and answerable by the reviewer. Do not ask generic review-writing questions. Do not ask for facts already covered by the reviewer notes or current draft. Do not ask the reviewer to invent experience they did not have.
Use only plain ASCII punctuation available on a standard US keyboard. Do not use em dashes, en dashes, curly quotes, ellipses, bullets, or decorative punctuation. Prefer commas, periods, colons, semicolons, parentheses, or short sentences.

Reviewer notes:
${reviewerComments}

Product context:
Title: ${productInfo.title}
Description: ${productInfo.description || '(none found)'}

Current draft:
Suggested stars: ${currentDraft?.suggestedStars || ''}
Title: ${currentDraft?.title || ''}
Review:
${currentDraft?.generatedReview || ''}
  `.trim();
}

async function generateReview(request) {
  return sendReviewAuthorMessage({
    type: 'provider.generateReview',
    request: sanitizeProviderRequest(request)
  });
}

async function generateFollowUpQuestions(request) {
  return sendReviewAuthorMessage({
    type: 'provider.generateFollowUpQuestions',
    request: sanitizeProviderRequest(request)
  });
}

async function listProviderModels(provider) {
  return sendReviewAuthorMessage({
    type: 'provider.listModels',
    provider
  });
}

async function getProviderCredentialStatus(provider) {
  return sendReviewAuthorMessage({
    type: 'provider.getCredentialStatus',
    provider
  });
}

async function getGeminiCredentialSettings() {
  return sendReviewAuthorMessage({
    type: 'credentials.getGeminiSettings'
  });
}

async function saveGeminiCredential({ apiKey, remember }) {
  return sendReviewAuthorMessage({
    type: 'credentials.saveGemini',
    apiKey: String(apiKey || '').trim(),
    remember: Boolean(remember)
  });
}

async function clearGeminiCredential() {
  return sendReviewAuthorMessage({
    type: 'credentials.clearGemini'
  });
}

async function validateGeminiCredential(apiKey) {
  return sendReviewAuthorMessage({
    type: 'credentials.validateGemini',
    apiKey: String(apiKey || '').trim()
  });
}

function sanitizeProviderRequest(request) {
  return {
    provider: request.provider || REVIEW_AUTHOR_PROVIDER_OLLAMA,
    model: request.model || '',
    comments: request.comments || '',
    guidance: request.guidance || '',
    productInfo: {
      title: request.productInfo?.title || '',
      description: request.productInfo?.description || ''
    },
    previousDraft: request.previousDraft || null,
    feedback: request.feedback || '',
    missingTopics: request.missingTopics || '',
    followUpAnswers: request.followUpAnswers || '',
    currentDraft: request.currentDraft || null
  };
}

function sendReviewAuthorMessage(message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('Chrome extension runtime is unavailable.'));
      return;
    }

    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        const payload = response?.error || {};
        const error = new Error(payload.message || 'The provider request failed.');
        Object.assign(error, payload);
        reject(error);
        return;
      }

      resolve(response.data);
    });
  });
}

function parseGeneratedResult(rawResponse) {
  const parsed = typeof rawResponse === 'string'
    ? JSON.parse(extractJsonObject(rawResponse))
    : rawResponse;

  if (!parsed || typeof parsed !== 'object') {
    throw createInvalidResponseError('Model did not return a review object.');
  }

  const result = {
    suggestedStars: cleanStars(parsed.suggestedStars),
    generatedReview: cleanReviewText(parsed.generatedReview || ''),
    title: cleanSingleLineText(parsed.title || '')
  };

  if (!result.suggestedStars || !result.generatedReview || !result.title) {
    throw createInvalidResponseError('Model returned an incomplete review.');
  }

  return result;
}

function parseFollowUpQuestions(rawResponse) {
  const parsed = typeof rawResponse === 'string'
    ? JSON.parse(extractJsonObject(rawResponse))
    : rawResponse;
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  return questions
    .map(question => cleanSingleLineText(question))
    .filter(Boolean)
    .slice(0, 5);
}

function createInvalidResponseError(message) {
  const error = new Error(message);
  error.code = 'INVALID_RESPONSE';
  return error;
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw createInvalidResponseError('Model did not return valid JSON.');
  }

  return trimmed.slice(start, end + 1);
}

function cleanStars(value) {
  const match = String(value || '').match(/[1-5]/);
  return match ? match[0] : '';
}

function cleanSingleLineText(text) {
  return cleanReviewText(text).replace(/\s+/g, ' ').trim();
}

function packReviewForPasting(result) {
  return [result.title, result.generatedReview]
    .filter(Boolean)
    .join('\r\n\r\n');
}

async function copyReviewForPasting(result) {
  const packedReview = packReviewForPasting(result);

  if (!packedReview) {
    return;
  }

  await navigator.clipboard.writeText(packedReview);
}

function cleanReviewText(text) {
  return normalizeKeyboardPunctuation(text)
    .replace(/\r\n/g, '\n')
    .replace(/^\s*(okay|sure|certainly|absolutely)[,.! ]+\s*(here's|here is)\s+[^:\n]*:\s*/i, '')
    .replace(/^\s*here's\s+[^:\n]*:\s*/i, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeKeyboardPunctuation(text) {
  return String(text || '')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, ' - ')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u2023\u25e6\u2043\u2219]/g, '*')
    .replace(/[\u00ab\u00bb]/g, '"')
    .replace(/\u2039/g, '<')
    .replace(/\u203a/g, '>')
    .replace(/[ \t]{2,}/g, ' ');
}

function formatProviderLabel(provider) {
  return provider === REVIEW_AUTHOR_PROVIDER_GEMINI ? 'Gemini' : 'Ollama';
}

function formatGenerationError(error) {
  const code = error?.code || '';

  if (code === 'MISSING_CREDENTIALS') {
    return 'Gemini is not configured. Open Provider Settings and add your Gemini API key.';
  }
  if (code === 'INVALID_CREDENTIALS') {
    return 'Gemini rejected the configured API key. Open Provider Settings to replace or validate it.';
  }
  if (code === 'RATE_LIMITED') {
    return 'Gemini is rate limited right now. Try the request again shortly.';
  }
  if (code === 'MODEL_UNAVAILABLE') {
    return 'The selected model is unavailable. Choose another model in Provider Settings.';
  }
  if (code === 'PROVIDER_OVERLOADED') {
    return 'The model provider is temporarily overloaded. Try again shortly.';
  }
  if (code === 'NETWORK_ERROR') {
    return 'The model provider could not be reached. Check your network connection and try again.';
  }
  if (code === 'SAFETY_BLOCKED') {
    return 'The provider blocked this request under its safety rules.';
  }
  if (code === 'INVALID_RESPONSE') {
    return 'The provider returned an invalid review format. Try generating it again.';
  }
  if (error?.provider === REVIEW_AUTHOR_PROVIDER_OLLAMA && error?.status === 403) {
    return 'Ollama rejected the Chrome extension origin. Quit Ollama from the tray, run restart-ollama-for-extension.cmd as administrator, then reload the extension.';
  }

  return error?.message || 'The review request failed.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildPrompt,
    buildFollowUpPrompt,
    parseGeneratedResult,
    parseFollowUpQuestions,
    extractJsonObject,
    cleanStars,
    cleanSingleLineText,
    cleanReviewText,
    normalizeKeyboardPunctuation,
    packReviewForPasting,
    sanitizeProviderRequest,
    formatGenerationError
  };
}
