const BANNED_KEY = /token|secret|password|authorization|cookie|api[-_]?key/i;
const BANNED_EXACT = new Set(["__proto__", "prototype", "constructor"]);

export function containsBannedKey(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return false;
  for (const key of Object.keys(value)) {
    if (BANNED_EXACT.has(key) || BANNED_KEY.test(key)) return true;
    if (containsBannedKey(value[key], depth + 1)) return true;
  }
  return false;
}

function prune(value, depth) {
  if (!value || typeof value !== "object" || depth > 8) return;
  for (const key of Object.keys(value)) {
    if (BANNED_EXACT.has(key) || BANNED_KEY.test(key)) {
      delete value[key];
      continue;
    }
    prune(value[key], depth + 1);
  }
}

export function omitBannedKeys(value) {
  const copy = structuredClone(value);
  prune(copy, 0);
  return copy;
}
