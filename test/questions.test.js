import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { combination, drawEquity, pairCombos, requiredCallEquity } from "../js/combos.js";
import { QUESTIONS } from "../js/questions.js";
import { verifyQuestion } from "../js/verify.js";

const legacy = JSON.parse(fs.readFileSync(new URL("../data/legacy-bank.json", import.meta.url), "utf8"));

test("combo formulas used by the question checks", () => {
  assert.equal(combination(47, 2), 1081);
  assert.equal(combination(32, 2), 496);
  assert.equal(combination(11, 2), 55);
  assert.equal(combination(10, 2), 45);
  assert.equal(combination(9, 2), 36);
  assert.equal(pairCombos(4), 6);
  assert.equal(pairCombos(3), 3);
  assert.equal(pairCombos(2), 1);
  assert.equal(requiredCallEquity(100, 75), 0.3);
  assert.equal(requiredCallEquity(1, 1), 1 / 3);
  assert.equal(requiredCallEquity(1, 0.5), 0.25);
  assert.ok(Math.abs(drawEquity(15, 47) - (1 - 496 / 1081)) < 1e-12);
});

test("question bank keeps the 3-day curriculum and verifies every counted claim", () => {
  assert.equal(QUESTIONS.length, 36);
  for (const day of [1, 2, 3]) {
    assert.equal(QUESTIONS.filter((question) => question.day === day).length, 12);
  }
  const ids = new Set();
  legacy.DAYS.forEach((day, dayIndex) => {
    day.q.forEach((original, index) => {
      const question = QUESTIONS.find((item) => item.legacyDay === dayIndex && item.legacyIndex === index);
      assert.ok(question, `missing d${dayIndex + 1}q${index + 1}`);
      assert.equal(ids.has(question.id), false);
      ids.add(question.id);
      assert.equal(question.spot, original.s);
      assert.equal(question.prompt, original.q);
      assert.deepEqual(question.options.map((option) => option.text), original.o);
      assert.equal(question.correctOptionId, "abc"[original.a]);
      assert.equal(question.legacyCategory, original.c);
      assert.deepEqual(question.hand, original.h);
      if (question.id !== "d3q12") assert.deepEqual(question.board, original.b);
      const errors = verifyQuestion(question);
      assert.deepEqual(errors, [], `${question.id} ${errors.join(",")}`);
    });
  });
  const fixed = QUESTIONS.find((question) => question.id === "d3q12");
  assert.deepEqual(fixed.board, ["Ks", "Js", "6d", "4c", "9s"]);
  assert.equal(fixed.board.filter((card) => card[1] === "s").length, 3);
  assert.equal(legacy.DAYS[2].q[11].b.filter((card) => card[1] === "s").length, 2);
});
