export function formatClock(ms) {
  if (ms == null || !Number.isFinite(ms)) return "未知";
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function decisionLabel(attempt) {
  if (!attempt || attempt.decisionTimeStatus !== "measured") return "決策時間：未知";
  const pause = attempt.pauseCount > 0 ? "已扣除暫停" : "沒有暫停";
  return `決策時間：${formatClock(attempt.decisionTimeMs)}（${pause}，不含講解）`;
}

export function correctnessLabel(attempt) {
  if (attempt?.correctnessStatus === "known") return attempt.correct ? "答對" : "答錯";
  if (attempt?.source === "legacy-pkt" && typeof attempt.legacyMarkedCorrect === "boolean") {
    return attempt.legacyMarkedCorrect
      ? "舊版記為答對（沒有選項，不能當成這版題目的成績）"
      : "舊版記為答錯（沒有選項，不能當成這版題目的成績）";
  }
  return "對錯未知";
}

export function syncBannerText() {
  return "私人同步尚未連接。紀錄只在這台瀏覽器，助教讀不到，除非你自己匯出 JSON。";
}
