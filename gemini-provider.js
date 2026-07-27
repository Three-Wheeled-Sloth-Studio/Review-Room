const REVIEW_AUTHOR_GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const REVIEW_AUTHOR_GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1/models?pageSize=1';
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

function buildGeminiInteractionRequest({ model, prompt, schema }) {
  return {
    model,
    input: prompt,
    store: false,
    stream: true,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema
    }
  };
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
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(buildGeminiInteractionRequest({ model, prompt, schema }))
  }, true);

  const contentType = response.headers.get('content-type') || '';
  const outputText = contentType.includes('text/event-stream')
    ? await readGeminiInteractionStream(response)
    : extractGeminiOutputText(await response.json());

  if (!outputText) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'INVALID_RESPONSE',
      message: 'Gemini returned no review text.'
    });
  }

  return outputText;
}

async function readGeminiInteractionStream(response) {
  if (!response.body?.getReader) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'INVALID_RESPONSE',
      message: 'Gemini returned an unreadable response stream.'
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const keepAliveTimer = startExtensionServiceWorkerKeepAlive();
  let pending = '';
  let outputText = '';
  let terminalStatus = '';

  function consumeEventBlock(block) {
    const event = parseGeminiSseEventBlock(block);
    if (!event) return;

    outputText += extractGeminiStreamEventText(event);
    const status = String(event?.interaction?.status || '').toLowerCase();
    if (status) terminalStatus = status;

    if (event.event_type === 'interaction.failed' || status === 'failed' || status === 'cancelled') {
      throw createProviderError({
        provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
        code: 'INVALID_RESPONSE',
        message: 'Gemini failed before completing the review.'
      });
    }

    if (status === 'incomplete') {
      throw createProviderError({
        provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
        code: 'INVALID_RESPONSE',
        message: 'Gemini returned an incomplete review.'
      });
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      pending = pending.replace(/\r\n/g, '\n');

      const blocks = pending.split('\n\n');
      pending = blocks.pop() || '';
      blocks.forEach(consumeEventBlock);

      if (done) break;
    }

    if (pending.trim()) {
      consumeEventBlock(pending);
    }
  } catch (error) {
    if (error?.code) throw error;
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'NETWORK_ERROR',
      message: 'The Gemini response stream ended unexpectedly.'
    });
  } finally {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
  }

  if (terminalStatus && terminalStatus !== 'completed') {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'INVALID_RESPONSE',
      message: `Gemini ended with status ${terminalStatus}.`
    });
  }

  return outputText;
}

function parseGeminiSseEventBlock(block) {
  const data = String(block || '')
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data || data === '[DONE]') return null;

  try {
    return JSON.parse(data);
  } catch (error) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'INVALID_RESPONSE',
      message: 'Gemini returned malformed streaming data.'
    });
  }
}

function extractGeminiStreamEventText(event) {
  if (event?.event_type === 'step.delta' && event?.delta?.type === 'text') {
    return typeof event.delta.text === 'string' ? event.delta.text : '';
  }

  if (event?.event_type === 'step.start' && event?.step?.type === 'model_output') {
    return extractGeminiOutputText({ steps: [event.step] });
  }

  return '';
}

function startExtensionServiceWorkerKeepAlive() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getPlatformInfo) return null;

  return setInterval(() => {
    try {
      const result = chrome.runtime.getPlatformInfo();
      if (result?.catch) result.catch(() => {});
    } catch (error) {
      // The request result is irrelevant. The extension API call resets Chrome's idle timer.
    }
  }, 20000);
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
  if (response.status === 400) code = 'INVALID_REQUEST';
  if (response.status === 401 || response.status === 403) code = 'INVALID_CREDENTIALS';
  if (response.status === 404) code = 'MODEL_UNAVAILABLE';
  if (response.status === 413) code = 'REQUEST_TOO_LARGE';
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
