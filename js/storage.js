const LS_KEY = "pkt.v2";

function stable(attempt) {
  return JSON.stringify(attempt);
}

export function mergeStates(left, right) {
  if (!left) return right ? structuredClone(right) : null;
  if (!right) return structuredClone(left);
  const primary = (left.meta?.updatedAt || 0) >= (right.meta?.updatedAt || 0) ? left : right;
  const secondary = primary === left ? right : left;
  const next = structuredClone(primary);
  next.attempts = Array.isArray(next.attempts) ? next.attempts : [];
  next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
  next.meta.conflictArchive = Array.isArray(next.meta.conflictArchive) ? next.meta.conflictArchive : [];
  const seen = new Map(next.attempts.map((attempt) => [attempt.attemptId, attempt]));
  for (const attempt of secondary.attempts || []) {
    const previous = seen.get(attempt.attemptId);
    if (!previous) {
      next.attempts.push(structuredClone(attempt));
      seen.set(attempt.attemptId, attempt);
    } else if (stable(previous) !== stable(attempt)) {
      next.meta.conflictArchive.push({
        attemptId: attempt.attemptId,
        kept: "newer-save",
        body: structuredClone(attempt),
      });
    }
  }
  for (const item of secondary.meta?.conflictArchive || []) next.meta.conflictArchive.push(structuredClone(item));
  return next;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("poker-training", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function defaultIdb() {
  return {
    async get() {
      if (typeof indexedDB === "undefined") throw new Error("no-idb");
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readonly");
        const request = tx.objectStore("kv").get("state");
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    },
    async set(value) {
      if (typeof indexedDB === "undefined") throw new Error("no-idb");
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        const request = tx.objectStore("kv").put(value, "state");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
  };
}

export function createStorage(deps = {}) {
  const localStorage = deps.localStorage ?? globalThis.localStorage;
  const idb = deps.idb ?? defaultIdb();
  return {
    async load() {
      const status = { localStorage: "ok", indexedDB: "ok" };
      let fromLocal = null;
      let fromIdb = null;
      try {
        const raw = localStorage.getItem(LS_KEY);
        fromLocal = raw ? JSON.parse(raw) : null;
      } catch {
        status.localStorage = "failed";
      }
      try {
        fromIdb = await Promise.race([
          idb.get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
      } catch {
        status.indexedDB = "unavailable";
      }
      return { state: mergeStates(fromLocal, fromIdb), status };
    },
    saveSync(state) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
        return { localStorage: "ok" };
      } catch {
        return { localStorage: "failed" };
      }
    },
    async save(state, stillCurrent = () => true) {
      const status = { localStorage: "ok", indexedDB: "ok", lastSavedAt: null };
      try {
        if (!stillCurrent()) return status;
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      } catch {
        status.localStorage = "failed";
      }
      try {
        if (!stillCurrent()) return status;
        await Promise.race([
          idb.set(state),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
      } catch {
        status.indexedDB = "failed";
      }
      if (status.localStorage === "ok" || status.indexedDB === "ok") status.lastSavedAt = state.meta?.updatedAt ?? Date.now();
      return status;
    },
  };
}

export const STORAGE_KEYS = { records: LS_KEY, legacy: "pkt" };
