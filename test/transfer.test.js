import assert from "node:assert/strict";
import test from "node:test";
import { createState, enterQuestion, setReasoning, setSelection, submitOpen } from "../js/session.js";
import { adoptState } from "../js/session.js";
import { QUESTIONS, TAGS } from "../js/questions.js";
import { exportCsv, exportDocument, importDocument, parseImport } from "../js/transfer.js";
import { migrateLegacy } from "../js/migrate.js";

function submittedState(reasoning = null) {
  const question = QUESTIONS[0];
  const entered = enterQuestion(createState(0), {
    question,
    sessionId: "session-0001",
    now: 0,
    openId: "open-00001",
  });
  let state = setSelection(entered.state, question.id, "b").state;
  if (reasoning != null) state = setReasoning(state, question.id, reasoning).state;
  return submitOpen(state, {
    questionId: question.id,
    openId: "open-00001",
    now: 1500,
    question,
    tagInfo: TAGS,
    attemptId: "attempt-0001",
  }).state;
}

test("json export round-trips and refuses conflicts, secrets, and broken files", () => {
  const state = submittedState();
  const document = exportDocument(state, "2026-11-08T00:00:00.000Z");
  assert.equal(document.schema, "poker-training.records");
  assert.equal(JSON.stringify(document).includes("token"), false);
  const empty = adoptState(createState(0));
  const imported = importDocument(empty, document);
  assert.equal(imported.ok, true);
  assert.equal(imported.imported, 1);
  const again = importDocument(adoptState(imported.state), document);
  assert.equal(again.ok, true);
  assert.equal(again.skipped, 1);
  assert.equal(again.imported, 0);
  const tampered = structuredClone(document);
  tampered.attempts[0].selectedOptionId = "a";
  tampered.attempts[0].correct = true;
  const conflict = importDocument(adoptState(imported.state), tampered);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors[0].code, "CONFLICT");
  const secret = structuredClone(document);
  secret.accessToken = "should-not-travel";
  const rejected = importDocument(empty, secret);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors[0].code, "BANNED_KEY");
  const poisoned = JSON.parse('{"schema":"poker-training.records","version":1,"attempts":[],"__proto__":{"admin":true}}');
  assert.equal(importDocument(empty, poisoned).ok, false);
  const huge = parseImport(`{${" ".repeat(20)}}`, { maxChars: 10 });
  assert.equal(huge.ok, false);
  assert.equal(huge.errors[0].code, "SIZE");
});

test("csv escapes formulas, imports without snapshots, and does not overwrite a richer json record", () => {
  const state = submittedState("=1+1");
  const csv = exportCsv(state);
  assert.match(csv, /'=1\+1/);
  const parsed = parseImport(csv);
  assert.equal(parsed.format, "csv");
  const imported = importDocument(adoptState(createState(0)), parsed.data);
  assert.equal(imported.ok, true);
  assert.equal(imported.state.attempts[0].reasoning, "=1+1");
  assert.equal(imported.state.attempts[0].snapshotStatus, "unavailable");
  assert.equal(imported.state.attempts[0].snapshot, null);
  assert.equal(imported.state.attempts[0].correct, false);
  const ontoJson = importDocument(state, parsed.data);
  assert.equal(ontoJson.ok, false);
  assert.equal(ontoJson.errors[0].code, "CONFLICT");
});

test("legacy records survive a json round-trip without gaining a made-up time", () => {
  const migrated = migrateLegacy(createState(5), { 0: { 0: true } }, QUESTIONS, {
    now: 5,
    attemptId: (key) => `legacykey-${key}`,
  });
  const imported = importDocument(adoptState(createState(0)), exportDocument(migrated.state, "2026-11-08T00:00:00.000Z"));
  assert.equal(imported.ok, true);
  const row = imported.state.attempts[0];
  assert.equal(row.legacyMarkedCorrect, true);
  assert.equal(row.decisionTimeStatus, "unknown");
  assert.equal(row.decisionTimeMs, null);
  assert.equal(row.snapshotStatus, "unavailable");
  assert.equal(row.selectedOptionId, null);
});
