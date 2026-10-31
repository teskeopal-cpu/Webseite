const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup({ supported = true, failVerify = false, cancel = false, offline = false } = {}) {
  const elements = new Map();
  let codeOpened = 0;
  let patternClosed = 0;
  const requests = [];
  const context = {
    document: { getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set(['hidden']);
        elements.set(id, { disabled: false, textContent: '', focus() {},
          classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) } });
      }
      return elements.get(id);
    } },
    isSecureContext: supported,
    PublicKeyCredential: supported ? function () {} : undefined,
    SimpleWebAuthnBrowser: {
      async startRegistration() {
        if (cancel) throw Object.assign(new Error(), { name: 'NotAllowedError' });
        return { id: 'test-passkey' };
      },
      async startAuthentication() { return { id: 'test-passkey' }; },
    },
    openHostAccessModal() { codeOpened++; },
    closePatternModal() { patternClosed++; },
    async fetch(url, init) {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (offline) throw new Error('Nicht erreichbar');
      const failed = failVerify && body.action.endsWith('verify');
      return { ok: !failed, async json() { return failed ? { error: 'Nicht bestätigt' } : { options: { challenge: 'test' }, verified: true }; } };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/passkeys.js', 'utf8'), context);
  return { context, elements, requests, get codeOpened() { return codeOpened; }, get patternClosed() { return patternClosed; } };
}
test('correct pattern offers optional enrollment; skipping still requires host code', async () => {
  const app = setup();
  await app.context.offerQuizPasskey('test-pattern');
  assert.equal(app.codeOpened, 0);
  assert.equal(app.elements.get('passkey-offer-modal').classList.contains('hidden'), false);
  assert.equal(app.requests[0].action, 'register-options');
  app.context.skipQuizPasskey();
  assert.equal(app.codeOpened, 1);
});
test('registration completes only after server verification', async () => {
  const app = setup();
  await app.context.offerQuizPasskey('test-pattern');
  await app.context.createQuizPasskey();
  assert.equal(app.requests.at(-1).action, 'register-verify');
  assert.equal(app.codeOpened, 1);
});
test('cancellation permits retry or skip', async () => {
  const app = setup({ cancel: true });
  await app.context.offerQuizPasskey('test-pattern');
  await app.context.createQuizPasskey();
  assert.equal(app.codeOpened, 0);
  assert.equal(app.elements.get('passkey-skip').disabled, false);
  assert.match(app.elements.get('passkey-offer-status').textContent, /abgebrochen/);
  app.context.skipQuizPasskey();
  assert.equal(app.codeOpened, 1);
});
test('rejected passkey does not complete pattern step', async () => {
  const app = setup({ failVerify: true });
  await app.context.loginWithPasskey();
  assert.equal(app.codeOpened, 0);
  assert.equal(app.patternClosed, 0);
});
test('verified passkey proceeds to the separate host code', async () => {
  const app = setup();
  await app.context.loginWithPasskey();
  assert.equal(app.codeOpened, 1);
  assert.equal(app.patternClosed, 1);
});
test('unsupported browser keeps original flow', async () => {
  const app = setup({ supported: false });
  await app.context.offerQuizPasskey('test-pattern');
  assert.equal(app.codeOpened, 1);
  assert.equal(app.requests.length, 0);
  assert.equal(app.elements.get('passkey-login').classList.contains('hidden'), true);
});
test('service failure does not block skipping', async () => {
  const app = setup({ offline: true });
  await app.context.offerQuizPasskey('test-pattern');
  assert.equal(app.elements.get('passkey-create').disabled, false);
  app.context.skipQuizPasskey();
  assert.equal(app.codeOpened, 1);
});
test('HTML contains all controls, scripts, and success callback', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['passkey-login', 'passkey-login-status', 'passkey-offer-modal', 'passkey-create', 'passkey-skip', 'passkey-offer-status']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  const vendor = html.indexOf('src="/assets/vendor/simplewebauthn-browser.js"');
  const client = html.indexOf('src="/assets/passkeys.js"');
  assert.ok(vendor > 0 && vendor < client && client < html.indexOf('<script type="module">'));
  assert.match(html, /offerQuizPasskey\(matchedPattern\)/);
});
