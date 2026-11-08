function knownAttempts(attempts, questionId) {
  return attempts
    .filter((attempt) => attempt.questionId === questionId && attempt.correctnessStatus === "known")
    .slice()
    .sort((left, right) => (left.submittedAt - right.submittedAt) || ((left.attemptNumber || 0) - (right.attemptNumber || 0)));
}

export function planDay(questions, attempts, day) {
  const list = questions
    .filter((question) => question.day === day)
    .slice()
    .sort((left, right) => left.legacyIndex - right.legacyIndex);
  const wrong = [];
  const legacyOnly = [];
  const unseen = [];
  const mastered = [];
  for (const question of list) {
    const known = knownAttempts(attempts, question.id);
    const legacy = attempts.filter((attempt) => attempt.questionId === question.id && attempt.source === "legacy-pkt");
    if (known.length) {
      const latest = known[known.length - 1];
      if (latest.correct === false) wrong.push(question);
      else mastered.push(question);
    } else if (legacy.length) legacyOnly.push(question);
    else unseen.push(question);
  }
  return {
    wrong,
    legacyOnly,
    unseen,
    mastered,
    playlist: [...wrong, ...legacyOnly, ...unseen],
  };
}

export function orderOfDay(questions, day) {
  return questions
    .filter((question) => question.day === day)
    .slice()
    .sort((left, right) => left.legacyIndex - right.legacyIndex)
    .map((question) => question.id);
}

export function practiceQueue(questions, attempts, day, mode) {
  if (mode === "order") return orderOfDay(questions, day);
  return planDay(questions, attempts, day).playlist.map((question) => question.id);
}
