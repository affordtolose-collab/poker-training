export function makeClock(now) {
  return {
    accumulatedMs: 0,
    runningSince: now,
    pauseReason: null,
    explicit: false,
    autoResume: false,
    pauseCount: 0,
  };
}

export function elapsedMs(clock, now) {
  if (!clock) return 0;
  if (clock.runningSince == null) return clock.accumulatedMs;
  return clock.accumulatedMs + Math.max(0, now - clock.runningSince);
}

export function pauseClock(clock, now, reason) {
  const running = clock.runningSince != null;
  const explicit = clock.explicit || reason === "explicit";
  const pauseReason = clock.explicit && reason !== "explicit" ? "explicit" : reason;
  return {
    accumulatedMs: elapsedMs(clock, now),
    runningSince: null,
    pauseReason,
    explicit,
    autoResume: false,
    pauseCount: clock.pauseCount + (running ? 1 : 0),
  };
}

export function resumeClock(clock, now) {
  if (clock.runningSince != null) return clock;
  return {
    ...clock,
    runningSince: now,
    pauseReason: null,
    explicit: false,
    autoResume: false,
  };
}
