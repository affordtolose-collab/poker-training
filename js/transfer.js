import { containsBannedKey } from "./guard.js";

export const SCHEMA = "poker-training.records";
export const SCHEMA_VERSION = 1;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const QUESTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,40}$/;
const CARD_RE = /^[AKQJT2-9][shdc]$/;

const ATTEMPT_KEYS = [
  "attemptId", "openId", "source", "questionId", "contentVersion", "day", "sessionId",
  "selectedOptionId", "selectedAnswerStatus", "correctOptionId", "correct", "correctnessStatus",
  "explanation", "explanationStatus", "snapshot", "snapshotStatus", "weaknessTags", "strengthMisses",
  "questionTags", "decisionTimeMs", "decisionTimeStatus", "displayedAt", "submittedAt", "timestampStatus",
  "attemptNumber", "attemptNumberStatus", "reasoning", "confidence", "pauseCount",
  "legacyMarkedCorrect", "legacyDay", "legacyIndex", "legacyCategory", "migratedAt",
];

function fail(code, message) {
  return { ok: false, code, message };
}

function isCardList(value, exact) {
  if (!Array.isArray(value)) return false;
  if (exact != null && value.length !== exact) return false;
  return value.every((card) => typeof card === "string" && CARD_RE.test(card));
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "SNAPSHOT";
  if (typeof snapshot.spot !== "string" || snapshot.spot.length > 4000) return "SNAPSHOT";
  if (typeof snapshot.prompt !== "string" || snapshot.prompt.length > 1000) return "SNAPSHOT";
  if (typeof snapshot.explanation !== "string" || snapshot.explanation.length > 4000) return "SNAPSHOT";
  if (typeof snapshot.correctOptionId !== "string" || snapshot.correctOptionId.length > 8) return "SNAPSHOT";
  if (!Array.isArray(snapshot.options) || snapshot.options.length < 2 || snapshot.options.length > 8) return "SNAPSHOT";
  for (const option of snapshot.options) {
    if (!option || typeof option.id !== "string" || typeof option.text !== "string") return "SNAPSHOT";
    if (option.text.length > 500 || option.id.length > 8) return "SNAPSHOT";
  }
  if (!snapshot.options.some((option) => option.id === snapshot.correctOptionId)) return "SNAPSHOT";
  if (!isCardList(snapshot.board)) return "SNAPSHOT";
  if (snapshot.hand != null && !isCardList(snapshot.hand, 2)) return "SNAPSHOT";
  if (!Array.isArray(snapshot.tags)) return "SNAPSHOT";
  return null;
}

function stringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 40);
}

