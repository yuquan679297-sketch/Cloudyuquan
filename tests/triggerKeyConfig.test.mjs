import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRIGGER_KEY_CONFIG,
  DEFAULT_TRIGGER_KEY_ENABLED,
  TRIGGER_KEY_ENABLED_STORAGE_KEY,
  TRIGGER_KEY_STORAGE_KEY,
  isTriggerKeyConfig,
  loadTriggerKeyConfig,
  loadTriggerKeyEnabled,
  saveTriggerKeyConfig,
  saveTriggerKeyEnabled,
} from '../.tmp-tests/triggerKeyConfig.js';

function installLocalStorage(initialState = {}) {
  const store = new Map(Object.entries(initialState));
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

function installFailingLocalStorage() {
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {},
    },
  };
}

test('isTriggerKeyConfig accepts valid mouse config and rejects primary mouse button', () => {
  assert.equal(isTriggerKeyConfig({
    source: 'mouse',
    value: 'Mouse Button 4',
    button: 4,
    triggerKeyCode: 'mouse:4',
    triggerKeyName: '鼠标侧键2',
  }), true);
  assert.equal(isTriggerKeyConfig({
    source: 'mouse',
    value: 'Mouse Button 1',
    button: 1,
    triggerKeyCode: 'mouse:1',
    triggerKeyName: '左键',
  }), false);
});

test('loadTriggerKeyConfig falls back to default for invalid stored value', () => {
  installLocalStorage({
    [TRIGGER_KEY_STORAGE_KEY]: JSON.stringify({ source: 'mouse', button: 2 }),
  });
  assert.deepEqual(loadTriggerKeyConfig(), DEFAULT_TRIGGER_KEY_CONFIG);
});

test('save/load trigger key config round-trips through localStorage', () => {
  const store = installLocalStorage();
  const config = {
    source: 'keyboard',
    value: 'Command+Shift+K',
    triggerKeyCode: 'keyboard:Command+Shift+K',
    triggerKeyName: 'Command+Shift+K',
  };
  saveTriggerKeyConfig(config);
  assert.equal(store.get(TRIGGER_KEY_STORAGE_KEY), JSON.stringify(config));
  assert.deepEqual(loadTriggerKeyConfig(), config);
});

test('loadTriggerKeyEnabled uses default and saved boolean values', () => {
  installLocalStorage();
  assert.equal(loadTriggerKeyEnabled(), DEFAULT_TRIGGER_KEY_ENABLED);

  const store = installLocalStorage();
  saveTriggerKeyEnabled(false);
  assert.equal(store.get(TRIGGER_KEY_ENABLED_STORAGE_KEY), 'false');
  assert.equal(loadTriggerKeyEnabled(), false);
});

test('saveTriggerKeyConfig does not throw when localStorage write fails', () => {
  installFailingLocalStorage();
  assert.doesNotThrow(() => saveTriggerKeyConfig(DEFAULT_TRIGGER_KEY_CONFIG));
});

test('saveTriggerKeyEnabled does not throw when localStorage write fails', () => {
  installFailingLocalStorage();
  assert.doesNotThrow(() => saveTriggerKeyEnabled(false));
});
