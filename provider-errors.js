function createProviderError({ provider, code, message, status = null, retryable = false }) {
  const error = new Error(message || 'Provider request failed.');
  error.provider = provider;
  error.code = code || 'UNKNOWN_PROVIDER_ERROR';
  error.status = status;
  error.retryable = retryable;
  return error;
}

function createProviderHttpError(provider, status, message) {
  let code = 'UNKNOWN_PROVIDER_ERROR';
  if (provider === REVIEW_AUTHOR_PROVIDER_OLLAMA && status === 403) code = 'OLLAMA_ORIGIN_REJECTED';
  else if (status === 401 || status === 403) code = 'INVALID_CREDENTIALS';
  else if (status === 404) code = 'MODEL_UNAVAILABLE';
  else if (status === 413) code = 'REQUEST_TOO_LARGE';
  else if (status === 429) code = 'RATE_LIMITED';
  else if (status >= 500) code = 'PROVIDER_OVERLOADED';

  return createProviderError({
    provider,
    code,
    status,
    retryable: status === 429 || status >= 500,
    message
  });
}

function isRetryableProviderError(error) {
  return Boolean(error?.retryable);
}

function redactProviderSecrets(message) {
  return String(message || '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/AQ\.[0-9A-Za-z._~-]{20,}/g, '[redacted]');
}

function serializeProviderError(error) {
  return {
    provider: error?.provider || null,
    code: error?.code || 'UNKNOWN_PROVIDER_ERROR',
    status: Number.isInteger(error?.status) ? error.status : null,
    retryable: Boolean(error?.retryable),
    message: redactProviderSecrets(error?.message || 'Provider request failed.')
      .slice(0, 500)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createProviderError,
    createProviderHttpError,
    isRetryableProviderError,
    redactProviderSecrets,
    serializeProviderError
  };
}
