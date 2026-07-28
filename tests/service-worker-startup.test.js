const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function createStorageArea() {
  return {
    async get() {
      return {};
    },
    async set() {},
    async remove() {},
    async setAccessLevel() {}
  };
}

function loadServiceWorker() {
  const messageListeners = [];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextDecoder,
    Uint8Array,
    fetch: async () => {
      throw new Error('Network access is not expected during startup.');
    },
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: {
          addListener(listener) {
            messageListeners.push(listener);
          }
        },
        getPlatformInfo: async () => ({ os: 'linux' })
      },
      storage: {
        local: createStorageArea(),
        session: createStorageArea()
      }
    }
  });

  context.importScripts = (...files) => {
    files.forEach(file => {
      const code = fs.readFileSync(path.join(projectRoot, file), 'utf8');
      vm.runInContext(code, context, { filename: file });
    });
  };

  const serviceWorker = fs.readFileSync(path.join(projectRoot, 'service-worker.js'), 'utf8');
  vm.runInContext(serviceWorker, context, { filename: 'service-worker.js' });

  return { messageListeners };
}

test('service worker loads provider scripts and registers a message listener', async () => {
  const { messageListeners } = loadServiceWorker();
  assert.equal(messageListeners.length, 1);

  const response = await new Promise(resolve => {
    const keepsChannelOpen = messageListeners[0](
      { type: 'provider.listModels', provider: 'gemini' },
      {},
      resolve
    );
    assert.equal(keepsChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    response.data.map(model => model.id),
    ['gemini-3.6-flash', 'gemini-3.5-flash-lite']
  );
});
