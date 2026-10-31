(() => {
  const supported = window.isSecureContext && !!window.PublicKeyCredential && !!window.SimpleWebAuthnBrowser;
  const loginButton = document.getElementById('passkey-login');
  const loginStatus = document.getElementById('passkey-login-status');
  const modal = document.getElementById('passkey-offer-modal');
  const createButton = document.getElementById('passkey-create');
  const skipButton = document.getElementById('passkey-skip');
  const status = document.getElementById('passkey-offer-status');
  let options = null;
  let generation = 0;
  let creating = false;
  let prepareRetry = null;
  if (supported) loginButton.classList.remove('hidden');

  async function api(action, data = {}) {
    const response = await fetch('/api/passkeys', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Passkey-Dienst ist gerade nicht erreichbar.');
    return result;
  }
  function errorText(error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      return 'Passkey-Vorgang abgebrochen oder abgelaufen. Du kannst es erneut versuchen oder überspringen.';
    }
    if (error.name === 'InvalidStateError') return 'Ein solcher Passkey besteht bereits. Du kannst mit dem Zugangscode fortfahren.';
    return error.message || 'Passkeys sind hier gerade nicht verfügbar.';
  }
  function continueToCode() {
    generation++;
    options = null;
    prepareRetry = null;
    modal.classList.add('hidden');
    window.openHostAccessModal();
  }
  window.skipQuizPasskey = () => {
    if (!creating) continueToCode();
  };
  window.offerQuizPasskey = async pattern => {
    if (!supported) {
      window.openHostAccessModal();
      return;
    }
    modal.classList.remove('hidden');
    createButton.disabled = true;
    skipButton.disabled = false;
    creating = false;
    options = null;
    const attempt = ++generation;
    async function prepare(keepMessage = false) {
      if (!keepMessage) status.textContent = 'Passkey-Einrichtung wird vorbereitet …';
      createButton.disabled = true;
      try {
        const result = await api('register-options', { pattern });
        if (generation !== attempt) return;
        options = result.options;
        createButton.textContent = 'Passkey einrichten';
        if (!keepMessage) status.textContent = 'Optional: Dein Gerät fragt dich nach der Bestätigung.';
      } catch (error) {
        if (generation !== attempt) return;
        options = null;
        status.textContent = errorText(error) + ' Du kannst weiterhin den Zugangscode verwenden.';
        createButton.textContent = 'Vorbereitung erneut versuchen';
      } finally {
        if (generation === attempt) createButton.disabled = false;
      }
    }
    prepareRetry = prepare;
    skipButton.focus();
    await prepare();
  };
  window.createQuizPasskey = async () => {
    if (creating || createButton.disabled) return;
    if (!options) {
      await prepareRetry?.();
      return;
    }
    creating = true;
    createButton.disabled = true;
    skipButton.disabled = true;
    status.textContent = 'Bestätige die Passkey-Erstellung auf deinem Gerät …';
    try {
      // Options are already loaded: creation follows the tap directly, including on Safari.
      const response = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
      const result = await api('register-verify', { response });
      if (!result.verified) throw new Error('Passkey wurde nicht bestätigt.');
      continueToCode();
      window.showAppToast?.('Passkey eingerichtet. Jetzt noch den Host-Zugangscode eingeben.');
    } catch (error) {
      status.textContent = errorText(error);
      options = null;
      await prepareRetry?.(true);
    } finally {
      creating = false;
      createButton.disabled = false;
      skipButton.disabled = false;
    }
  };
  window.loginWithPasskey = async () => {
    if (!supported || loginButton.disabled) return;
    loginButton.disabled = true;
    loginStatus.textContent = 'Passkey wird angefragt …';
    try {
      const { options } = await api('login-options');
      const response = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
      const result = await api('login-verify', { response });
      if (!result.verified) throw new Error('Passkey wurde nicht bestätigt.');
      window.closePatternModal();
      loginStatus.textContent = '';
      window.openHostAccessModal();
    } catch (error) {
      loginStatus.textContent = errorText(error) + ' Das Muster bleibt verfügbar.';
    } finally {
      loginButton.disabled = false;
    }
  };
})();
