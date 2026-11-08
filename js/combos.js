export function combination(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k)) {
    throw new Error("combination expects integers");
  }
  if (k < 0 || n < 0 || k > n) return 0;
  const choose = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= choose; i += 1) {
    result = (result * (n - choose + i)) / i;
  }
  return Math.round(result);
}

export function pairCombos(rankLeft) {
  return combination(rankLeft, 2);
}

export function requiredCallEquity(pot, bet) {
  if (pot < 0 || bet <= 0) throw new Error("invalid pot or bet");
  return bet / (pot + 2 * bet);
}

export function drawEquity(outs, unseen, cards = 2) {
  if (outs < 0 || unseen < 0 || outs > unseen) throw new Error("invalid outs");
  const miss = combination(unseen - outs, cards);
  const total = combination(unseen, cards);
  if (total === 0) return 0;
  return 1 - miss / total;
}

export function shownPercent(fraction) {
  return Math.round(fraction * 100);
}
