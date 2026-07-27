document.addEventListener('DOMContentLoaded', async function() {
  const providerSelect = document.getElementById('provider');
  const modelSelect = document.getElementById('model');
  const reviewerComments = document.getElementById('reviewer-comments');
  const createReviewBtn = document.getElementById('create-review');
  const generationStatus = document.getElementById('generation-status');
  const guidance = document.getElementById('guidance');
  const openSettingsBtn = document.getElementById('open-settings');
  const configureGeminiBtn = document.getElementById('configure-gemini');
  const geminiConfigPanel = document.getElementById('gemini-config-panel');
  const geminiConfigStatus = document.getElementById('gemini-config-status');
  const remoteDisclosure = document.getElementById('remote-disclosure');
  let providerModels = {};
  let geminiConfigured = false;

  const defaultGuidance = {
    "Format": "Return separate fields for suggested stars, generated review, and title. The generated review must be plain text only: no greeting, intro, markdown, bullets, headers, rating, summary, or sign-off. Write 2-3 natural paragraphs. Paragraph 1 should describe the actual experience or first impression based on the reviewer notes. Paragraph 2 should explain the most important practical details, tradeoffs, or use-case fit. Paragraph 3 is optional and should only be used if there is a clear final judgment.",
    "Priority": "The user's reviewer comments are the source of truth. Use the product page only for factual context such as product type, size, materials, features, or names. Do not repeat marketing claims unless the user's notes support them.",
    "ReviewerVoice": "When the reviewer notes include a narrative aside, dry joke, sarcastic observation, wry phrasing, or specific angle, preserve that idea and work it into the generated review naturally. Treat those comments as intentional voice cues, not disposable notes.",
    "Depth": "Be more narrative than terse. Expand on implications of the reviewer notes, but do not invent facts, usage details, defects, ownership duration, or personal experience. If notes are sparse, use careful phrasing such as 'seems,' 'looks,' or 'for this use case' instead of making claims.",
    "Tone": "Smart, direct, conversational, and dry. Warm but not polished into corporate oatmeal. Use subtle humor only when it fits. Prefer plain words, varied sentence length, and a real-person review voice.",
    "Avoid": "No preamble such as 'Okay, here's a review.' No markdown. No bold text. No pros/cons list unless the user specifically asks for it. No sales-copy phrasing, inflated praise, or manufacturer-style feature dumping.",
    "Constraints": "Keep it suitable for Amazon. Do not mention receiving guidance, using AI, the product listing, or the user's notes.",
    "Punctuation": "Use only plain ASCII punctuation available on a standard US keyboard. Do not use em dashes, en dashes, curly quotes, ellipses, bullets, or decorative punctuation. Prefer commas, periods, colons, semicolons, parentheses, or short sentences."
  };

  try {
    const saved = await chrome.storage.sync.get([
      'guidance',
      'selectedProvider',
      'providerModels',
      'ollamaModel'
    ]);

    guidance.value = saved.guidance
      ? upgradeGuidance(saved.guidance, defaultGuidance)
      : JSON.stringify(defaultGuidance, null, 2);

    if (!saved.guidance || guidance.value !== saved.guidance) {
      await chrome.storage.sync.set({ guidance: guidance.value });
    }

    providerModels = saved.providerModels || {};
    if (!providerModels.ollama && saved.ollamaModel) {
      providerModels.ollama = saved.ollamaModel;
    }
    providerModels.gemini = providerModels.gemini || 'gemini-3.6-flash';
    providerSelect.value = saved.selectedProvider || REVIEW_AUTHOR_PROVIDER_OLLAMA;

    await refreshProviderUi();
  } catch (error) {
    console.error('Error initializing Review Author popup:', error);
    setStatus(formatGenerationError(error));
  }

  providerSelect.addEventListener('change', async function() {
    await chrome.storage.sync.set({ selectedProvider: providerSelect.value });
    await refreshProviderUi();
  });

  modelSelect.addEventListener('change', async function() {
    providerModels[providerSelect.value] = modelSelect.value;
    await chrome.storage.sync.set({ providerModels });
  });

  guidance.addEventListener('change', function() {
    chrome.storage.sync.set({ guidance: guidance.value });
  });

  openSettingsBtn.addEventListener('click', openProviderSettings);
  configureGeminiBtn.addEventListener('click', openProviderSettings);

  createReviewBtn.addEventListener('click', async function() {
    const provider = providerSelect.value;
    const model = modelSelect.value;

    if (!model) {
      setStatus(provider === REVIEW_AUTHOR_PROVIDER_OLLAMA
        ? 'Select an Ollama model first. If none appear, make sure Ollama is running.'
        : 'Select a Gemini model first.');
      return;
    }

    if (provider === REVIEW_AUTHOR_PROVIDER_GEMINI && !geminiConfigured) {
      setStatus('Configure Gemini before creating a review.');
      geminiConfigPanel.hidden = false;
      configureGeminiBtn.focus();
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !/^https?:\/\/([^/]+\.)?amazon\.com\//.test(tab.url || '')) {
      setStatus('Open an Amazon product page before creating a review.');
      return;
    }

    createReviewBtn.disabled = true;
    setStatus('Opening review workspace...');

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeProductInfo
      });
      const productInfo = results?.[0]?.result;

      if (!productInfo?.title) {
        throw new Error('Could not find product details on this page.');
      }

      const session = await saveReviewSession({
        provider,
        model,
        comments: reviewerComments.value,
        guidance: guidance.value,
        productInfo,
        sourceTab: {
          id: tab.id,
          url: tab.url,
          title: tab.title
        }
      });

      await chrome.tabs.create({
        url: chrome.runtime.getURL(`review.html?sessionId=${encodeURIComponent(session.id)}`)
      });
      setStatus('Review workspace opened.');
    } catch (error) {
      console.error('Error opening review workspace:', error);
      setStatus(formatGenerationError(error));
    } finally {
      createReviewBtn.disabled = false;
    }
  });

  async function refreshProviderUi() {
    const provider = providerSelect.value;
    setStatus(provider === REVIEW_AUTHOR_PROVIDER_OLLAMA
      ? 'Loading local Ollama models...'
      : 'Loading Gemini settings...');
    modelSelect.disabled = true;
    createReviewBtn.disabled = true;
    modelSelect.innerHTML = '';

    remoteDisclosure.hidden = provider !== REVIEW_AUTHOR_PROVIDER_GEMINI;
    geminiConfigPanel.hidden = provider !== REVIEW_AUTHOR_PROVIDER_GEMINI;

    try {
      const models = await listProviderModels(provider);
      populateModelOptions(models, providerModels[provider]);

      if (modelSelect.value) {
        providerModels[provider] = modelSelect.value;
        await chrome.storage.sync.set({ providerModels });
      }

      if (provider === REVIEW_AUTHOR_PROVIDER_GEMINI) {
        const credentialStatus = await getProviderCredentialStatus(provider);
        geminiConfigured = Boolean(credentialStatus.configured);
        geminiConfigStatus.textContent = geminiConfigured
          ? 'Gemini API key configured.'
          : 'Gemini API key required.';
        configureGeminiBtn.textContent = geminiConfigured ? 'Provider Settings' : 'Configure Gemini';
        setStatus(geminiConfigured
          ? 'Gemini is ready.'
          : 'Configure Gemini before creating a review.');
      } else {
        geminiConfigured = false;
        setStatus(models.length ? 'Ollama is ready.' : 'Start Ollama to load models.');
      }
    } catch (error) {
      console.error('Error loading provider models:', error);
      const option = document.createElement('option');
      option.value = '';
      option.textContent = provider === REVIEW_AUTHOR_PROVIDER_OLLAMA
        ? 'Start Ollama to load models'
        : 'Could not load Gemini models';
      modelSelect.appendChild(option);
      setStatus(formatGenerationError(error));
    } finally {
      modelSelect.disabled = false;
      createReviewBtn.disabled = false;
    }
  }

  function populateModelOptions(models, selectedModel) {
    modelSelect.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label || model.id;
      modelSelect.appendChild(option);
    });

    if (selectedModel && models.some(model => model.id === selectedModel)) {
      modelSelect.value = selectedModel;
    }
  }

  function setStatus(message) {
    generationStatus.value = message;
  }
});

