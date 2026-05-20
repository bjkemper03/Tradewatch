import { findChainContract } from './dataFetch.js';

function num(v, fallback = null) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  return v == null ? null : Math.round(v * 100);
}

function legQty(leg) {
  return Math.max(1, num(leg?.n || leg?.qty || 1, 1));
}

function normalizeLegs(legs = []) {
  return legs.map(leg => ({
    action: String(leg.a || leg.action || '').toUpperCase(),
    type: String(leg.t || leg.type || '').toUpperCase(),
    qty: legQty(leg),
    strike: num(leg.s || leg.strike),
  })).filter(leg => leg.strike != null);
}

function contractLiquidity(chain, leg) {
  const contract = findChainContract(chain, leg.strike, leg.type);
  if (!contract) {
    return {
      strike: leg.strike,
      type: leg.type,
      action: leg.action,
      missingQuote: true,
      score: 0,
      grade: 'Unknown',
    };
  }

  const bid = num(contract.bid);
  const ask = num(contract.ask);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : num(contract.last);
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;
  const spreadPct = spread != null && mid > 0 ? spread / mid : null;
  const openInterest = num(contract.open_interest ?? contract.openinterest, 0);
  const volume = num(contract.volume, 0);

  let score = 100;
  if (spread == null || bid == null || ask == null || bid <= 0 || ask <= 0) score -= 45;
  else if (spreadPct != null && spreadPct > 0.25) score -= 40;
  else if (spreadPct != null && spreadPct > 0.12) score -= 24;
  else if (spreadPct != null && spreadPct > 0.07) score -= 12;

  if (openInterest < 50) score -= 28;
  else if (openInterest < 200) score -= 16;
  else if (openInterest < 500) score -= 8;

  if (volume < 5) score -= 16;
  else if (volume < 25) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 78 ? 'Good' : score >= 58 ? 'Okay' : score >= 38 ? 'Thin' : 'Poor';

  return {
    strike: leg.strike,
    type: leg.type,
    action: leg.action,
    bid,
    ask,
    mid: mid != null ? Number(mid.toFixed(2)) : null,
    spread: spread != null ? Number(spread.toFixed(2)) : null,
    spreadPct: spreadPct != null ? Math.round(spreadPct * 100) : null,
    openInterest,
    volume,
    score,
    grade,
  };
}

function buildLiquidity(chain, legs) {
  if (!chain || !chain.length) {
    return {
      grade: 'Unknown',
      score: null,
      label: 'No option chain',
      detail: 'Liquidity unavailable',
      legs: [],
    };
  }

  const legDetails = normalizeLegs(legs).map(leg => contractLiquidity(chain, leg));
  if (!legDetails.length) {
    return {
      grade: 'Unknown',
      score: null,
      label: 'No legs',
      detail: 'Liquidity unavailable',
      legs: [],
    };
  }

  const worst = legDetails.reduce((a, b) => (a.score <= b.score ? a : b));
  const avgSpread = legDetails
    .map(l => l.spread)
    .filter(v => v != null)
    .reduce((sum, v, _, arr) => sum + v / arr.length, 0);
  const minOi = Math.min(...legDetails.map(l => l.openInterest || 0));
  const totalVolume = legDetails.reduce((sum, l) => sum + (l.volume || 0), 0);

  return {
    grade: worst.grade,
    score: worst.score,
    label: worst.grade,
    detail: avgSpread ? `Avg bid/ask $${avgSpread.toFixed(2)}` : 'Check bid/ask before entry',
    avgBidAsk: avgSpread ? Number(avgSpread.toFixed(2)) : null,
    minOpenInterest: Number.isFinite(minOi) ? minOi : null,
    totalVolume,
    worstLeg: worst,
    legs: legDetails,
  };
}

function buildDteSummary(dte, prefs = {}, strategyGroup) {
  if (dte == null) return { label: 'Unknown', tone: 'neutral', detail: 'No expiration date' };
  const low = num(prefs.dteLow, 7);
  const high = num(prefs.dteHigh, 45);
  let tone = 'good';
  let label = `${dte} DTE`;
  let detail = `${low}-${high} DTE preference`;

  if (dte <= 1) {
    tone = 'bad';
    detail = 'Very short-term timing risk';
  } else if (dte < low) {
    tone = dte < 7 ? 'bad' : 'warn';
    detail = 'Shorter than your preferred range';
  } else if (dte > high) {
    tone = 'warn';
    detail = 'Longer than your preferred range';
  }

  if ((strategyGroup === 'long_call' || strategyGroup === 'long_put') && dte < 14) {
    tone = 'warn';
    detail = 'Theta decay can accelerate here';
  }

  return { label, tone, detail, low, high };
}

function buildEarningsSummary(data, result, dte) {
  const date = result.earningsDate || data.earnings?.date || null;
  if (result.earningsUnknown || (!date && !result.earningsRisk)) {
    return { label: 'Earnings unknown', tone: 'neutral', detail: 'Date unavailable', date: null };
  }
  if (result.earningsRisk) {
    return { label: 'Earnings risk', tone: 'bad', detail: date || 'Date unavailable', date };
  }
  return { label: 'No earnings risk', tone: 'good', detail: dte != null ? `${date}` : date, date };
}

function formatBreakeven(result) {
  const values = [
    result.breakeven,
    result.lowerBE,
    result.upperBE,
    result.putBreakeven,
    result.callBreakeven,
  ].filter(v => v != null);
  if (!values.length && result.breakevens?.length) return result.breakevens;
  return values;
}

function buildUniversalMetrics(result) {
  const sg = result.strategyGroup || '';
  const cushion = result.cushionPct ?? result.minCushionPct ?? result.beCushionPct ?? null;
  const probWorthless = result.probWorthless ?? result.probMaxProfit ?? null;
  let theta = result.dailyThetaDollars ??
    (result.positionGreeks?.theta != null ? result.positionGreeks.theta * 100 : null) ??
    (result.dailyDecay != null ? -Math.abs(result.dailyDecay * 100) : null) ??
    (result.greeks?.theta != null ? -result.greeks.theta * 100 : null);

  return {
    cushionPct: cushion,
    maxProfit: result.maxProfit ?? null,
    maxProfitUnlimited: !!result.maxProfitUnlimited,
    maxLoss: result.maxLoss ?? result.collateral ?? null,
    maxLossUnlimited: !!result.maxLossUnlimited,
    breakevens: formatBreakeven(result),
    probWorthless: probWorthless != null ? pct(probWorthless) : null,
    probWorthlessTone: sg === 'long_call' || sg === 'long_put' ? 'bad' : 'good',
    dailyTheta: theta != null ? Number(theta.toFixed(2)) : null,
    dailyThetaTone: theta == null ? 'neutral' : theta >= 0 ? 'good' : 'bad',
  };
}

function buildGreeks(result) {
  const g = result.positionGreeks || result.greeks || {};
  return {
    delta: g.delta ?? result.absDelta ?? null,
    gamma: g.gamma ?? null,
    theta: g.theta ?? null,
    vega: g.vega ?? null,
    rho: g.rho ?? null,
  };
}

export function buildAnalysisSummary({ data, result, legs, dte, prefs }) {
  return {
    version: 1,
    dte: buildDteSummary(dte, prefs, result.strategyGroup),
    earnings: buildEarningsSummary(data, result, dte),
    liquidity: buildLiquidity(data.chain, legs),
    greeks: buildGreeks(result),
    universal: buildUniversalMetrics(result),
  };
}