export function validateAttempt(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("ATTEMPT_TYPE", "有一筆紀錄不是物件");
  if (containsBannedKey(raw)) return fail("BANNED_KEY", "檔案含有不該匯入的認證欄位");
  if (typeof raw.attemptId !== "string" || !ID_RE.test(raw.attemptId)) return fail("ATTEMPT_ID", "紀錄編號無效");
  if (typeof raw.openId !== "string" || !ID_RE.test(raw.openId)) return fail("OPEN_ID", "作答編號無效");
  if (raw.source !== "session" && raw.source !== "legacy-pkt") return fail("SOURCE", "紀錄來源無效");
  if (typeof raw.questionId !== "string" || !QUESTION_RE.test(raw.questionId)) return fail("QUESTION_ID", "題目編號無效");
  if (!((Number.isInteger(raw.day) && raw.day >= 1 && raw.day <= 3) || (raw.source === "legacy-pkt" && raw.day === null))) {
    return fail("DAY", "天數無效");
  }
  if (raw.correctnessStatus === "known") {
    if (typeof raw.correct !== "boolean") return fail("CORRECT", "對錯格式無效");
    if (typeof raw.selectedOptionId !== "string") return fail("SELECTION", "選項無效");
    if (typeof raw.correctOptionId !== "string") return fail("KEY", "正確選項無效");
  } else if (raw.correctnessStatus === "unknown") {
    if (raw.correct !== null || raw.selectedOptionId !== null || raw.correctOptionId !== null) {
      return fail("UNKNOWN_CORRECT", "未知的對錯不能同時帶有選項");
    }
  } else return fail("CORRECTNESS_STATUS", "對錯狀態無效");
  if (raw.decisionTimeStatus === "measured") {
    if (!Number.isInteger(raw.decisionTimeMs) || raw.decisionTimeMs < 0 || raw.decisionTimeMs > 60 * 60 * 1000) {
      return fail("TIME", "決策時間無效");
    }
  } else if (raw.decisionTimeStatus === "unknown") {
    if (raw.decisionTimeMs !== null) return fail("TIME", "未知的時間不能帶有數字");
  } else return fail("TIME_STATUS", "時間狀態無效");
  if (raw.snapshotStatus === "captured") {
    const snapshotError = validateSnapshot(raw.snapshot);
    if (snapshotError) return fail(snapshotError, "題目快照無效");
  } else if (raw.snapshotStatus === "unavailable") {
    if (raw.snapshot !== null) return fail("SNAPSHOT", "沒有快照時不該夾帶題幹");
  } else return fail("SNAPSHOT_STATUS", "快照狀態無效");
  if (raw.explanationStatus !== "known" && raw.explanationStatus !== "unknown") return fail("EXPLANATION_STATUS", "講解狀態無效");
  if (raw.explanation != null && (typeof raw.explanation !== "string" || raw.explanation.length > 4000)) {
    return fail("EXPLANATION", "講解無效");
  }
  if (raw.reasoning != null && (typeof raw.reasoning !== "string" || raw.reasoning.length > 2000)) {
    return fail("REASONING", "理由無效");
  }
  if (raw.confidence != null && (!Number.isInteger(raw.confidence) || raw.confidence < 1 || raw.confidence > 5)) {
    return fail("CONFIDENCE", "信心無效");
  }
  if (!stringList(raw.weaknessTags) || !stringList(raw.strengthMisses) || !stringList(raw.questionTags)) {
    return fail("TAGS", "標籤無效");
  }
  if (raw.timestampStatus === "known") {
    if (!Number.isInteger(raw.displayedAt) || !Number.isInteger(raw.submittedAt)) return fail("TIMESTAMP", "時間戳無效");
  } else if (raw.timestampStatus === "unknown") {
    if (raw.displayedAt !== null || raw.submittedAt !== null) return fail("TIMESTAMP", "未知的時間戳不能帶有數字");
  } else return fail("TIMESTAMP_STATUS", "時間戳狀態無效");
  if (raw.attemptNumberStatus === "known") {
    if (!Number.isInteger(raw.attemptNumber) || raw.attemptNumber < 1) return fail("ATTEMPT_NO", "作答次數無效");
  } else if (raw.attemptNumberStatus === "unknown") {
    if (raw.attemptNumber !== null) return fail("ATTEMPT_NO", "未知的作答次數不能帶有數字");
  } else return fail("ATTEMPT_NO_STATUS", "作答次數狀態無效");
  if (typeof raw.sessionId !== "string" || raw.sessionId.length < 1 || raw.sessionId.length > 80) {
    return fail("SESSION", "場次編號無效");
  }
  if (!Number.isInteger(raw.pauseCount) || raw.pauseCount < 0) return fail("PAUSE", "暫停次數無效");
  if (raw.legacyMarkedCorrect != null && typeof raw.legacyMarkedCorrect !== "boolean") return fail("LEGACY", "舊版對錯無效");
  return { ok: true, value: pick(raw, ATTEMPT_KEYS) };
}

function pick(raw, keys) {
  const value = {};
  for (const key of keys) value[key] = raw[key] === undefined ? null : raw[key];
  if (value.snapshot && typeof value.snapshot === "object") value.snapshot = structuredClone(value.snapshot);
  value.weaknessTags = [...(raw.weaknessTags || [])];
  value.strengthMisses = [...(raw.strengthMisses || [])];
  value.questionTags = [...(raw.questionTags || [])];
  return value;
}

function canonical(attempt) {
  const picked = pick(attempt, ATTEMPT_KEYS);
  return JSON.stringify(picked);
}

export function exportDocument(state, exportedAt) {
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    exportedAt,
    attempts: state.attempts.map((attempt) => pick(attempt, ATTEMPT_KEYS)),
    sessions: structuredClone(state.sessions),
    opens: structuredClone(state.opens),
    conflictArchive: structuredClone(state.meta.conflictArchive || []),
  };
}

