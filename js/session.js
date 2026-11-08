import { elapsedMs, makeClock, pauseClock, resumeClock } from "./clock.js";
import { omitBannedKeys } from "./guard.js";

function unseal(state) {
  return structuredClone(state);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function seal(state) {
  return deepFreeze(state);
}

export function createState(now = null) {
  return seal({
    schemaVersion: 1,
    attempts: [],
    sessions: [],
    opens: {},
    meta: {
      legacyMigrated: false,
      legacyImportedCount: 0,
      legacyError: null,
      updatedAt: now,
      conflictArchive: [],
    },
  });
}

export function adoptState(raw) {
  const source = raw && typeof raw === "object" ? omitBannedKeys(raw) : {};
  const state = {
    schemaVersion: 1,
    attempts: Array.isArray(source.attempts) ? source.attempts : [],
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    opens: source.opens && typeof source.opens === "object" && !Array.isArray(source.opens) ? source.opens : {},
    meta: {
      legacyMigrated: false,
      legacyImportedCount: 0,
      legacyError: null,
      updatedAt: null,
      conflictArchive: [],
      ...(source.meta && typeof source.meta === "object" ? source.meta : {}),
    },
  };
  if (!Array.isArray(state.meta.conflictArchive)) state.meta.conflictArchive = [];
  return seal(state);
}

function knownAttempts(attempts, questionId) {
  return attempts
    .filter((attempt) => attempt.questionId === questionId && attempt.correctnessStatus === "known")
    .slice()
    .sort((left, right) => (left.submittedAt - right.submittedAt) || ((left.attemptNumber || 0) - (right.attemptNumber || 0)));
}

function cleanReasoning(value) {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: "BAD_REASONING" };
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > 2000) return { error: "REASONING_TOO_LONG" };
  return { value: text };
}

function cleanConfidence(value) {
  if (value == null || value === "") return { value: null };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) return { error: "BAD_CONFIDENCE" };
  return { value: number };
}

export function startSession(state, { sessionId, day, mode, now, queue }) {
  const next = unseal(state);
  next.sessions.push({
    sessionId,
    day,
    mode,
    queue: [...queue],
    startedAt: now,
    endedAt: null,
    timestampStatus: "known",
    label: null,
  });
  next.meta.updatedAt = now;
  return seal(next);
}

export function endSession(state, sessionId, now) {
  const next = unseal(state);
  const session = next.sessions.find((item) => item.sessionId === sessionId);
  if (session && session.endedAt == null) session.endedAt = now;
  next.meta.updatedAt = now;
  return seal(next);
}

export function enterQuestion(state, { question, sessionId, now, openId }) {
  const next = unseal(state);
  for (const [id, open] of Object.entries(next.opens)) {
    if (id !== question.id && open.clock.runningSince != null) {
      open.clock = pauseClock(open.clock, now, "navigation");
    }
  }
  const existing = next.opens[question.id];
  if (existing) {
    if (!existing.clock.explicit && existing.clock.runningSince == null && existing.clock.pauseReason === "navigation") {
      existing.clock = resumeClock(existing.clock, now);
    }
    next.meta.updatedAt = now;
    return { state: seal(next), open: existing };
  }
  const open = {
    openId,
    questionId: question.id,
    sessionId,
    day: question.day,
    displayedAt: now,
    selectedOptionId: null,
    reasoning: "",
    confidence: null,
    clock: makeClock(now),
  };
  next.opens[question.id] = open;
  next.meta.updatedAt = now;
  return { state: seal(next), open };
}

export function leaveQuestion(state, questionId, now) {
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return seal(next);
  if (open.clock.explicit) {
    next.meta.updatedAt = now;
    return seal(next);
  }
  if (open.clock.runningSince != null) open.clock = pauseClock(open.clock, now, "navigation");
  else open.clock = { ...open.clock, pauseReason: "navigation", autoResume: false };
  next.meta.updatedAt = now;
  return seal(next);
}

export function setVisible(state, questionId, visible, now) {
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return seal(next);
  if (!visible) {
    if (open.clock.runningSince != null) open.clock = pauseClock(open.clock, now, "hidden");
  } else if (!open.clock.explicit && open.clock.pauseReason === "hidden") {
    open.clock = resumeClock(open.clock, now);
  }
  next.meta.updatedAt = now;
  return seal(next);
}

export function toggleExplicitPause(state, questionId, now) {
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return seal(next);
  if (open.clock.explicit) open.clock = resumeClock(open.clock, now);
  else open.clock = pauseClock(open.clock, now, "explicit");
  next.meta.updatedAt = now;
  return seal(next);
}

export function setSelection(state, questionId, optionId) {
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return { state: seal(next), error: "NO_OPEN_ATTEMPT" };
  open.selectedOptionId = optionId;
  return { state: seal(next) };
}

