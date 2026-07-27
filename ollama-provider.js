const REVIEW_AUTHOR_OLLAMA_BASE_URL = 'http://localhost:11434';

async function ollamaListModels() {
  let response;

  try {
    response = await fetch(`${REVIEW_AUTHOR_OLLAMA_BASE_URL}/api/tags`);
  } catch (error) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_OLLAMA,
      code: 'NETWORK_ERROR',
      message: 'Ollama is not reachable. Make sure it is running.'
    });
  }

  if (!response.ok) {
    throw createProviderHttpError(REVIEW_AUTHOR_PROVIDER_OLLAMA, response.status, 'Ollama model list request failed.');
  }

  const data = await response.json();
  return (Array.isArray(data.models) ? data.models : []).map(model => ({
    id: model.name,
    label: model.name
  }));
}

async function ollamaGenerateReview(request) {
  const rawResponse = await ollamaGenerate({
    model: request.model,
    prompt: buildPrompt(request)
  });

  return parseGeneratedResult(rawResponse);
}

async function ollamaGenerateFollowUpQuestions(request) {
  const rawResponse = await ollamaGenerate({
    model: request.model,
    prompt: buildFollowUpPrompt(request)
  });

  return parseFollowUpQuestions(rawResponse);
}

async function ollamaGenerate({ model, prompt }) {
  let response;

  try {
    response = await fetch(`${REVIEW_AUTHOR_OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, prompt })
    });
  } catch (error) {
    throw createProviderError({
      provider: REVIEW_AUTHOR_PROVIDER_OLLAMA,
      code: 'NETWORK_ERROR',
      message: 'Ollama is not reachable. Make sure it is running.'
    });
  }

  if (!response.ok) {
    throw createProviderHttpError(REVIEW_AUTHOR_PROVIDER_OLLAMA, response.status, `Ollama returned HTTP ${response.status}.`);
  }

  return readOllamaStream(response);
}

async function readOllamaStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let rawResponse = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      rawResponse += parsed.response || '';
    }
  }

  if (pending.trim()) {
    const parsed = JSON.parse(pending);
    rawResponse += parsed.response || '';
  }

  return rawResponse;
}
