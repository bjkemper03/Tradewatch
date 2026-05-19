// =============================================================================
// api/analyze/strategies/custom.js
// =============================================================================

import { pct, safeNum } from './sharedMath.js';
import { payoffSummary, firstBreakeven, riskFieldsFromPayoff } from './sharedPayoff.js';
import { checkEarningsRisk, getSignal, modelNotes } from './sharedContext.js';

export function analyzeCustomPayoff(data, legs, expDateObj, dte, credit, prefs, isCredit = true) {
  const { price, hv30, supports, resistances, earnings } = data;
  const entry = safeNum(credit);
  const netPremiumPerShare = isCredit ? entry : -entry;
  const payoff = payoffSummary(legs, netPremiumPerShare, price);
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);
  const issues = [];

  if (payoff.maxLossUnlimited) {
    issues.push({ level:'critical', weight:6, msg:'Custom structure has undefined/naked risk' });
  }
  if (earningsCheck.risk) {
    issues.push({ level:'critical', weight:5, msg:`Earnings ${earningsCheck.date} within expiration` });
  }
  if (!payoff.breakevens.length) {
    issues.push({ level:'warning', weight:2, msg:'No breakeven found in modeled expiration range' });
  }

  return {
    strategyGroup: 'custom',
    signal: getSignal(issues),
    issues,
    price,
    entryType: isCredit ? 'credit' : 'debit',
    entryPremium: entry,
    breakevens: payoff.breakevens,
    breakeven: firstBreakeven(payoff),
    ...riskFieldsFromPayoff(payoff),
    vol: pct(hv30 || 0.30),
    supports,
    resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    modelNotes: modelNotes(data, {
      structureNote: 'Custom analysis uses the generic payoff engine from the exact entered legs. Probability and strategy-specific quality checks are intentionally limited.',
    }),
    payoff,
  };
}
