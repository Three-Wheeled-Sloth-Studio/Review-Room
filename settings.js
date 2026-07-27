document.addEventListener('DOMContentLoaded', async function() {
  const apiKeyInput = document.getElementById('gemini-api-key');
  const rememberKey = document.getElementById('remember-key');
  const modelSelect = document.getElementById('gemini-model');
  const saveKeyBtn = document.getElementById('save-key');
  const clearKeyBtn = document.getElementById('clear-key');
  const status = document.getElementById('settings-status');
  const credentialBadge = document.getElementById('credential-badge');
  let configured = false;

  await loadSettings();

  saveKeyBtn.addEventListener('click', async function() {
    setBusy(true, 'Validating Gemini key...');

    try {
      const result = await saveGeminiCredential({
        apiKey: apiKeyInput.value,
        remember: rememberKey.checked
      });
      configured = result.configured;
      apiKeyInput.value = '';
      await saveDefaultModel();
      renderCredentialStatus();
      setStatus('Gemini key validated and saved.');
    } catch (error) {
      setStatus(formatGenerationError(error), true);
    } finally {
      setBusy(false);
    }
  });

  clearKeyBtn.addEventListener('click', async function() {
    setBusy(true, 'Clearing Gemini key...');

    try {
      await clearGeminiCredential();
      configured = false;
      rememberKey.checked = false;
      apiKeyInput.value = '';
      renderCredentialStatus();
      setStatus('Gemini key cleared.');
    } catch (error) {
      setStatus(formatGenerationError(error), true);
    } finally {
      setBusy(false);
    }
  });

  modelSelect.addEventListener('change', saveDefaultModel);

  async function loadSettings() {
    setBusy(true, 'Loading provider settings...');

    try {
      const [credentialSettings, models, saved] = await Promise.all([
        getGeminiCredentialSettings(),
        listProviderModels(REVIEW_AUTHOR_PROVIDER_GEMINI),
        chrome.storage.sync.get(['providerModels'])
      ]);

      configured = credentialSettings.configured;
      rememberKey.checked = credentialSettings.remember;
      populateModels(models, saved.providerModels?.gemini || 'gemini-3.6-flash');
      renderCredentialStatus();
      setStatus(configured
        ? 'Gemini is configured. Paste a new key only when replacing it.'
        : 'Add a Gemini API key to enable remote generation.');
    } catch (error) {
      setStatus(formatGenerationError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function populateModels(models, selectedModel) {
    modelSelect.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label || model.id;
      modelSelect.appendChild(option);
    });
    if (models.some(model => model.id === selectedModel)) {
      modelSelect.value = selectedModel;
    }
  }

  async function saveDefaultModel() {
    const saved = await chrome.storage.sync.get(['providerModels']);
    const providerModels = saved.providerModels || {};
    providerModels.gemini = modelSelect.value;
    await chrome.storage.sync.set({ providerModels });
  }

  function renderCredentialStatus() {
    credentialBadge.textContent = configured ? 'Configured' : 'Not configured';
    credentialBadge.classList.toggle('is-ready', configured);
    clearKeyBtn.disabled = !configured;
  }

  function setBusy(isBusy, message) {
    saveKeyBtn.disabled = isBusy;
    clearKeyBtn.disabled = isBusy || !configured;
    modelSelect.disabled = isBusy;
    rememberKey.disabled = isBusy;
    apiKeyInput.disabled = isBusy;
    if (message) setStatus(message);
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }
});
