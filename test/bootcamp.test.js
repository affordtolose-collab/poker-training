import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { combination, drawEquity, pairCombos, requiredCallEquity, shownPercent } from "../js/combos.js";
import {
  BOOT_DAYS,
  BOOT_QUESTIONS,
  continueTarget,
  dayCoreStatus,
  freshAccuracy,
  reviewChoice,
} from "../js/bootcamp.js";
import { QUESTIONS } from "../js/questions.js";
import { createState, enterQuestion, setDayNote, setSelection, submitOpen } from "../js/session.js";
import { TAGS } from "../js/questions.js";
import { exportDocument, importDocument } from "../js/transfer.js";
import { adoptState } from "../js/session.js";
import { verifyQuestion } from "../js/verify.js";

const CORE = BOOT_QUESTIONS.filter((question) => question.role === "core");
const KNOWN = new Set(["bluffcatch", "flush", "pair", "outs"]);

function cardsOk(cards) {
  const seen = new Set();
  for (const card of cards) {
    if (!/^[AKQJT2-9][shdc]$/.test(card) || seen.has(card)) return false;
    seen.add(card);
  }
  return true;
}

test("nineteen days from 8 November through 26 November with 80 fresh questions", () => {
  assert.equal(BOOT_DAYS.length, 19);
  assert.deepEqual(BOOT_DAYS.map((day) => day.date), Array.from({ length: 19 }, (_, index) => `2026-11-${String(index + 8).padStart(2, "0")}`));
  assert.equal(CORE.length, 80);
  assert.equal(new Set(CORE.map((question) => question.id)).size, 80);
  assert.equal(BOOT_DAYS.filter((day) => day.kind === "test").every((day) => day.coreIds.length === 6), true);
  assert.equal(bootCount("2026-11-26"), 4);
  for (const day of BOOT_DAYS) {
    assert.equal(day.minutes, 30);
    assert.equal(day.schedule.reduce((sum, block) => sum + block.minutes, 0), 30);
    if (day.kind === "study") assert.deepEqual(day.schedule.map((block) => block.minutes), [5, 15, 8, 2]);
  }
  const foundationIds = new Set(QUESTIONS.map((question) => question.id));
  for (const question of BOOT_QUESTIONS) assert.equal(foundationIds.has(question.id), false);
});

test("cards, stacks and numeric answers stay internally consistent", () => {
  const seen = new Set();
  for (const question of BOOT_QUESTIONS) {
    assert.equal(cardsOk([...(question.board || []), ...(question.hand || [])]), true, question.id);
    assert.match(question.spot, /人桌假設/);
    assert.match(question.spot, /有效籌碼/);
    assert.ok(question.explanation.length > 20, question.id);
    const key = `${question.board.join(",")}|${question.hand?.join(",") || ""}|${question.prompt}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
    if (question.model?.type === "bluffcatch") {
      const equity = shownPercent(requiredCallEquity(question.model.pot, question.model.bet));
      const share = shownPercent(question.model.bluff / (question.model.value + question.model.bluff));
      assert.match(question.explanation, new RegExp(`(?<![0-9])${equity}(?![0-9])`));
      assert.match(question.explanation, new RegExp(`(?<![0-9])${share}(?![0-9])`));
    }
    if (question.model?.type === "spr") {
      assert.match(question.explanation, new RegExp(`(?<![0-9])${question.model.shown}(?![0-9])`));
      assert.equal(question.model.shown, Math.round(question.model.stack / question.model.pot));
    }
    if (question.model?.type === "pot") {
      assert.equal(question.model.pot, question.model.chips.reduce((sum, chip) => sum + chip, 0));
    }
    if (question.model?.type === "pair") {
      assert.equal(pairCombos(question.model.left), Number(question.options[0].text.replace(" 組", "")));
    }
    if (question.model?.type === "outs") {
      const percent = shownPercent(drawEquity(question.model.outs, question.model.unseen, question.model.cards || 2));
      assert.match(question.explanation, new RegExp(`(?<![0-9])${percent}(?![0-9])`));
    }
    if (question.model?.type === "flush") {
      const full = combination(question.model.suitLeft, 2);
      assert.match(question.explanation, new RegExp(`(?<![0-9])${full}(?![0-9])`));
    }
    if (KNOWN.has(question.model?.type)) assert.deepEqual(verifyQuestion(question), [], question.id);
    assert.ok(question.acceptedOptionIds.includes(question.correctOptionId));
  }
});

test("old three-day results do not finish a bootcamp day or the fresh test", () => {
  const day = BOOT_DAYS[0];
  const foundationAttempt = {
    questionId: "d1q01",
    source: "legacy-pkt",
    correctnessStatus: "unknown",
    courseId: "foundation",
  };
  assert.equal(dayCoreStatus([foundationAttempt], day.coreIds).complete, false);
  const first = {
    questionId: day.coreIds[0],
    source: "session",
    courseId: "bootcamp",
    correctnessStatus: "known",
    correct: false,
    attemptNumber: 1,
    attemptNumberStatus: "known",
    submittedAt: 10,
  };
  const retry = { ...first, correct: true, attemptNumber: 2, submittedAt: 20 };
  assert.equal(dayCoreStatus([first], day.coreIds).done, 1);
  const testIds = BOOT_DAYS.find((item) => item.date === "2026-11-24").coreIds;
  const fresh = freshAccuracy([
    { ...first, questionId: testIds[0] },
    { ...retry, questionId: testIds[0] },
  ], testIds);
  assert.equal(fresh.seen, 1);
  assert.equal(fresh.correct, 0);
  assert.equal(reviewChoice(BOOT_QUESTIONS, [], "2026-11-08").reason, "baseline");
  assert.equal(reviewChoice(BOOT_QUESTIONS, [first], "2026-11-09").reason, "prior-wrong");
  assert.equal(continueTarget([], {}, "2026-11-08").date, "2026-11-08");
});

test("notes stay local in the export and the public course does not hard-code a personal loss cap", () => {
  let state = createState(0);
  state = setDayNote(state, "2026-11-26", "上桌前先看位置", 5);
  const question = BOOT_QUESTIONS.find((item) => item.role === "core");
  const entered = enterQuestion(state, { question, sessionId: "session-0001", now: 0, openId: "open-boot01" });
  const selected = setSelection(entered.state, question.id, question.options[0].id);
  const submitted = submitOpen(selected.state, {
    questionId: question.id,
    openId: "open-boot01",
    now: 1000,
    question,
    tagInfo: TAGS,
    attemptId: "attempt-boot1",
  });
  assert.equal(submitted.attempt.courseId, "bootcamp");
  assert.equal(submitted.attempt.decisionTimeMs, 1000);
  const document = exportDocument(submitted.state, "2026-11-08T00:00:00.000Z");
  assert.equal(document.notes["2026-11-26"].text, "上桌前先看位置");
  assert.equal(document.settings.lossCapText, "");
  const imported = importDocument(adoptState(createState(0)), document);
  assert.equal(imported.ok, true);
  assert.equal(imported.state.notes["2026-11-26"].text, "上桌前先看位置");
  const source = fs.readFileSync(new URL("../js/bootcamp.js", import.meta.url), "utf8")
    + fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.equal(source.includes("10000000"), false);
  assert.equal(source.includes("一千萬"), false);
  assert.equal(source.includes("1000萬"), false);
});

function bootCount(date) {
  return BOOT_DAYS.find((day) => day.date === date).coreIds.length;
}
