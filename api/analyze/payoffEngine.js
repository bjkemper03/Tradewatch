// =============================================================================
// api/analyze/payoffEngine.js
// Shared expiration payoff engine for option structures.
// =============================================================================

function safeNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function money(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return parseFloat(v.toFixed(2));
}

function price(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return parseFloat(v.toFixed(2));
}

function uniqSorted(values) {
  return [...new Set(values
    .map(v => price(v))
    .filter(v => v !== null && v >= 0))]
    .sort((a, b) => a - b);
}

export function normalizeOptionLegs(legs = []) {
  return legs.map(leg => ({
    action: String(leg.a || leg.action || '').toUpperCase(),
    type: String(leg.t || leg.type || '').toUpperCase(),
    qty: Math.max(1, safeNum(leg.n || leg.qty || 1, 1)),
    strike: safeNum(leg.s || leg.strike),
  })).filter(leg =>
    (leg.action === 'BUY' || leg.action === 'SELL') &&
    (leg.type === 'CALL' || leg.type === 'PUT') &&
    leg.strike > 0
  );
}

export function buildPayoffModel({
  legs = [],
  netPremiumPerShare = 0,
  premiumContracts = 1,
  underlyingShares = 0,
  underlyingBasis = 0,
  multiplier = 100,
} = {}) {
  return {
    legs: normalizeOptionLegs(legs),
    netPremiumPerShare: safeNum(netPremiumPerShare),
    premiumContracts: Math.max(1, safeNum(premiumContracts, 1)),
    underlyingShares: safeNum(underlyingShares),
    underlyingBasis: safeNum(underlyingBasis),
    multiplier: safeNum(multiplier, 100),
  };
}

export function payoffAt(model, stockPrice) {
  const px = Math.max(0, safeNum(stockPrice));
  let pnl = model.netPremiumPerShare * model.multiplier * model.premiumContracts;

  if (model.underlyingShares) {
    pnl += (px - model.underlyingBasis) * model.underlyingShares;
  }

  for (const leg of model.legs) {
    const intrinsic = leg.type === 'CALL'
      ? Math.max(0, px - leg.strike)
      : Math.max(0, leg.strike - px);
    const side = leg.action === 'BUY' ? 1 : -1;
    pnl += side * intrinsic * leg.qty * model.multiplier;
  }

  return money(pnl);
}

function highSideSlope(model) {
  let slope = model.underlyingShares;
  for (const leg of model.legs) {
    if (leg.type !== 'CALL') continue;
    slope += (leg.action === 'BUY' ? 1 : -1) * leg.qty * model.multiplier;
  }
  return slope;
}

function lowSideSlope(model) {
  let slope = model.underlyingShares;
  for (const leg of model.legs) {
    if (leg.type !== 'PUT') continue;
    slope += (leg.action === 'BUY' ? -1 : 1) * leg.qty * model.multiplier;
  }
  return slope;
}

function findBreakevens(model, breakpoints) {
  const roots = [];
  const sorted = uniqSorted([0, ...breakpoints]);

  function addRoot(v) {
    const root = price(v);
    if (root === null || root < 0) return;
    if (!roots.some(existing => Math.abs(existing - root) < 0.01)) roots.push(root);
  }

  for (let i = 0; i < sorted.length; i++) {
    const x1 = sorted[i];
    const y1 = payoffAt(model, x1);
    if (Math.abs(y1) < 0.005) addRoot(x1);

    const x2 = sorted[i + 1];
    if (x2 === undefined || x2 === x1) continue;
    const y2 = payoffAt(model, x2);
    if ((y1 < 0 && y2 > 0) || (y1 > 0 && y2 < 0)) {
      addRoot(x1 + (0 - y1) * (x2 - x1) / (y2 - y1));
    }
  }

  const last = sorted[sorted.length - 1] || 0;
  const yLast = payoffAt(model, last);
  const slope = highSideSlope(model);
  if (slope !== 0) {
    const root = last - yLast / slope;
    if (root > last) addRoot(root);
  }

  return roots.sort((a, b) => a - b);
}

function samplePoints(model, low, high, steps = 96) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const px = low + (high - low) * i / steps;
    points.push({ px: price(px), pnl: payoffAt(model, px) });
  }
  return points;
}

