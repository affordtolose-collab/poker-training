import {
  combination,
  drawEquity,
  pairCombos,
  requiredCallEquity,
  shownPercent,
} from "./combos.js";

const BANNED_PHRASES = [
  "各少了 4 組中的 1/4",
  "約 50% 勝率",
  "沒有阻擋對手會棄的聽牌（T9、Q9、黑桃聽牌）",
  "抓詐唬 = 阻擋價值",
  "卻沒擋 AQ",
  "<b>",
  "<",
];

function containsNumber(text, value) {
  const source = String(value);
  const pattern = new RegExp(`(?<![0-9])${source}(?![0-9])`);
  return pattern.test(text);
}

export function expectedNumbers(model) {
  if (!model) return [];
  const numbers = [];
  const add = (...values) => numbers.push(...values);
  if (model.type === "pair") {
    add(pairCombos(model.left));
    for (const left of model.alsoPairs || []) add(pairCombos(left));
  } else if (model.type === "flush") {
    const full = combination(model.suitLeft, 2);
    const blocked = combination(model.suitLeft - 1, 2);
    add(full, blocked, full - blocked);
  } else if (model.type === "range-block") {
    const before = model.before.map(([left, right]) => left * right);
    const after = model.after.map(([left, right]) => left * right);
    add(...before, ...after);
    add(before.reduce((sum, value) => sum + value, 0) - after.reduce((sum, value) => sum + value, 0));
    for (const left of model.pairs || []) add(pairCombos(left));
  } else if (model.type === "showdown-sum") {
    const parts = [];
    for (const left of model.pairs || []) parts.push(pairCombos(left));
    for (const [left, right] of model.products || []) parts.push(left * right);
    add(...parts, parts.reduce((sum, value) => sum + value, 0));
  } else if (model.type === "bluffcatch") {
    const value = (model.valueParts || [model.value]).reduce((sum, part) => sum + part, 0);
    add(shownPercent(requiredCallEquity(model.pot, model.bet)));
    add(shownPercent(model.bluff / (value + model.bluff)));
    add(value, model.bluff);
    if (model.valueParts) add(...model.valueParts);
    if (model.tieBluff) {
      add(model.tieBluff, value + model.tieBluff);
      add(shownPercent(model.tieBluff / (value + model.tieBluff)));
    }
  } else if (model.type === "outs") {
    add(model.outs);
    if (!model.hideEquity) add(shownPercent(drawEquity(model.outs, model.unseen, model.cards || 2)));
  } else if (model.type === "equity") {
    add(shownPercent(requiredCallEquity(model.pot, model.bet)));
  } else if (model.type === "suit-combos") {
    add(combination(model.left, 2));
  } else if (model.type === "bluff-mix") {
    add(shownPercent(requiredCallEquity(model.pot, model.bet)));
    add(shownPercent(model.bet / (model.pot + model.bet)));
    add(shownPercent(requiredCallEquity(1, 0.5)));
  } else if (model.type === "products") {
    const values = [];
    for (const [n, k] of model.combos || []) values.push(combination(n, k));
    for (const [left, right] of model.products || []) values.push(left * right);
    add(...values);
    if ((model.combos || []).length === 2) {
      const [first, second] = (model.combos || []).map(([n, k]) => combination(n, k));
      add(Math.abs(first - second));
    }
  } else {
    throw new Error(`unknown model ${model.type}`);
  }
  return numbers;
}

export function bluffcatchDecision(model) {
  const value = (model.valueParts || [model.value]).reduce((sum, part) => sum + part, 0);
  const equity = requiredCallEquity(model.pot, model.bet);
  const share = model.bluff / (value + model.bluff);
  return share + 1e-12 < equity ? "fold" : "call";
}

export function verifyQuestion(question) {
  const errors = [];
  for (const phrase of BANNED_PHRASES) {
    if (question.explanation.includes(phrase)) errors.push(`banned:${phrase}`);
  }
  if (!question.model) return errors;
  for (const number of expectedNumbers(question.model)) {
    if (!containsNumber(question.explanation, number)) errors.push(`missing:${number}`);
  }
  if (question.model.type === "bluffcatch") {
    const decision = bluffcatchDecision(question.model);
    const chosen = question.correctOptionId === question.model.foldOptionId
      ? "fold"
      : question.correctOptionId === question.model.callOptionId
        ? "call"
        : "other";
    if (chosen !== decision) errors.push(`decision:${decision} vs ${chosen}`);
  }
  return errors;
}