function blankState(base) {
  return {
    schemaVersion: 1,
    attempts: base.attempts.map((attempt) => structuredClone(attempt)),
    sessions: structuredClone(base.sessions),
    opens: structuredClone(base.opens),
    meta: structuredClone(base.meta),
  };
}

export function importDocument(state, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: [{ code: "TYPE", message: "檔案不是物件" }] };
  }
  if (containsBannedKey(data)) {
    return { ok: false, errors: [{ code: "BANNED_KEY", message: "檔案含有不該匯入的認證欄位，已整份拒絕" }] };
  }
  if (data.schema !== SCHEMA || data.version !== SCHEMA_VERSION) {
    return { ok: false, errors: [{ code: "SCHEMA", message: "這不是本站的紀錄檔" }] };
  }
  if (!Array.isArray(data.attempts)) {
    return { ok: false, errors: [{ code: "ATTEMPTS", message: "缺少作答陣列" }] };
  }
  const accepted = [];
  const errors = [];
  for (const raw of data.attempts) {
    const parsed = validateAttempt(raw);
    if (!parsed.ok) errors.push(parsed);
    else accepted.push(parsed.value);
  }
  if (errors.length) return { ok: false, errors, imported: 0, skipped: 0 };
  const next = blankState(state);
  let imported = 0;
  let skipped = 0;
  const conflicts = [];
  for (const attempt of accepted) {
    const previous = next.attempts.find((item) => item.attemptId === attempt.attemptId);
    if (!previous) {
      next.attempts.push(attempt);
      imported += 1;
    } else if (canonical(previous) === canonical(attempt)) skipped += 1;
    else conflicts.push(attempt.attemptId);
  }
  if (conflicts.length) {
    return {
      ok: false,
      errors: conflicts.map((id) => ({ code: "CONFLICT", message: `紀錄 ${id} 與本機不同，已拒絕覆蓋` })),
      imported: 0,
      skipped: 0,
    };
  }
  if (Array.isArray(data.sessions)) {
    for (const session of data.sessions) {
      if (!session || typeof session.sessionId !== "string") continue;
      if (!next.sessions.some((item) => item.sessionId === session.sessionId)) {
        const copy = structuredClone(session);
        delete copy.token;
        next.sessions.push(copy);
      }
    }
  }
  if (data.opens && typeof data.opens === "object" && !Array.isArray(data.opens)) {
    for (const [questionId, open] of Object.entries(data.opens)) {
      if (!QUESTION_RE.test(questionId) || !open || typeof open !== "object") continue;
      if (next.opens[questionId]) continue;
      if (typeof open.openId !== "string" || !ID_RE.test(open.openId)) continue;
      const clock = open.clock && typeof open.clock === "object" ? open.clock : {};
      next.opens[questionId] = {
        openId: open.openId,
        questionId,
        sessionId: typeof open.sessionId === "string" ? open.sessionId : "imported",
        day: open.day ?? null,
        displayedAt: Number.isInteger(open.displayedAt) ? open.displayedAt : null,
        selectedOptionId: typeof open.selectedOptionId === "string" ? open.selectedOptionId : null,
        reasoning: typeof open.reasoning === "string" ? open.reasoning.slice(0, 2000) : "",
        confidence: Number.isInteger(open.confidence) ? open.confidence : null,
        clock: {
          accumulatedMs: Number.isInteger(clock.accumulatedMs) && clock.accumulatedMs >= 0 ? clock.accumulatedMs : 0,
          runningSince: null,
          pauseReason: "import",
          explicit: false,
          autoResume: false,
          pauseCount: Number.isInteger(clock.pauseCount) ? clock.pauseCount : 0,
        },
      };
    }
  }
  if (Array.isArray(data.conflictArchive)) {
    next.meta.conflictArchive = [...(next.meta.conflictArchive || []), ...structuredClone(data.conflictArchive)];
  }
  return { ok: true, state: next, errors: [], imported, skipped };
}