export function summarizePayoff(model, {
  currentPrice = 0,
  extraPrices = [],
  labels = [],
} = {}) {
  const strikes = model.legs.map(leg => leg.strike);
  const breakpoints = uniqSorted([0, ...strikes]);
  const candidates = uniqSorted([0, ...strikes]);
  const highSlope = highSideSlope(model);
  const lowSlope = lowSideSlope(model);
  const candidatePnls = candidates.map(px => ({ px, pnl: payoffAt(model, px) }));

  let maxProfitUnlimited = highSlope > 0;
  let maxLossUnlimited = highSlope < 0;
  let maxPnl = maxProfitUnlimited ? null : Math.max(...candidatePnls.map(p => p.pnl));
  let minPnl = maxLossUnlimited ? null : Math.min(...candidatePnls.map(p => p.pnl));
  const breakevens = findBreakevens(model, breakpoints);

  const anchors = uniqSorted([currentPrice, ...strikes, ...breakevens, ...extraPrices]).filter(v => v > 0);
  const minAnchor = anchors.length ? Math.min(...anchors) : Math.max(1, currentPrice || 1);
  const maxAnchor = anchors.length ? Math.max(...anchors) : Math.max(1, currentPrice || 1);
  const span = Math.max((currentPrice || maxAnchor) * 0.18, maxAnchor - minAnchor, 1);
  const low = Math.max(0.01, Math.min((currentPrice || minAnchor) * 0.75, minAnchor - span * 0.35));
  const high = Math.max((currentPrice || maxAnchor) * 1.25, maxAnchor + span * 0.35);
  const points = samplePoints(model, low, high);

  const checkpoints = [];
  function addCheckpoint(label, px, note = '', kind = '') {
    const p = price(px);
    if (p === null) return;
    if (checkpoints.some(c => c.label === label && Math.abs(c.px - p) < 0.01)) return;
    checkpoints.push({ label, px: p, pnl: payoffAt(model, p), note, kind });
  }

  if (currentPrice) addCheckpoint('Now', currentPrice, '', 'now');
  breakevens.forEach((be, idx) => addCheckpoint(breakevens.length > 1 ? `BE ${idx + 1}` : 'Breakeven', be, 'P/L is about $0', 'be'));
  labels.forEach(item => addCheckpoint(item.label, item.px, item.note, item.kind));

  if (minPnl !== null) {
    const lossPoint = candidatePnls.find(p => Math.abs(p.pnl - minPnl) < 0.01);
    if (lossPoint && !checkpoints.some(c => Math.abs(c.pnl - lossPoint.pnl) < 0.01 && (c.kind === 'loss' || c.kind === 'short' || c.kind === 'profit'))) {
      addCheckpoint('Max loss point', lossPoint.px, 'Worst expiration point in this structure', 'loss');
    }
  }
  if (maxPnl !== null) {
    const profitPoint = candidatePnls.find(p => Math.abs(p.pnl - maxPnl) < 0.01);
    if (profitPoint && !checkpoints.some(c => Math.abs(c.pnl - profitPoint.pnl) < 0.01 && (c.kind === 'profit' || c.kind === 'short' || c.kind === 'long'))) {
      addCheckpoint('Max profit point', profitPoint.px, 'Best expiration point in this structure', 'profit');
    }
  }

  return {
    maxProfit: maxPnl !== null ? money(Math.max(0, maxPnl)) : null,
    maxLoss: minPnl !== null ? money(Math.max(0, -minPnl)) : null,
    maxProfitUnlimited,
    maxLossUnlimited,
    highSideSlope: money(highSlope),
    lowSideSlope: money(lowSlope),
    minPnl: minPnl !== null ? money(minPnl) : null,
    maxPnl: maxPnl !== null ? money(maxPnl) : null,
    collateral: minPnl !== null ? money(Math.max(0, -minPnl)) : null,
    breakevens,
    low: price(low),
    high: price(high),
    points,
    checkpoints,
  };
}

export function analyzePayoff(input = {}, summaryInput = {}) {
  const model = buildPayoffModel(input);
  return summarizePayoff(model, summaryInput);
}