function openProviderSettings() {
  chrome.runtime.openOptionsPage();
}

function upgradeGuidance(savedGuidance, defaultGuidance) {
  try {
    const parsed = JSON.parse(savedGuidance);
    const requiredFields = Object.keys(defaultGuidance);
    if (requiredFields.every(field => Object.prototype.hasOwnProperty.call(parsed, field))) {
      return savedGuidance;
    }

    return JSON.stringify({
      ...defaultGuidance,
      Feedback: parsed.Feedback
    }, null, 2);
  } catch (error) {
    return savedGuidance;
  }
}

function scrapeProductInfo() {
  const textOf = selector => document.querySelector(selector)?.innerText?.trim() || '';
  const title = textOf('#productTitle') || document.title.replace(/: Amazon\..*$/, '').trim();
  const description = textOf('#feature-bullets') || textOf('#productDescription') || textOf('#bookDescription_feature_div');

  return { title, description };
}

async function saveReviewSession({ provider, model, comments, guidance, productInfo, sourceTab }) {
  const id = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const session = {
    id,
    createdAt: now,
    updatedAt: now,
    provider,
    model,
    providerConfigVersion: 1,
    comments,
    guidance,
    productInfo,
    sourceTab,
    result: null,
    status: 'pending',
    iterations: [],
    workspace: {
      feedback: '',
      missingTopics: '',
      followUpAnswers: '',
      followUpQuestions: []
    }
  };

  await chrome.storage.local.set({ [id]: session, latestReviewSessionId: id });
  return session;
}
