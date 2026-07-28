const REVIEW_AUTHOR_PROVIDER_SCRIPTS = Object.freeze([
  'review-core.js',
  'provider-errors.js',
  'ollama-provider.js',
  'gemini-provider.js'
]);

let providerBootstrapError = null;

for (const script of REVIEW_AUTHOR_PROVIDER_SCRIPTS) {
  try {
    importScripts(script);
  } catch (error) {
    providerBootstrapError = new Error(
      `Review Author could not load ${script}. Pull the latest files and reload the extension from chrome://extensions. ${error?.message || ''}`.trim()
    );
    providerBootstrapError.code = 'SERVICE_WORKER_BOOTSTRAP_FAILED';
    console.error('Review Author service worker bootstrap failed.', script, error);
    break;
  }
}

const GEMINI_SESSION_KEY = 'reviewAuthorGeminiApiKey';
const GEMINI_LOCAL_KEY = 'reviewAuthorGeminiApiKey';
const GEMINI_REMEMBER_KEY = 'reviewAuthorGeminiRememberKey';

initializeTrustedStorage();

chrome.runtime.onInstalled.addListener(() => {
  initializeTrustedStorage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (providerBootstrapError) {
    sendResponse({ ok: false, error: serializeWorkerError(providerBootstrapError) });
    return true;
  }

  handleRuntimeMessage(message)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: serializeWorkerError(error) }));

  return true;
});

async function handleRuntimeMessage(message) {
  switch (message?.type) {
    case 'provider.listModels':
      return listModels(message.provider);
    case 'provider.getCredentialStatus':
      return getCredentialStatus(message.provider);
    case 'provider.generateReview':
      return runProviderOperation('review', message.request);
    case 'provider.generateFollowUpQuestions':
      return runProviderOperation('followUps', message.request);
    case 'credentials.getGeminiSettings':
      return getGeminiSettings();
    case 'credentials.validateGemini':
      await geminiValidateApiKey(message.apiKey);
      return { valid: true };
    case 'credentials.saveGemini':
      return saveGeminiSettings(message.apiKey, message.remember);
    case 'credentials.clearGemini':
      return clearGeminiSettings();
    default:
      throw createProviderError({
        code: 'UNKNOWN_PROVIDER_ERROR',
        message: 'Unknown Review Author runtime request.'
      });
  }
}

async function listModels(provider) {
  if (provider === REVIEW_AUTHOR_PROVIDER_GEMINI) {
    return geminiListModels();
  }
  if (provider === REVIEW_AUTHOR_PROVIDER_OLLAMA) {
    return ollamaListModels();
  }

  throw createProviderError({
    provider,
    code: 'MODEL_UNAVAILABLE',
    message: 'Unknown model provider.'
  });
}

async function getCredentialStatus(provider) {
  if (provider !== REVIEW_AUTHOR_PROVIDER_GEMINI) {
    return { configured: true, remember: false };
  }

  const settings = await getGeminiSettings();
  return {
    configured: settings.configured,
    remember: settings.remember
  };
}

async function runProviderOperation(operation, request) {
  const provider = request?.provider || REVIEW_AUTHOR_PROVIDER_OLLAMA;

  if (!request?.model) {
    throw createProviderError({
      provider,
      code: 'MODEL_UNAVAILABLE',
      message: 'Select a model before generating a review.'
    });
  }

  if (provider === REVIEW_AUTHOR_PROVIDER_OLLAMA) {
    return operation === 'review'
      ? ollamaGenerateReview(request)
      : ollamaGenerateFollowUpQuestions(request);
  }

  if (provider === REVIEW_AUTHOR_PROVIDER_GEMINI) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      throw createProviderError({
        provider,
        code: 'MISSING_CREDENTIALS',
        message: 'Gemini API key is not configured.'
      });
    }

    return operation === 'review'
      ? geminiGenerateReview(request, apiKey)
      : geminiGenerateFollowUpQuestions(request, apiKey);
  }

  throw createProviderError({
    provider,
    code: 'MODEL_UNAVAILABLE',
    message: 'Unknown model provider.'
  });
}

async function getGeminiApiKey() {
  const sessionResult = await chrome.storage.session.get(GEMINI_SESSION_KEY);
  if (sessionResult[GEMINI_SESSION_KEY]) {
    return sessionResult[GEMINI_SESSION_KEY];
  }

  const localResult = await chrome.storage.local.get([GEMINI_LOCAL_KEY, GEMINI_REMEMBER_KEY]);
  if (localResult[GEMINI_REMEMBER_KEY] && localResult[GEMINI_LOCAL_KEY]) {
    return localResult[GEMINI_LOCAL_KEY];
  }

  return '';
}

async function getGeminiSettings() {
  const [sessionResult, localResult] = await Promise.all([
    chrome.storage.session.get(GEMINI_SESSION_KEY),
    chrome.storage.local.get([GEMINI_LOCAL_KEY, GEMINI_REMEMBER_KEY])
  ]);

  return {
    configured: Boolean(sessionResult[GEMINI_SESSION_KEY] || (localResult[GEMINI_REMEMBER_KEY] && localResult[GEMINI_LOCAL_KEY])),
    remember: Boolean(localResult[GEMINI_REMEMBER_KEY])
  };
}

async function saveGeminiSettings(apiKey, remember) {
  const currentKey = await getGeminiApiKey();
  const nextKey = String(apiKey || '').trim() || currentKey;

  if (!nextKey) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_GEMINI,
      code: 'MISSING_CREDENTIALS',
      message: 'Enter a Gemini API key first.'
    });
  }

  await geminiValidateApiKey(nextKey);

  if (remember) {
    await chrome.storage.local.set({
      [GEMINI_LOCAL_KEY]: nextKey,
      [GEMINI_REMEMBER_KEY]: true
    });
    await chrome.storage.session.remove(GEMINI_SESSION_KEY);
  } else {
    await chrome.storage.session.set({ [GEMINI_SESSION_KEY]: nextKey });
    await chrome.storage.local.remove([GEMINI_LOCAL_KEY, GEMINI_REMEMBER_KEY]);
  }

  return { configured: true, remember: Boolean(remember) };
}

async function clearGeminiSettings() {
  await Promise.all([
    chrome.storage.session.remove(GEMINI_SESSION_KEY),
    chrome.storage.local.remove([GEMINI_LOCAL_KEY, GEMINI_REMEMBER_KEY])
  ]);

  return { configured: false, remember: false };
}

function serializeWorkerError(error) {
  if (typeof serializeProviderError === 'function') {
    return serializeProviderError(error);
  }

  return {
    provider: null,
    code: error?.code || 'SERVICE_WORKER_BOOTSTRAP_FAILED',
    status: null,
    retryable: false,
    message: String(error?.message || 'Review Author background service failed to start.').slice(0, 500)
  };
}

async function initializeTrustedStorage() {
  try {
    if (chrome.storage.local?.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
    if (chrome.storage.session?.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch (error) {
    console.warn('Could not restrict Review Author storage access level.', error);
  }
}
