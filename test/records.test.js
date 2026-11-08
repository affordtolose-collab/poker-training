import assert from "node:assert/strict";
import test from "node:test";
import { analyze, measuredTimeForDay } from "../js/analytics.js";
import { migrateLegacy } from "../js/migrate.js";
import { orderOfDay, planDay, practiceQueue } from "../js/plan.js";
import { QUESTIONS, TAGS } from "../js/questions.js";
import {
  acceptStoredState,
  createState,
  currentElapsed,
  enterQuestion,
  leaveQuestion,
  setConfidence,
  setReasoning,
  setSelection,
  setVisible,
  snapshotForStorage,
  submitOpen,
  toggleExplicitPause,
} from "../js/session.js";

const bank = Object.fromEntries(QUESTIONS.map((question) => [question.id, question]));
const ids = { n: 0 };
const nextId = (prefix) => `${prefix}-${String(ids.n += 1).padStart(4, "0")}`;

function start(questionId, now, sessionId = "session-0001") {
  const entered = enterQuestion(createState(now), {
    question: bank[questionId],
    sessionId,
    now,
    openId: nextId("open"),
  });
  return { state: entered.state, openId: entered.open.openId };
}

function answer(state, questionId, openId, optionId, now, extras = {}) {
  let next = state;
  if (extras.reasoning != null) next = setReasoning(next, questionId, extras.reasoning).state;
  if (extras.confidence != null) next = setConfidence(next, questionId, extras.confidence).state;
  next = setSelection(next, questionId, optionId).state;
  return submitOpen(next, {
    questionId,
    openId,
    now,
    question: bank[questionId],
    tagInfo: TAGS,
    attemptId: nextId("attempt"),
  });
}

test("decision time runs only while the question is visible and unpaused", () => {
  let { state, openId } = start("d1q01", 0);
  state = setVisible(state, "d1q01", false, 2000);
  state = setVisible(state, "d1q01", true, 7000);
  const submitted = answer(state, "d1q01", openId, "b", 8000, { reasoning: "同花少了", confidence: 4 });
  assert.equal(submitted.attempt.decisionTimeMs, 3000);
  assert.equal(submitted.attempt.pauseCount, 1);
  assert.equal(submitted.attempt.confidence, 4);
  assert.equal(submitted.attempt.reasoning, "同花少了");
  assert.equal(submitted.attempt.correct, false);
  assert.deepEqual(submitted.attempt.weaknessTags, ["blockers"]);
  assert.equal(currentElapsed(submitted.state, "d1q01", 38000), null);
  assert.equal(submitted.state.attempts[0].decisionTimeMs, 3000);
});

test("explicit pause is not cleared by hiding the page", () => {
  let { state, openId } = start("d1q06", 0);
  state = toggleExplicitPause(state, "d1q06", 2000);
  state = setVisible(state, "d1q06", false, 3000);
  state = setVisible(state, "d1q06", true, 8000);
  assert.equal(currentElapsed(state, "d1q06", 8000), 2000);
  assert.equal(state.opens.d1q06.clock.explicit, true);
  state = toggleExplicitPause(state, "d1q06", 9000);
  const submitted = answer(state, "d1q06", openId, "c", 10000);
  assert.equal(submitted.attempt.decisionTimeMs, 3000);
});

test("reload does not invent the time the page was closed", () => {
  let { state, openId } = start("d1q03", 0);
  state = setSelection(state, "d1q03", "b").state;
  const stored = snapshotForStorage(state, 5000);
  assert.equal(currentElapsed(state, "d1q03", 5000), 5000);
  const restored = acceptStoredState(stored, 65000, { visible: true, questionId: "d1q03" });
  assert.equal(currentElapsed(restored, "d1q03", 65000), 5000);
  assert.equal(restored.opens.d1q03.selectedOptionId, "b");
  const submitted = answer(restored, "d1q03", openId, "b", 67000);
  assert.equal(submitted.attempt.decisionTimeMs, 7000);
  assert.equal(submitted.attempt.correct, true);
  assert.deepEqual(submitted.attempt.weaknessTags, []);
});

