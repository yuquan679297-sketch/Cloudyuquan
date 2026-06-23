import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStoredBoolean,
  getStoredString,
  removeStoredValue,
  setStoredString,
} from '../.tmp-tests/browserStorage.js';

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

function installThrowingLocalStorage() {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {
        throw new Error('blocked');
      },
    },
  };
}

test('getStoredString and getStoredBoolean return safe fallbacks', () => {
  installLocalStorage({ enabled: 'true', label: 'value' });
  assert.equal(getStoredString('label'), 'value');
  assert.equal(getStoredBoolean('enabled', false), true);
  assert.equal(getStoredBoolean('missing', true), true);
});

test('storage helpers do not throw when localStorage is unavailable', () => {
  installThrowingLocalStorage();
  assert.equal(getStoredString('label'), null);
  assert.equal(getStoredBoolean('enabled', false), false);
  assert.doesNotThrow(() => setStoredString('label', 'value'));
  assert.doesNotThrow(() => removeStoredValue('label'));
});
