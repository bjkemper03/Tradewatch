// =============================================================================
// api/analyze/strategies/coveredCall.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcWheelScenarios } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven } from './sharedPayoff.js';
import {
  checkEarningsRisk,
  finalizeUniversalSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushEarningsIssue,
} from './sharedContext.js';

export function analyzeCoveredCall(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  const sellLeg = legs.find(l => l.a === 'SELL' && l.t === 'CALL');
  if (!sellLeg) return { error: 'Covered call requires a short CALL leg' };
  const ownsShares = prefs?.ownsShares ?? prefs?.coveredCallOwnsShares ?? true;
  const wantsAssignment = prefs?.wantsAssignment ?? prefs?.coveredCallWantsAssignment ?? false;

  const strike = safeNum(sellLeg.s);
  if (!strike) return { error: 'Enter the call strike price' };

  const contract = findChainContract(chain, strike, 'call');
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);
  const callQty = Math.max(1, safeNum(sellLeg.n || sellLeg.qty || 1, 1));
  const shortCallGreeks = getLegGreek(chain, sellLeg, vol, price, dte, 'call');
  const positionGreeks = buildPositionGreeks(chain, [sellLeg], vol, price, dte, 'call', {
    sharesDelta: callQty,
  });
  const keyLegGreeks = buildKeyLegGreeks({
    shares: { delta: callQty, source: 'Shares' },
    shortCall: shortCallGreeks,
  });

  let absDelta = null, deltaSource = 'BS';
  if (greeks?.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = 'Tradier';
  } else if (dte) {
    const bd = bsDelta(price, strike, dte / 365, vol, 'call');
    if (bd !== null) { absDelta = Math.abs(bd); }
  }
  const scoringGreeks = {
    delta: absDelta,
    deltaLabel: 'Short call delta',
  };

  const payoff        = payoffSummary(legs, cr, price, [
    { label: 'Call strike', px: strike, note: 'Called away above here', kind: 'short' },
    { label: 'Stock $0', px: 0, note: 'Theoretical downside endpoint', kind: 'loss' },
  ], { underlyingShares: 100 * callQty, underlyingBasis: price });
  const maxProfit     = payoff.maxProfit;
  const maxLoss       = payoff.maxLoss;
  const downsideProtection = cr; // premium reduces cost basis
  const breakeven     = firstBreakeven(payoff, parseFloat((price - cr).toFixed(2))); // current-price basis
  const upsideCap     = strike;
  const upsideCapPct  = parseFloat(((strike - price) / price * 100).toFixed(1));
  const em            = calcExpectedMove(price, vol, dte);

  // Wheel scenarios
  const wheelData = calcWheelScenarios(price, strike, cr, dte, 'call');

  // Probability of being called away: below strike means not called, above strike means called.
  const probNotCalled  = calcPOW(price, strike, vol, dte, 'put');
  const probCalled     = probNotCalled != null ? parseFloat((1 - probNotCalled).toFixed(4)) : null;

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  const issues = [];
  const strategy = 'covered_call';
  if (!payoff.maxLossUnlimited && (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Covered-call payoff could not be calculated reliably');
  }
  if (!ownsShares) {
    issues.push({ id:'covered_call_shares_not_confirmed', level:'red', category:'structure', scope:'strategy', strategy, blocking:true, message:'Covered call requires owned shares; otherwise the short call may be naked' });
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsIssue(issues, strategy, earningsCheck, {
    riskLevel: 'red',
    riskBlocking: true,
    riskMessage: `Earnings ${earningsCheck.date} falls before expiration`,
  });
  if (strike < price && !wantsAssignment) {
    issues.push({ id:'covered_call_itm_assignment_risk', level:'red', category:'risk', scope:'strategy', strategy, metric:'strike', value:strike, blocking:true, message:`Strike $${strike} below current price $${price} -- ITM call, immediate assignment risk` });
  } else if (strike < price) {
    issues.push({ id:'covered_call_itm_assignment_intent', level:'yellow', category:'context', scope:'strategy', strategy, metric:'strike', value:strike, message:`Strike $${strike} below current price $${price}; assignment is likely and marked as acceptable intent` });
  }
  if (upsideCapPct < 1 && !wantsAssignment) {
    issues.push({ id:'covered_call_low_upside_cap', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'upsideCapPct', value:upsideCapPct, warnAt:1, message:`Only ${upsideCapPct}% upside before shares called away` });
  }
  if (absDelta && absDelta > 0.70 && !wantsAssignment) {
    issues.push({ id:'covered_call_delta_high', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'absDelta', value:absDelta, warnAt:0.70, message:`Delta ${absDelta.toFixed(3)} -- high probability of assignment` });
  } else if (absDelta && absDelta > 0.70) {
    issues.push({ id:'covered_call_delta_high_assignment_intent', level:'info', category:'probability', scope:'context', strategy, metric:'absDelta', value:absDelta, affectsSignal:false, message:`Delta ${absDelta.toFixed(3)} -- high assignment probability, consistent with assignment intent` });
  }
  const decision = finalizeUniversalSignal(issues, { cautionOnAnyMeaningfulIssue: true });

  const yieldData = wheelData?.ifNotCalled?.yieldData;

  return {
    strategyGroup: 'covered_call',
    signal: decision.signal,
    issues: decision.issues,

    price, strike, breakeven,
    upsideCap, upsideCapPct,
    downsideProtection,
    maxProfit,
    collateral: 0,
    ownsShares,
    wantsAssignment,
    absDelta, deltaSource,
    greeks: greeks || null,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    wheelScenarios: wheelData,
    yieldData,

    probCalled, probNotCalled,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,
    modelNotes: modelNotes(data, {
      greeks,
      structureNote: 'Covered-call return uses current stock price as share basis. Add actual share cost basis before treating wheel return as exact.',
    }),
    maxLoss,
    payoff,
  };
}