export function setReasoning(state, questionId, reasoning) {
  const cleaned = cleanReasoning(reasoning);
  if (cleaned.error && reasoning !== "") return { state, error: cleaned.error };
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return { state: seal(next), error: "NO_OPEN_ATTEMPT" };
  open.reasoning = reasoning == null ? "" : String(reasoning).slice(0, 2000);
  return { state: seal(next) };
}

export function setConfidence(state, questionId, confidence) {
  const cleaned = cleanConfidence(confidence);
  if (cleaned.error) return { state, error: cleaned.error };
  const next = unseal(state);
  const open = next.opens[questionId];
  if (!open) return { state: seal(next), error: "NO_OPEN_ATTEMPT" };
  open.confidence = cleaned.value;
  return { state: seal(next) };
}

function snapshotOf(question) {
  return {
    contentVersion: question.contentVersion,
    day: question.day,
    tags: [...question.tags],
    spot: question.spot,
    prompt: question.prompt,
    board: [...question.board],
    hand: question.hand ? [...question.hand] : null,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
    correctOptionId: question.correctOptionId,
    explanation: question.explanation,
  };
}

export function submitOpen(state, { questionId, openId, now, question, tagInfo, attemptId }) {
  const existing = state.attempts.find((attempt) => attempt.openId === openId);
  if (existing) return { state, attempt: existing, duplicate: true };
  const open = state.opens[questionId];
  if (!open || open.openId !== openId) return { state, error: "NO_OPEN_ATTEMPT" };
  if (!open.selectedOptionId) return { state, error: "NO_SELECTION" };
  const reasoning = cleanReasoning(open.reasoning);
  if (reasoning.error) return { state, error: reasoning.error };
  const confidence = cleanConfidence(open.confidence);
  if (confidence.error) return { state, error: confidence.error };
  const correct = open.selectedOptionId === question.correctOptionId;
  const tags = [...question.tags];
  const attempt = {
    attemptId,
    openId,
    source: "session",
    questionId: question.id,
    contentVersion: question.contentVersion,
    day: question.day,
    sessionId: open.sessionId,
    selectedOptionId: open.selectedOptionId,
    selectedAnswerStatus: "known",
    correctOptionId: question.correctOptionId,
    correct,
    correctnessStatus: "known",
    explanation: question.explanation,
    explanationStatus: "known",
    snapshot: snapshotOf(question),
    snapshotStatus: "captured",
    weaknessTags: correct ? [] : tags.filter((tag) => tagInfo[tag]?.kind === "weakness"),
    strengthMisses: correct ? [] : tags.filter((tag) => tagInfo[tag]?.kind === "strength"),
    questionTags: tags,
    decisionTimeMs: Math.max(0, Math.round(elapsedMs(open.clock, now))),
    decisionTimeStatus: "measured",
    displayedAt: open.displayedAt,
    submittedAt: now,
    timestampStatus: "known",
    attemptNumber: knownAttempts(state.attempts, question.id).length + 1,
    attemptNumberStatus: "known",
    reasoning: reasoning.value,
    confidence: confidence.value,
    pauseCount: open.clock.pauseCount,
    legacyMarkedCorrect: null,
    legacyDay: null,
    legacyIndex: null,
    legacyCategory: null,
    migratedAt: null,
  };
  const next = unseal(state);
  next.attempts.push(attempt);
  delete next.opens[questionId];
  next.meta.updatedAt = now;
  const sealed = seal(next);
  return { state: sealed, attempt: sealed.attempts[sealed.attempts.length - 1], duplicate: false };
}

export function snapshotForStorage(state, now) {
  const next = unseal(state);
  for (const open of Object.values(next.opens)) {
    const wasRunning = open.clock.runningSince != null;
    open.clock = {
      accumulatedMs: elapsedMs(open.clock, now),
      runningSince: null,
      pauseReason: wasRunning ? "reload" : open.clock.pauseReason,
      explicit: open.clock.explicit,
      autoResume: wasRunning && !open.clock.explicit,
      pauseCount: open.clock.pauseCount,
    };
  }
  next.meta.updatedAt = now;
  return seal(omitBannedKeys(next));
}

export function acceptStoredState(state, now, { visible, questionId }) {
  const next = unseal(state);
  for (const open of Object.values(next.opens)) {
    open.clock.runningSince = null;
    const current = open.questionId === questionId;
    const canResume = !open.clock.explicit && visible && current
      && (open.clock.autoResume || open.clock.pauseReason === "hidden" || open.clock.pauseReason === "reload");
    if (canResume) open.clock = resumeClock(open.clock, now);
  }
  return seal(next);
}

export function currentElapsed(state, questionId, now) {
  const open = state.opens[questionId];
  if (!open) return null;
  return elapsedMs(open.clock, now);
}
