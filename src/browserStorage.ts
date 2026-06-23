export function getStoredString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getStoredBoolean(key: string, defaultValue: boolean) {
  const storedValue = getStoredString(key);
  if (storedValue === null) {
    return defaultValue;
  }

  return storedValue === 'true';
}

export function setStoredString(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local persistence is optional; failing to save should not interrupt the app flow.
  }
}

export function removeStoredValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local persistence is optional; failing to clear should not interrupt the app flow.
  }
}