export function parseImport(text, { maxChars = 2_000_000 } = {}) {
  if (typeof text !== "string") return { ok: false, errors: [{ code: "TYPE", message: "檔案不是文字" }] };
  if (text.includes("\0")) return { ok: false, errors: [{ code: "NUL", message: "檔案含有無效字元" }] };
  if (text.length > maxChars) return { ok: false, errors: [{ code: "SIZE", message: "檔案太大" }] };
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) return { ok: false, errors: [{ code: "EMPTY", message: "檔案是空的" }] };
  if (body.startsWith("{")) {
    try {
      return { ok: true, format: "json", data: JSON.parse(body) };
    } catch {
      return { ok: false, errors: [{ code: "JSON", message: "JSON 無法解析" }] };
    }
  }
  return { ok: true, format: "csv", data: parseCsvDocument(body) };
}

function csvCell(value) {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const CSV_COLUMNS = [
  "attemptId", "openId", "source", "questionId", "day", "sessionId", "attemptNumber", "attemptNumberStatus",
  "correct", "correctnessStatus", "selectedOptionId", "correctOptionId", "weaknessTags", "strengthMisses",
  "questionTags", "decisionTimeMs", "decisionTimeStatus", "displayedAt", "submittedAt", "timestampStatus",
  "reasoning", "confidence", "pauseCount", "snapshotStatus", "contentVersion", "legacyMarkedCorrect",
  "explanationStatus",
];

function joinList(value) {
  return Array.isArray(value) ? value.join("|") : "";
}

export function exportCsv(state) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const attempt of state.attempts) {
    const row = {
      ...attempt,
      weaknessTags: joinList(attempt.weaknessTags),
      strengthMisses: joinList(attempt.strengthMisses),
      questionTags: joinList(attempt.questionTags),
      correct: attempt.correct == null ? "" : String(attempt.correct),
      legacyMarkedCorrect: attempt.legacyMarkedCorrect == null ? "" : String(attempt.legacyMarkedCorrect),
    };
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ""));
}

function unescapeFormula(value) {
  if (typeof value === "string" && value.startsWith("'") && /^'[=+\-@]/.test(value)) return value.slice(1);
  return value;
}

function nullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : value;
}

function nullableBoolean(value) {
  if (value === "" || value == null) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function parseCsvDocument(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return { schema: SCHEMA, version: SCHEMA_VERSION, attempts: [] };
  const header = rows[0];
  const attempts = rows.slice(1).map((columns) => {
    const raw = {};
    header.forEach((key, index) => {
      raw[key] = unescapeFormula(columns[index] ?? "");
    });
    const list = (value) => (value ? String(value).split("|").filter(Boolean) : []);
    return {
      attemptId: raw.attemptId,
      openId: raw.openId,
      source: raw.source,
      questionId: raw.questionId,
      contentVersion: raw.contentVersion || null,
      day: raw.day === "" ? null : nullableNumber(raw.day),
      sessionId: raw.sessionId,
      selectedOptionId: raw.selectedOptionId || null,
      selectedAnswerStatus: raw.correctnessStatus === "known" ? "known" : "unknown",
      correctOptionId: raw.correctOptionId || null,
      correct: nullableBoolean(raw.correct),
      correctnessStatus: raw.correctnessStatus,
      explanation: null,
      explanationStatus: "unknown",
      snapshot: null,
      snapshotStatus: "unavailable",
      weaknessTags: list(raw.weaknessTags),
      strengthMisses: list(raw.strengthMisses),
      questionTags: list(raw.questionTags),
      decisionTimeMs: nullableNumber(raw.decisionTimeMs),
      decisionTimeStatus: raw.decisionTimeStatus,
      displayedAt: nullableNumber(raw.displayedAt),
      submittedAt: nullableNumber(raw.submittedAt),
      timestampStatus: raw.timestampStatus,
      attemptNumber: nullableNumber(raw.attemptNumber),
      attemptNumberStatus: raw.attemptNumberStatus,
      reasoning: raw.reasoning ? String(raw.reasoning) : null,
      confidence: nullableNumber(raw.confidence),
      pauseCount: nullableNumber(raw.pauseCount) ?? 0,
      legacyMarkedCorrect: nullableBoolean(raw.legacyMarkedCorrect),
      legacyDay: null,
      legacyIndex: null,
      legacyCategory: null,
      migratedAt: null,
    };
  });
  return { schema: SCHEMA, version: SCHEMA_VERSION, attempts, sessions: [], opens: {} };
}
