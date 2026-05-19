// =============================================================================
// api/analyze/strategies/sharedPayoff.js
// Shared payoff helpers for strategy analysis.
// =============================================================================

import { analyzePayoff } from '../payoffEngine.js';
import { safeNum } from './sharedMath.js';

export function payoffSummary(legs, netPremiumPerShare, price, labels = [], opts = {}) {
  const qtys = (legs || []).map(l => Math.max(1, safeNum(l.n || l.qty || 1, 1)));
  const sameQty = qtys.length > 0 && qtys.every(q => Math.abs(q - qtys[0]) < 0.0001);
  return analyzePayoff({
    legs,
    netPremiumPerShare,
    premiumContracts: opts.premiumContracts || (sameQty ? qtys[0] : 1),
    underlyingShares: opts.underlyingShares || 0,
    underlyingBasis: opts.underlyingBasis || 0,
  }, {
    currentPrice: price,
    labels,
    extraPrices: opts.extraPrices || [],
  });
}

export function firstBreakeven(payoff, fallback = null) {
  return payoff?.breakevens?.length ? payoff.breakevens[0] : fallback;
}

export function collateralFromPayoff(payoff, fallback = 0) {
  if (!payoff) return fallback;
  if (payoff.maxLossUnlimited) return null;
  return payoff.collateral ?? payoff.maxLoss ?? fallback;
}

export function riskFieldsFromPayoff(payoff) {
  return {
    maxProfit: payoff.maxProfit,
    maxLoss: payoff.maxLoss,
    collateral: collateralFromPayoff(payoff),
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    maxLossUnlimited: payoff.maxLossUnlimited,
  };
}
