// =============================================================================
// api/analyze/strategies/sharedMath.js
// Shared numeric helpers for strategy analysis.
// =============================================================================

export function safeNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function pct(v, decimals = 1) {
  return parseFloat((v * 100).toFixed(decimals));
}

export function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x));
  return 0.5 * (1 + sgn * y);
}

export function npdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function simpleRatio(a, b) {
  if (!a || !b) return null;
  const x = Math.round(Math.abs(a) * 100);
  const y = Math.round(Math.abs(b) * 100);
  function gcd(m, n) { return n ? gcd(n, m % n) : m; }
  const g = gcd(x, y) || 1;
  return String(x / g) + ':' + String(y / g);
}
