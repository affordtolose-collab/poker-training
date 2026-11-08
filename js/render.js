import { h, asText } from "./dom.js";
import { correctnessLabel, decisionLabel } from "./format.js";
import { TAGS } from "./questions.js";

const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function cardParts(code) {
  if (typeof code !== "string" || code.length < 2) return null;
  const rank = code[0] === "T" ? "10" : code[0];
  const suit = SUITS[code[1]];
  if (!suit) return null;
  return { rank, suit, suitClass: code[1] };
}

function optionText(snapshot, optionId) {
  if (!snapshot || optionId == null) return null;
  const option = (snapshot.options || []).find((item) => item.id === optionId);
  return option ? option.text : null;
}

export function renderAttempt(doc, attempt, question) {
  const snapshot = attempt.snapshotStatus === "captured" ? attempt.snapshot : null;
  const tone = attempt.correct === true ? "good" : attempt.correct === false ? "bad" : "unknown";
  const root = h(doc, "article", { class: `attempt ${tone}` }, [
    h(doc, "p", { class: "eyebrow" }, [correctnessLabel(attempt)]),
    h(doc, "h3", {}, [snapshot ? asText(snapshot.prompt) : (question ? asText(question.prompt) : "題目內文未保存")]),
  ]);
  if (!snapshot) {
    root.append(h(doc, "p", { class: "note" }, ["當時的題幹、選項和講解沒有留下快照。下面若出現題庫文字，只是目前的版本，不是那一次看到的內容。"]));
  }
  const selected = optionText(snapshot, attempt.selectedOptionId);
  const correct = optionText(snapshot, attempt.correctOptionId);
  root.append(h(doc, "p", {}, [`你的選擇：${selected == null ? "未記錄" : selected}`]));
  root.append(h(doc, "p", {}, [`當時的正確選項：${correct == null ? "未記錄" : correct}`]));
  const explanation = snapshot ? asText(snapshot.explanation) : "";
  root.append(h(doc, "p", { class: "explanation" }, [explanation || "講解：未記錄"]));
  root.append(h(doc, "p", {}, [decisionLabel(attempt)]));
  if (attempt.reasoning) root.append(h(doc, "p", { class: "reasoning" }, [asText(attempt.reasoning)]));
  if (attempt.confidence != null) root.append(h(doc, "p", {}, [`信心：${attempt.confidence}`]));
  const tags = attempt.weaknessTags || [];
  if (tags.length) {
    const labels = tags.map((tag) => TAGS[tag]?.label || tag);
    root.append(h(doc, "p", {}, [`這次答錯觸及的弱點：${labels.join("、")}`]));
  }
  else if (attempt.correct === true) root.append(h(doc, "p", {}, ["這次答對，不記入弱點。"]));
  return root;
}
