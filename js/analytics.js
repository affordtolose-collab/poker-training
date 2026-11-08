function knownAttempts(attempts) {
  return attempts.filter((attempt) => attempt.correctnessStatus === "known" && attempt.excludedFromStats !== true);
}

function byQuestion(attempts, questionId) {
  return knownAttempts(attempts)
    .filter((attempt) => attempt.questionId === questionId)
    .slice()
    .sort((left, right) => (left.submittedAt - right.submittedAt) || ((left.attemptNumber || 0) - (right.attemptNumber || 0)));
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function analyze(attempts, questions, { minSamples = 4, factor = 1.5, slackMs = 15000, dayKey = (ts) => String(ts) } = {}) {
  const known = knownAttempts(attempts);
  const measured = known.filter((attempt) => attempt.decisionTimeStatus === "measured" && Number.isFinite(attempt.decisionTimeMs));
  const med = median(measured.map((attempt) => attempt.decisionTimeMs));
  const slowCut = med == null || measured.length < minSamples ? null : Math.max(med * factor, med + slackMs);
  const latest = new Map();
  for (const question of questions) {
    const rows = byQuestion(attempts, question.id);
    if (rows.length) latest.set(question.id, rows[rows.length - 1]);
  }
  const isSlow = (attempt) => slowCut != null
    && attempt.decisionTimeStatus === "measured"
    && attempt.decisionTimeMs >= slowCut;
  const urgent = [];
  const slowCorrect = [];
  for (const question of questions) {
    const attempt = latest.get(question.id);
    if (!attempt) continue;
    const slow = isSlow(attempt);
    if (attempt.correct === false) {
      urgent.push({
        questionId: question.id,
        reason: "latest-incorrect",
        countsAsWeakness: true,
        alsoSlow: slow,
        weaknessTags: [...(attempt.weaknessTags || [])],
        submittedAt: attempt.submittedAt,
        decisionTimeMs: attempt.decisionTimeStatus === "measured" ? attempt.decisionTimeMs : null,
      });
    } else if (slow) {
      slowCorrect.push({
        questionId: question.id,
        reason: "slow-correct",
        countsAsWeakness: false,
        alsoSlow: true,
        weaknessTags: [],
        submittedAt: attempt.submittedAt,
        decisionTimeMs: attempt.decisionTimeMs,
        note: "決策偏慢，但這次答對，不計入弱點",
      });
    }
  }
  urgent.sort((left, right) => (right.submittedAt || 0) - (left.submittedAt || 0));
  slowCorrect.sort((left, right) => (right.decisionTimeMs || 0) - (left.decisionTimeMs || 0));

  const tagIds = [...new Set(questions.flatMap((question) => question.tags))];
  const byTag = {};
  for (const tag of tagIds) {
    const rows = known.filter((attempt) => (attempt.questionTags || []).includes(tag));
    const misses = rows.filter((attempt) => attempt.correct === false).length;
    byTag[tag] = { attempts: rows.length, misses, correct: rows.length - misses };
  }

  const buckets = new Map();
  for (const attempt of known) {
    if (attempt.submittedAt == null) continue;
    const key = dayKey(attempt.submittedAt);
    const bucket = buckets.get(key) || { key, total: 0, correct: 0 };
    bucket.total += 1;
    if (attempt.correct) bucket.correct += 1;
    buckets.set(key, bucket);
  }
  const trend = [...buckets.values()].sort((left, right) => String(left.key).localeCompare(String(right.key)));

  const legacy = attempts.filter((attempt) => attempt.source === "legacy-pkt");
  return {
    knownAttempts: known.length,
    knownCorrect: known.filter((attempt) => attempt.correct).length,
    medianMs: med,
    slowCutMs: slowCut,
    sampleSize: measured.length,
    urgent,
    slowCorrect,
    byTag,
    trend,
    legacyCount: legacy.length,
    legacyMarkedCorrect: legacy.filter((attempt) => attempt.legacyMarkedCorrect === true).length,
    legacyMarkedIncorrect: legacy.filter((attempt) => attempt.legacyMarkedCorrect === false).length,
    unknownTimeCount: attempts.filter((attempt) => attempt.decisionTimeStatus !== "measured").length,
  };
}

export function measuredTimeForDay(attempts, day, now, dayKey) {
  const key = dayKey(now);
  return knownAttempts(attempts)
    .filter((attempt) => attempt.day === day && attempt.decisionTimeStatus === "measured" && dayKey(attempt.submittedAt) === key)
    .reduce((sum, attempt) => sum + attempt.decisionTimeMs, 0);
}
