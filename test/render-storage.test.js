import assert from "node:assert/strict";
import test from "node:test";
import { createStorage, mergeStates, STORAGE_KEYS } from "../js/storage.js";
import { adoptState, createState } from "../js/session.js";
import { renderAttempt } from "../js/render.js";
import { pullRecords, pushRecords } from "../js/sync.js";

function fakeDocument() {
  const innerHTMLSets = [];
  class Node {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.childNodes = [];
      this.attrs = {};
      this.className = "";
      this._text = "";
    }
    set textContent(value) {
      this._text = String(value);
      this.childNodes = [];
    }
    get textContent() {
      if (this.childNodes.length) return this.childNodes.map((child) => child.textContent || "").join("");
      return this._text;
    }
    set innerHTML(value) {
      innerHTMLSets.push(value);
    }
    append(...children) {
      this.childNodes.push(...children);
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    addEventListener() {}
  }
  class Text {
    constructor(data) {
      this.nodeType = 3;
      this.data = String(data);
    }
    get textContent() {
      return this.data;
    }
  }
  return {
    innerHTMLSets,
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new Text(text),
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

test("rendered records keep script text as text", () => {
  const doc = fakeDocument();
  const malicious = "<script>alert(1)</script><img src=x onerror=alert(1)>";
  const attempt = {
    source: "session",
    correct: false,
    correctnessStatus: "known",
    snapshotStatus: "captured",
    snapshot: {
      prompt: malicious,
      explanation: malicious,
      options: [
        { id: "a", text: malicious },
        { id: "b", text: "棄牌" },
      ],
      correctOptionId: "b",
    },
    selectedOptionId: "a",
    correctOptionId: "b",
    decisionTimeStatus: "measured",
    decisionTimeMs: 4200,
    pauseCount: 0,
    reasoning: malicious,
    confidence: 2,
    weaknessTags: ["blockers"],
  };
  const view = renderAttempt(doc, attempt, { prompt: "目前題庫不該蓋過快照" });
  const tags = [];
  let text = "";
  walk(view, (node) => {
    if (node.tagName) tags.push(node.tagName);
    text += node.data || "";
  });
  assert.equal(tags.includes("SCRIPT"), false);
  assert.equal(tags.includes("IMG"), false);
  assert.equal(doc.innerHTMLSets.length, 0);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.equal(text.includes("目前題庫不該蓋過快照"), false);
  const legacy = renderAttempt(doc, {
    source: "legacy-pkt",
    correct: null,
    correctnessStatus: "unknown",
    legacyMarkedCorrect: false,
    snapshotStatus: "unavailable",
    snapshot: null,
    selectedOptionId: null,
    decisionTimeStatus: "unknown",
    decisionTimeMs: null,
    weaknessTags: [],
  }, { prompt: "現在的題目" });
  assert.match(legacy.textContent, /未記錄/);
  assert.match(legacy.textContent, /未知/);
  assert.match(legacy.textContent, /舊版記為答錯/);
  assert.match(legacy.textContent, /不是那一次看到的內容/);
});

test("local and indexed stores merge without dropping either side or the legacy key", async () => {
  const memory = new Map();
  const localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      if (localStorage.fail) throw new Error("quota");
      memory.set(key, value);
    },
  };
  const idb = {
    data: null,
    async get() {
      if (this.fail) throw new Error("idb");
      return this.data;
    },
    async set(value) {
      if (this.fail) throw new Error("idb");
      this.data = value;
    },
  };
  memory.set(STORAGE_KEYS.legacy, JSON.stringify({ 0: { 0: true } }));
  const storage = createStorage({ localStorage, idb });
  const left = adoptState({
    ...createState(10),
    meta: { ...createState(10).meta, updatedAt: 10, legacyMigrated: true },
    attempts: [{ attemptId: "attempt-0001", correct: true }],
  });
  idb.fail = true;
  const saved = await storage.save(left);
  assert.equal(saved.localStorage, "ok");
  assert.equal(saved.indexedDB, "failed");
  assert.equal(memory.get(STORAGE_KEYS.legacy), JSON.stringify({ 0: { 0: true } }));
  idb.fail = false;
  idb.data = {
    meta: { updatedAt: 20, conflictArchive: [] },
    attempts: [{ attemptId: "attempt-0002", correct: false }],
    sessions: [],
    opens: {},
  };
  const loaded = await storage.load();
  assert.equal(loaded.state.attempts.length, 2);
  const conflict = mergeStates(
    { meta: { updatedAt: 30, conflictArchive: [] }, attempts: [{ attemptId: "same", answer: 1 }], sessions: [], opens: {} },
    { meta: { updatedAt: 10, conflictArchive: [] }, attempts: [{ attemptId: "same", answer: 2 }], sessions: [], opens: {} },
  );
  assert.equal(conflict.attempts.length, 1);
  assert.equal(conflict.attempts[0].answer, 1);
  assert.equal(conflict.meta.conflictArchive.length, 1);
  assert.equal(conflict.meta.conflictArchive[0].body.answer, 2);
});

test("automatic sync is blocked and does not call the network", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.resolve();
  };
  try {
    const pushed = await pushRecords([{ attemptId: "attempt-0001" }]);
    const pulled = await pullRecords();
    assert.equal(pushed.ok, false);
    assert.equal(pushed.code, "NO_PRIVATE_BACKEND");
    assert.equal(pushed.automaticSync, false);
    assert.equal(pulled.connected, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
