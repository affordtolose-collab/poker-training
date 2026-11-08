const LEGACY_SESSION = "legacy-pkt";

function unseal(state) {
  return structuredClone(state);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function legacyAttempt({ attemptId, dayNumber, index, question, markedCorrect, now, storedDay }) {
  return {
    attemptId,
    openId: `legacy-${dayNumber}-${index}`,
    source: "legacy-pkt",
    questionId: question ? question.id : `legacy-d${dayNumber}-i${index}`,
    contentVersion: null,
    day: storedDay,
    sessionId: LEGACY_SESSION,
    selectedOptionId: null,
    selectedAnswerStatus: "unknown",
    correctOptionId: null,
    correct: null,
    correctnessStatus: "unknown",
    explanation: null,
    explanationStatus: "unknown",
    snapshot: null,
    snapshotStatus: "unavailable",
    weaknessTags: [],
    strengthMisses: [],
    questionTags: [],
    decisionTimeMs: null,
    decisionTimeStatus: "unknown",
    displayedAt: null,
    submittedAt: null,
    timestampStatus: "unknown",
    attemptNumber: null,
    attemptNumberStatus: "unknown",
    reasoning: null,
    confidence: null,
    pauseCount: 0,
    legacyMarkedCorrect: markedCorrect,
    legacyDay: dayNumber,
    legacyIndex: index,
    legacyCategory: question ? question.legacyCategory : null,
    migratedAt: now,
  };
}

export function migrateLegacy(state, raw, questions, { now, attemptId, force = false, limit = 500 } = {}) {
  if (state.meta.legacyMigrated && !force) {
    return { state, imported: 0, skipped: true };
  }
  const next = unseal(state);
  if (raw == null) {
    next.meta.legacyMigrated = true;
    next.meta.legacyError = null;
    next.meta.legacyImportedCount = next.attempts.filter((attempt) => attempt.source === "legacy-pkt").length;
    return { state: deepFreeze(next), imported: 0 };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    next.meta.legacyError = "UNREADABLE";
    return { state: deepFreeze(next), imported: 0, error: "UNREADABLE" };
  }
  if (!next.sessions.some((session) => session.sessionId === LEGACY_SESSION)) {
    next.sessions.push({
      sessionId: LEGACY_SESSION,
      day: null,
      mode: "legacy",
      queue: [],
      startedAt: null,
      endedAt: null,
      timestampStatus: "unknown",
      label: "舊版進度",
    });
  }
  let imported = 0;
  let truncated = 0;
  let sequence = 0;
  for (const [dayKey, answers] of Object.entries(raw)) {
    if (!/^\d+$/.test(dayKey) || !answers || typeof answers !== "object" || Array.isArray(answers)) continue;
    const dayNumber = Number(dayKey);
    for (const [indexKey, value] of Object.entries(answers)) {
      if (!/^\d+$/.test(indexKey) || typeof value !== "boolean") continue;
      if (imported >= limit) {
        truncated += 1;
        continue;
      }
      const index = Number(indexKey);
      const openId = `legacy-${dayNumber}-${index}`;
      if (next.attempts.some((attempt) => attempt.openId === openId)) continue;
      const question = questions.find((item) => item.legacyDay === dayNumber && item.legacyIndex === index) || null;
      const storedDay = dayNumber >= 0 && dayNumber <= 2 ? dayNumber + 1 : null;
      next.attempts.push(legacyAttempt({
        attemptId: attemptId(`d${dayNumber}-i${index}-n${sequence}`),
        dayNumber,
        index,
        question,
        markedCorrect: value,
        now,
        storedDay,
      }));
      sequence += 1;
      imported += 1;
    }
  }
  next.meta.legacyMigrated = true;
  next.meta.legacyError = truncated ? "TRUNCATED" : null;
  next.meta.legacyImportedCount = next.attempts.filter((attempt) => attempt.source === "legacy-pkt").length;
  next.meta.legacyTruncated = truncated;
  next.meta.updatedAt = now;
  return { state: deepFreeze(next), imported, truncated };
}
