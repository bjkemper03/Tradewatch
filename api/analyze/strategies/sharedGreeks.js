// =============================================================================
// api/analyze/strategies/sharedGreeks.js
// Shared Greek helpers for strategy analysis.
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { ncdf, npdf, safeNum } from './sharedMath.js';

export function bsDelta(S, K, T, vol, type) {
  if (!S || !K || !T || !vol || T <= 0 || vol <= 0) return null;
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}

export function bsGreekSet(S, K, T, vol, type) {
  if (!S || !K || !T || !vol || T <= 0 || vol <= 0) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const isCall = type === 'call';
  const delta = isCall ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * vol * sqrtT);
  const theta = (-(S * npdf(d1) * vol) / (2 * sqrtT)) / 365;
  const vega = S * npdf(d1) * sqrtT / 100;
  const rho = (isCall ? K * T * ncdf(d2) : -K * T * ncdf(-d2)) / 100;
  return {
    delta: parseFloat(delta.toFixed(4)),
    gamma: parseFloat(gamma.toFixed(4)),
    theta: parseFloat(theta.toFixed(4)),
    vega: parseFloat(vega.toFixed(4)),
    rho: parseFloat(rho.toFixed(4)),
  };
}

export function completeGreeks(greeks, S, K, T, vol, type) {
  const fallback = bsGreekSet(S, K, T, vol, type);
  if (!fallback && !greeks) return null;
  return {
    ...(fallback || {}),
    ...(greeks || {}),
  };
}

export function getBestVol(greeks, hv30) {
  if (greeks && greeks.iv && greeks.iv > 0) return greeks.iv / 100;
  return hv30 || 0.30;
}

export function aggregateLegGreeks(chain, legs, fallbackVol, price, dte, optTypeFallback) {
  const totals = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  let found = false;
  let source = 'BS';

  for (const leg of legs) {
    const type = String(leg.t || optTypeFallback || 'PUT').toLowerCase();
    const strike = safeNum(leg.s);
    const qty = Math.max(1, safeNum(leg.n || 1, 1));
    const side = leg.a === 'BUY' ? 1 : -1;
    const g = extractGreeks(findChainContract(chain, strike, type));
    if (g) {
      ['delta', 'gamma', 'theta', 'vega', 'rho'].forEach(k => {
        if (g[k] != null) {
          totals[k] += side * qty * safeNum(g[k]);
          found = true;
          source = 'Tradier';
        }
      });
    } else if (strike && price && dte && fallbackVol && !found) {
      const bd = bsDelta(price, strike, dte / 365, fallbackVol, type);
      if (bd !== null) {
        totals.delta += side * qty * bd;
        found = true;
      }
    }
  }

  if (!found) return null;
  Object.keys(totals).forEach(k => { totals[k] = parseFloat(totals[k].toFixed(4)); });
  totals.source = source;
  return totals;
}

function legQty(leg) {
  return Math.max(1, safeNum(leg?.n || leg?.qty || 1, 1));
}

function roundGreekValue(value) {
  return value == null || !Number.isFinite(value) ? null : parseFloat(value.toFixed(4));
}

function mergeGreekFallback(rawGreeks, fallbackGreeks) {
  if (!rawGreeks && !fallbackGreeks) return null;
  return {
    ...(fallbackGreeks || {}),
    ...(rawGreeks || {}),
  };
}

export function getLegGreek(chain, leg, fallbackVol, price, dte, optTypeFallback) {
  const strike = safeNum(leg?.s || leg?.strike);
  const type = String(leg?.t || leg?.type || optTypeFallback || '').toLowerCase();
  if (!strike || !type) return null;

  const rawGreeks = extractGreeks(findChainContract(chain, strike, type));
  const fallbackGreeks = bsGreekSet(price, strike, dte / 365, fallbackVol, type);
  const greeks = mergeGreekFallback(rawGreeks, fallbackGreeks);
  if (!greeks) return null;
  const usedFallback = !rawGreeks || ['delta', 'gamma', 'theta', 'vega', 'rho'].some(k =>
    rawGreeks[k] == null && fallbackGreeks?.[k] != null
  );

  return {
    ...greeks,
    delta: roundGreekValue(greeks.delta),
    gamma: roundGreekValue(greeks.gamma),
    theta: roundGreekValue(greeks.theta),
    vega: roundGreekValue(greeks.vega),
    rho: roundGreekValue(greeks.rho),
    strike,
    type,
    action: String(leg?.a || leg?.action || '').toUpperCase(),
    qty: legQty(leg),
    source: rawGreeks && usedFallback ? 'Mixed' : rawGreeks ? 'Tradier' : 'BS',
  };
}

export function buildPositionGreeks(chain, legs, fallbackVol, price, dte, optTypeFallback, opts = {}) {
  const totals = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  const sources = new Set();
  let found = false;

  for (const leg of legs || []) {
    const greek = getLegGreek(chain, leg, fallbackVol, price, dte, optTypeFallback);
    if (!greek) continue;
    const side = String(leg?.a || leg?.action || '').toUpperCase() === 'BUY' ? 1 : -1;
    const qty = legQty(leg);
    ['delta', 'gamma', 'theta', 'vega', 'rho'].forEach(k => {
      if (greek[k] != null) {
        totals[k] += side * qty * safeNum(greek[k]);
        found = true;
      }
    });
    sources.add(greek.source);
  }

  if (opts.sharesDelta) {
    totals.delta += safeNum(opts.sharesDelta);
    sources.add('Shares');
    found = true;
  }

  if (!found) return null;
  Object.keys(totals).forEach(k => { totals[k] = roundGreekValue(totals[k]); });
  totals.source = sources.size > 1 ? 'Mixed' : [...sources][0] || 'Unknown';
  return totals;
}

export function buildKeyLegGreeks(entries) {
  return Object.fromEntries(
    Object.entries(entries || {}).filter(([, value]) => value != null)
  );
}