test("leaving and coming back excludes the time spent away", () => {
  let { state, openId } = start("d1q07", 0);
  state = leaveQuestion(state, "d1q07", 3000);
  let second = enterQuestion(state, {
    question: bank.d1q08,
    sessionId: "session-0001",
    now: 3000,
    openId: nextId("open"),
  });
  assert.equal(currentElapsed(second.state, "d1q07", 8000), 3000);
  assert.equal(currentElapsed(second.state, "d1q08", 8000), 5000);
  state = leaveQuestion(second.state, "d1q08", 8000);
  const back = enterQuestion(state, {
    question: bank.d1q07,
    sessionId: "session-0001",
    now: 13000,
    openId: "ignored-open",
  });
  const submitted = answer(back.state, "d1q07", openId, "b", 15000);
  assert.equal(submitted.attempt.decisionTimeMs, 5000);
});

test("double submit and explanation time do not create or extend a record", () => {
  let { state, openId } = start("d1q05", 0);
  const first = answer(state, "d1q05", openId, "b", 4000);
  const second = submitOpen(first.state, {
    questionId: "d1q05",
    openId,
    now: 9000,
    question: { ...bank.d1q05, explanation: "被改寫的講解" },
    tagInfo: TAGS,
    attemptId: nextId("attempt"),
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.state.attempts.length, 1);
  assert.equal(second.attempt.decisionTimeMs, 4000);
  assert.equal(second.attempt.snapshot.explanation, bank.d1q05.explanation);
  assert.equal(second.attempt.strengthMisses.length, 0);
  assert.throws(() => {
    second.attempt.correct = false;
  });
  assert.throws(() => {
    second.attempt.snapshot.explanation = "hacked";
  });
});

test("a retry is a new immutable attempt and a wrong pot-odds answer is not labeled only as a weakness tag", () => {
  let { state, openId } = start("d1q05", 0);
  const wrong = answer(state, "d1q05", openId, "a", 1000);
  const again = enterQuestion(wrong.state, {
    question: bank.d1q05,
    sessionId: "session-0001",
    now: 30000,
    openId: nextId("open"),
  });
  const right = answer(again.state, "d1q05", again.open.openId, "b", 32000);
  assert.equal(right.state.attempts.length, 2);
  assert.deepEqual(right.state.attempts.map((attempt) => attempt.attemptNumber), [1, 2]);
  assert.equal(right.state.attempts[0].decisionTimeMs, 1000);
  assert.equal(right.state.attempts[1].decisionTimeMs, 2000);
  assert.deepEqual(wrong.attempt.weaknessTags, ["combos"]);
  assert.deepEqual(wrong.attempt.strengthMisses, ["pot-odds"]);
  assert.equal(wrong.attempt.weaknessTags.includes("slow"), false);
});

test("legacy progress keeps the boolean and leaves answers and times unknown", () => {
  const first = migrateLegacy(createState(10), {
    0: { 0: true, 1: false, 2: "not-a-boolean" },
    2: { 11: false, 20: true },
    9: { 0: false },
  }, QUESTIONS, { now: 10, attemptId: (key) => `legacykey-${key}` });
  assert.equal(first.imported, 5);
  const rows = first.state.attempts;
  assert.equal(rows[0].questionId, "d1q01");
  assert.equal(rows[0].legacyMarkedCorrect, true);
  assert.equal(rows[0].correct, null);
  assert.equal(rows[0].correctnessStatus, "unknown");
  assert.equal(rows[0].selectedOptionId, null);
  assert.equal(rows[0].decisionTimeMs, null);
  assert.equal(rows[0].decisionTimeStatus, "unknown");
  assert.equal(rows[0].snapshot, null);
  assert.equal(rows[0].snapshotStatus, "unavailable");
  assert.equal(rows[0].displayedAt, null);
  assert.equal(rows[0].submittedAt, null);
  assert.equal(rows[0].attemptNumber, null);
  assert.equal(rows[1].questionId, "d1q02");
  assert.equal(rows[2].questionId, "d3q12");
  assert.equal(rows[3].questionId, "legacy-d2-i20");
  assert.equal(rows[4].questionId, "legacy-d9-i0");
  assert.equal(rows[4].day, null);
  const second = migrateLegacy(first.state, { 0: { 0: false } }, QUESTIONS, {
    now: 20,
    attemptId: (key) => `legacykey-${key}`,
  });
  assert.equal(second.skipped, true);
  assert.equal(second.state.attempts.length, 5);
  const forced = migrateLegacy(first.state, { 0: { 3: true } }, QUESTIONS, {
    now: 30,
    force: true,
    attemptId: (key) => `legacykey-${key}-b`,
  });
  assert.equal(forced.imported, 1);
  assert.equal(forced.state.attempts.filter((attempt) => attempt.questionId === "d1q01").length, 1);
  const broken = migrateLegacy(createState(0), [], QUESTIONS, { now: 0, attemptId: (key) => `legacykey-${key}` });
  assert.equal(broken.error, "UNREADABLE");
  assert.equal(broken.state.meta.legacyMigrated, false);
  assert.equal(broken.state.attempts.length, 0);
});

test("review uses real misses, and slow correct answers stay out of the weakness list", () => {
  let state = createState(0);
  const specs = [
    ["d1q01", "a", 10000, 0],
    ["d1q02", "a", 21000, 11000],
    ["d1q03", "b", 32000, 22000],
    ["d1q04", "a", 43000, 33000],
    ["d1q06", "c", 84000, 44000],
    ["d1q07", "a", 90000, 85000],
  ];
  for (const [questionId, optionId, at, from] of specs) {
    const opened = enterQuestion(state, {
      question: bank[questionId],
      sessionId: "session-0001",
      now: from,
      openId: nextId("open"),
    });
    const submitted = answer(opened.state, questionId, opened.open.openId, optionId, at);
    state = submitted.state;
  }
  const report = analyze(state.attempts, QUESTIONS);
  assert.equal(report.urgent.length, 1);
  assert.equal(report.urgent[0].questionId, "d1q07");
  assert.equal(report.urgent[0].countsAsWeakness, true);
  assert.equal(report.slowCorrect.length, 1);
  assert.equal(report.slowCorrect[0].questionId, "d1q06");
  assert.equal(report.slowCorrect[0].countsAsWeakness, false);
  assert.deepEqual(report.slowCorrect[0].weaknessTags, []);
  assert.equal(report.byTag.aggression.misses, 1);
  assert.equal(report.byTag.aggression.attempts, 2);
  const tooFew = analyze(state.attempts.slice(0, 3), QUESTIONS);
  assert.equal(tooFew.slowCutMs, null);
  assert.equal(tooFew.slowCorrect.length, 0);
  const plan = planDay(QUESTIONS, state.attempts, 1);
  assert.deepEqual(plan.wrong.map((question) => question.id), ["d1q07"]);
  assert.equal(plan.mastered.some((question) => question.id === "d1q06"), true);
  const legacy = migrateLegacy(state, { 0: { 8: false } }, QUESTIONS, {
    now: 9000,
    force: true,
    attemptId: (key) => `legacykey-${key}`,
  }).state;
  const replanned = planDay(QUESTIONS, legacy.attempts, 1);
  assert.deepEqual(replanned.legacyOnly.map((question) => question.id), ["d1q09"]);
  assert.equal(replanned.wrong.some((question) => question.id === "d1q09"), false);
  assert.deepEqual(replanned.playlist.slice(0, 2), [bank.d1q07, bank.d1q09]);
  assert.equal(orderOfDay(QUESTIONS, 1)[0], "d1q01");
  assert.deepEqual(practiceQueue(QUESTIONS, legacy.attempts, 1, "records").slice(0, 2), ["d1q07", "d1q09"]);
  assert.equal(practiceQueue(QUESTIONS, legacy.attempts, 1, "order")[0], "d1q01");
  assert.equal(measuredTimeForDay(state.attempts, 1, 5000, () => "same"), state.attempts.reduce((sum, attempt) => sum + attempt.decisionTimeMs, 0));
});
