// =============================================================================
// api/analyze/strategies/custom.js
// =============================================================================

import { pct, safeNum } from './sharedMath.js';
import { buildPositionGreeks } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven, riskFieldsFromPayoff } from './sharedPayoff.js';
import {
  checkEarningsRisk,
  finalizeUniversalSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushEarningsIssue,
  pushUndefinedRiskIssue,
} from './sharedContext.js';

export function analyzeCustomPayoff(data, legs, expDateObj, dte, credit, prefs, isCredit = true) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const entry = safeNum(credit);
  const netPremiumPerShare = isCredit ? entry : -entry;
  const payoff = payoffSummary(legs, netPremiumPerShare, price);
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);
  const positionGreeks = buildPositionGreeks(chain, legs, hv30 || 0.30, price, dte);
  const issues = [];
  const strategy = 'custom';

  if (!payoff.maxLossUnlimited && (payoff.maxLoss == null || !Number.isFinite(payoff.maxLoss))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Custom payoff risk could not be calculated reliably');
  }
  if (payoff.maxLossUnlimited) {
    pushUndefinedRiskIssue(issues, strategy, {
      message: 'Custom structure has undefined or naked risk',
    });
  }
  pushAccountRiskIssues(issues, strategy, payoff.maxLoss, prefs);
  pushEarningsIssue(issues, strategy, earningsCheck, {
    riskLevel: 'red',
    riskBlocking: true,
    riskMessage: `Earnings ${earningsCheck.date} falls before expiration`,
  });
  if (!payoff.breakevens.length) {
    issues.push({ id:'custom_no_breakeven', level:'yellow', category:'model', scope:'strategy', strategy, metric:'breakevens', value:0, message:'No breakeven found in modeled expiration range' });
  }
  const decision = finalizeUniversalSignal(issues, { cautionOnAnyMeaningfulIssue: true });

  return {
    strategyGroup: 'custom',
    signal: decision.signal,
    issues: decision.issues,
    price,
    entryType: isCredit ? 'credit' : 'debit',
    entryPremium: entry,
    breakevens: payoff.breakevens,
    breakeven: firstBreakeven(payoff),
    ...riskFieldsFromPayoff(payoff),
    positionGreeks,
    keyLegGreeks: {},
    scoringGreeks: {},
    vol: pct(hv30 || 0.30),
    supports,
    resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,
    modelNotes: modelNotes(data, {
      structureNote: 'Custom analysis uses the generic payoff engine from the exact entered legs. Probability and strategy-specific quality checks are intentionally limited.',
    }),
    payoff,
  };
}
