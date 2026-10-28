// Node's experimental localStorage may shadow the DOM implementation. Keep
// each DOM test file's storage independent, without loading application setup.
if (typeof window !== "undefined") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}
