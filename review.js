document.addEventListener('DOMContentLoaded', async function() {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId');
  const workspaceShell = document.getElementById('workspace-shell');
  const productTitle = document.getElementById('product-title');
  const providerContext = document.getElementById('provider-context');
  const reviewTitle = document.getElementById('review-title');
  const suggestedStars = document.getElementById('suggested-stars');
  const generatedReview = document.getElementById('generated-review');
  const feedback = document.getElementById('feedback');
  const missingTopics = document.getElementById('missing-topics');
  const followUpQuestions = document.getElementById('follow-up-questions');
  const followUpAnswers = document.getElementById('follow-up-answers');
  const statusLine = document.getElementById('status-line');
  const copyAllBtn = document.getElementById('copy-all');
  const copyTitleBtn = document.getElementById('copy-title');
  const copyBodyBtn = document.getElementById('copy-body');
  const askFollowUpsBtn = document.getElementById('ask-follow-ups');
  const regenerateReviewBtn = document.getElementById('regenerate-review');
  const workspaceSettingsBtn = document.getElementById('workspace-settings');
  const operationLayer = document.getElementById('operation-layer');
  const operationTitle = document.getElementById('operation-title');
  const operationProvider = document.getElementById('operation-provider');
  const operationDetail = document.getElementById('operation-detail');
  let session = null;
  let isBusy = false;

  if (!sessionId) {
    setStatus('No review session was provided.');
    setControlsDisabled(true);
    return;
  }

  session = await loadSession(sessionId);

  if (!session) {
    setStatus('Review session was not found.');
    setControlsDisabled(true);
    return;
  }

  normalizeSession();
  renderSession();

  workspaceSettingsBtn.addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });

  copyAllBtn.addEventListener('click', async function() {
    await navigator.clipboard.writeText(packReviewForPasting(getCurrentResult()));
    setStatus('Copied review.');
  });

  copyTitleBtn.addEventListener('click', async function() {
    await navigator.clipboard.writeText(reviewTitle.value.trim());
    setStatus('Copied title.');
  });

  copyBodyBtn.addEventListener('click', async function() {
    await navigator.clipboard.writeText(generatedReview.value.trim());
    setStatus('Copied body.');
  });

  askFollowUpsBtn.addEventListener('click', async function() {
    if (isBusy) return;
    setBusy(true, {
      title: 'Generating Questions',
      detail: `Asking ${formatProviderLabel(session.provider)} for useful follow-up questions...`
    });

    try {
      const questions = await generateFollowUpQuestions({
        provider: session.provider,
        model: session.model,
        comments: session.comments,
        productInfo: session.productInfo,
        currentDraft: getCurrentResult()
      });

      operationDetail.textContent = 'Formatting questions...';
      followUpQuestions.value = questions.join('\n');
      session.workspace.followUpQuestions = questions;
      await saveSession();
      setStatus(questions.length ? 'Follow-up questions ready.' : 'No follow-up questions returned.');
    } catch (error) {
      console.error('Error generating follow-up questions:', error);
      setStatus(`Error generating follow-up questions: ${formatGenerationError(error)}`);
    } finally {
      setBusy(false);
    }
  });

  regenerateReviewBtn.addEventListener('click', async function() {
    if (isBusy) return;
    const previousDraft = getCurrentResult();
    setBusy(true, {
      title: 'Generating Review',
      detail: `Sending revision context to ${formatProviderLabel(session.provider)}...`
    });

    try {
      operationDetail.textContent = 'Generating revised review...';
      const result = await generateReview({
        provider: session.provider,
        model: session.model,
        comments: session.comments,
        guidance: session.guidance,
        productInfo: session.productInfo,
        previousDraft,
        feedback: feedback.value,
        missingTopics: missingTopics.value,
        followUpAnswers: followUpAnswers.value
      });

      operationDetail.textContent = 'Formatting review...';
      session.result = result;
      session.workspace.feedback = feedback.value;
      session.workspace.missingTopics = missingTopics.value;
      session.workspace.followUpAnswers = followUpAnswers.value;
      session.iterations.push({
        createdAt: new Date().toISOString(),
        type: 'regeneration',
        provider: session.provider,
        model: session.model,
        feedback: feedback.value,
        missingTopics: missingTopics.value,
        followUpAnswers: followUpAnswers.value,
        previousDraft,
        result
      });
      renderResult(result);
      await saveSession();
      setStatus('Review regenerated.');
    } catch (error) {
      console.error('Error regenerating review:', error);
      renderResult(previousDraft);
      setStatus(`Error regenerating review: ${formatGenerationError(error)}`);
    } finally {
      setBusy(false);
    }
  });

  [reviewTitle, suggestedStars, generatedReview, feedback, missingTopics, followUpAnswers].forEach(element => {
    element.addEventListener('change', async function() {
      session.result = getCurrentResult();
      session.workspace.feedback = feedback.value;
      session.workspace.missingTopics = missingTopics.value;
      session.workspace.followUpAnswers = followUpAnswers.value;
      await saveSession();
    });
  });

  async function loadSession(id) {
    const result = await chrome.storage.local.get(id);
    return result[id] || null;
  }

  async function saveSession() {
    session.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [session.id]: session, latestReviewSessionId: session.id });
  }

  function renderSession() {
    productTitle.textContent = session.productInfo?.title || 'Generated Review';
    providerContext.textContent = `Provider: ${formatProviderLabel(session.provider)} | Model: ${session.model}`;
    renderResult(session.result);
    feedback.value = session.workspace?.feedback || '';
    missingTopics.value = session.workspace?.missingTopics || '';
    followUpAnswers.value = session.workspace?.followUpAnswers || '';
    followUpQuestions.value = (session.workspace?.followUpQuestions || []).join('\n');
    if (session.status === 'pending' && !session.result) {
      generateInitialReview();
    } else {
      setStatus('Review workspace ready.');
    }
  }

  function renderResult(result) {
    reviewTitle.value = result?.title || '';
    suggestedStars.value = result?.suggestedStars || '';
    generatedReview.value = result?.generatedReview || '';
  }

  function getCurrentResult() {
    return {
      title: cleanSingleLineText(reviewTitle.value),
      suggestedStars: cleanStars(suggestedStars.value),
      generatedReview: cleanReviewText(generatedReview.value)
    };
  }

  async function generateInitialReview() {
    if (isBusy) return;
    const previousDraft = getCurrentResult();
    setBusy(true, {
      title: 'Generating Review',
      detail: `Sending review context to ${formatProviderLabel(session.provider)}...`
    });

    try {
      operationDetail.textContent = 'Generating review...';
      const result = await generateReview({
        provider: session.provider,
        model: session.model,
        comments: session.comments,
        guidance: session.guidance,
        productInfo: session.productInfo
      });

      operationDetail.textContent = 'Formatting review...';
      session.result = result;
      session.status = 'ready';
      session.iterations.push({
        createdAt: new Date().toISOString(),
        type: 'initial',
        provider: session.provider,
        model: session.model,
        result
      });
      renderResult(result);
      await saveSession();
      setStatus('Review generated.');
    } catch (error) {
      console.error('Error generating review:', error);
      session.status = 'error';
      await saveSession();
      renderResult(previousDraft);
      setStatus(`Error generating review: ${formatGenerationError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function normalizeSession() {
    session.provider = session.provider || REVIEW_AUTHOR_PROVIDER_OLLAMA;
    session.providerConfigVersion = session.providerConfigVersion || 1;
    session.iterations = Array.isArray(session.iterations) ? session.iterations : [];
    session.workspace = session.workspace || {
      feedback: '',
      missingTopics: '',
      followUpAnswers: '',
      followUpQuestions: []
    };
    session.workspace.followUpQuestions = Array.isArray(session.workspace.followUpQuestions)
      ? session.workspace.followUpQuestions
      : [];
    session.status = session.status || (session.result ? 'ready' : 'pending');
  }

  function setBusy(busy, options = {}) {
    isBusy = busy;
    workspaceShell.setAttribute('aria-busy', String(busy));
    document.body.classList.toggle('is-busy', busy);
    operationLayer.hidden = !busy;
    setControlsDisabled(busy);

    if (busy) {
      operationTitle.textContent = options.title || 'Generating Review';
      operationProvider.textContent = `${formatProviderLabel(session.provider)} | ${session.model}`;
      operationDetail.textContent = options.detail || 'Generating review...';
    }
  }

  function setControlsDisabled(disabled) {
    workspaceShell.querySelectorAll('button, input, textarea, select').forEach(control => {
      control.disabled = disabled;
    });
  }

  function setStatus(message) {
    statusLine.textContent = message;
  }
});
