const REVIEW_AUTHOR_GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const REVIEW_AUTHOR_GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
const REVIEW_AUTHOR_GEMINI_MODELS = Object.freeze([
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash (recommended)'
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite (economy)'
  }
]);

const REVIEW_AUTHOR_REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    suggestedStars: {
      type: 'string',
      enum: ['1', '2', '3', '4', '5'],
      description: 'Whole-number star rating inferred from reviewer notes.'
    },
    generatedReview: {
      type: 'string',
      description: 'Plain-text Amazon review body with no markdown.'
    },
    title: {
      type: 'string',
      description: 'Short plain-text Amazon review title.'
    }
  },
  required: ['suggestedStars', 'generatedReview', 'title'],
  additionalProperties: false
});

const REVIEW_AUTHOR_FOLLOW_UP_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Practical product-specific questions for the reviewer.'
    }
  },
  required: ['questions'],
  additionalProperties: false
});

function geminiListModels() {
  return REVIEW_AUTHOR_GEMINI_MODELS.map(model => ({ ...model }));
}

function geminiIsAllowedModel(model) {
  return REVIEW_AUTHOR_GEMINI_MODELS.some(candidate => candidate.id === model);
}

async function geminiValidateApiKey(apiKey) {
  if (!apiKey) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'MISSING_CREDENTIALS',
      message: 'Enter a Gemini API key first.'
    });
  }

  const response = await geminiFetch(REVIEW_AUTHOR_GEMINI_MODELS_URL, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey
    }
  }, false);

  return response.ok;
}

async function geminiGenerateReview(request, apiKey) {
  const outputText = await geminiCreateStructuredInteraction({
    model: request.model,
    prompt: buildPrompt(request),
    schema: REVIEW_AUTHOR_REVIEW_SCHEMA,
    apiKey
  });

  return parseGeneratedResult(outputText);
}

async function geminiGenerateFollowUpQuestions(request, apiKey) {
  const outputText = await geminiCreateStructuredInteraction({
    model: request.model,
    prompt: buildFollowUpPrompt(request),
    schema: REVIEW_AUTHOR_FOLLOW_UP_SCHEMA,
    apiKey
  });

  return parseFollowUpQuestions(outputText);
}

async function geminiCreateStructuredInteraction({ model, prompt, schema, apiKey }) {
  if (!apiKey) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'MISSING_CREDENTIALS',
      message: 'Gemini API key is not configured.'
    });
  }

  if (!geminiIsAllowedModel(model)) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'MODEL_UNAVAILABLE',
      message: 'The selected Gemini model is not supported by this extension.'
    });
  }

  const response = await geminiFetch(REVIEW_AUTHOR_GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      model,
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema
      }
    })
  }, true);

  const payload = await response.json();
  const outputText = extractGeminiOutputText(payload);

  if (!outputText) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'INVALID_RESPONSE',
      message: 'Gemini returned no review text.'
    });
  }

  return outputText;
}

async function geminiFetch(url, options, allowRetry) {
  const attempts = allowRetry ? 2 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;

    try {
      response = await fetch(url, options);
    } catch (error) {
      lastError = createProviderError({
        provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
        code: 'NETWORK_ERROR',
        message: 'Gemini could not be reached.'
      });

      if (attempt < attempts) {
        await delay(700);
        continue;
      }

      throw lastError;
    }

    if (response.ok) {
      return response;
    }

    const providerError = await createGeminiHttpError(response);
    lastError = providerError;

    if (attempt < attempts && isRetryableProviderError(providerError)) {
      await delay(700 * attempt);
      continue;
    }

    throw providerError;
  }

  throw lastError || createProviderError({
    provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
    code: 'UNKNOWN_PROVIDER_ERROR',
    message: 'Gemini request failed.'
  });
}

async function createGeminiHttpError(response) {
  let providerMessage = '';

  try {
    const payload = await response.clone().json();
    providerMessage = cleanProviderMessage(payload?.error?.message || '');
  } catch (error) {
    providerMessage = '';
  }

  let code = 'UNKNOWN_PROVIDER_ERROR';
  if (response.status === 400) code = 'INVALID_RESPONSE';
  if (response.status === 401 || response.status === 403) code = 'INVALID_CREDENTIALS';
  if (response.status === 404) code = 'MODEL_UNAVAILABLE';
  if (response.status === 429) code = 'RATE_LIMITED';
  if (response.status >= 500) code = 'PROVIDER_OVERLOADED';

  return createProviderError({
    provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
    code,
    status: response.status,
    retryable: code === 'RATE_LIMITED' || code === 'PROVIDER_OVERLOADED',
    message: providerMessage || `Gemini returned HTTP ${response.status}.`
  });
}

function extractGeminiOutputText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  if (Array.isArray(payload?.steps)) {
    const texts = [];
    for (const step of payload.steps) {
      if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const part of step.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          texts.push(part.text);
        }
      }
    }
    if (texts.length) return texts.join('');
  }

  if (Array.isArray(payload?.outputs)) {
    const texts = [];
    for (const output of payload.outputs) {
      if (typeof output?.text === 'string') texts.push(output.text);
      if (Array.isArray(output?.content)) {
        output.content.forEach(part => {
          if (typeof part?.text === 'string') texts.push(part.text);
        });
      }
    }
    if (texts.length) return texts.join('');
  }

  if (Array.isArray(payload?.candidates)) {
    const texts = [];
    payload.candidates.forEach(candidate => {
      candidate?.content?.parts?.forEach(part => {
        if (typeof part?.text === 'string') texts.push(part.text);
      });
    });
    if (texts.length) return texts.join('');
  }

  return '';
}

function cleanProviderMessage(message) {
  return String(message || '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
