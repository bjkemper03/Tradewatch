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
  finalizeScoredSignal,
  modelNotes,
  pushCompletenessIssue,
  pushCushionIssue,
  pushDataConfidenceIssues,
  pushDteFitIssue,
  pushEarningsScoreIssue,
} from './sharedContext.js';

export function analyzeCoveredCall(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  const sellLeg = legs.find(l => l.a === 'SELL' && l.t === 'CALL');
  if (!sellLeg) return { error: 'Covered call requires a short CALL leg' };
  const ownsShares = prefs?.coveredCallOwnsShares ?? prefs?.ownsShares ?? false;
  const wantsAssignment = prefs?.coveredCallWantsAssignment ?? prefs?.wantsAssignment ?? false;
  const rawShareBasis = safeNum(prefs?.coveredCallShareBasis);
  const shareBasis = ownsShares && rawShareBasis > 0 ? rawShareBasis : price;
  const shareBasisProvided = ownsShares && rawShareBasis > 0;

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
  ], { underlyingShares: ownsShares ? 100 * callQty : 0, underlyingBasis: shareBasis });
  const maxProfit     = payoff.maxProfit;
  const maxLoss       = payoff.maxLoss;
  const downsideProtection = cr; // premium reduces cost basis
  const breakeven     = firstBreakeven(payoff, parseFloat((shareBasis - cr).toFixed(2)));
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
    issues.push({ id:'covered_call_shares_not_confirmed', level:'red', category:'structure', scope:'strategy', strategy, metric:'ownsShares', value:false, scoreImpact:-55, message:'Covered call requires owned shares; otherwise the short call is naked undefined risk' });
  }
  // Owned-share covered calls reuse an existing equity position, so max loss is
  // stock exposure, not new option collateral. Until share cost basis and total
  // account exposure are tracked across the portfolio, account-risk scoring here
  // would overstate the risk of the call sale itself.
  pushEarningsScoreIssue(issues, strategy, earningsCheck, dte);
  if (!(wantsAssignment && strike < price)) {
    pushCushionIssue(issues, strategy, {
      distance: strike - price,
      expectedMove: em,
      metric: 'callStrikeCushionToExpectedMove',
      messagePrefix: 'Covered-call assignment cushion',
    });
  }
  const premiumSharePct = price > 0 ? parseFloat((cr / price * 100).toFixed(2)) : null;
  if (premiumSharePct != null && premiumSharePct < 0.5) {
    issues.push({ id:'covered_call_efficiency_low', level:'red', category:'compensation', scope:'strategy', strategy, metric:'premiumSharePct', value:premiumSharePct, redAt:0.5, scoreImpact:-25, message:`Premium is ${premiumSharePct}% of share value; placeholder efficiency threshold for owner review` });
  } else if (premiumSharePct != null && premiumSharePct < 1) {
    issues.push({ id:'covered_call_efficiency_moderate', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'premiumSharePct', value:premiumSharePct, warnAt:1, scoreImpact:-15, message:`Premium is ${premiumSharePct}% of share value; placeholder efficiency threshold for owner review` });
  }
  pushDteFitIssue(issues, strategy, dte, { min:21, max:45, label:'covered-call' });
  if (strike < price && !wantsAssignment) {
    issues.push({ id:'covered_call_itm_assignment_risk', level:'red', category:'risk', scope:'strategy', strategy, metric:'strike', value:strike, redAt:price, scoreImpact:-15, message:`Strike $${strike} below current price $${price} -- ITM call, immediate assignment risk` });
  } else if (strike < price) {
    issues.push({ id:'covered_call_itm_assignment_intent', level:'info', category:'context', scope:'context', strategy, metric:'strike', value:strike, scoreImpact:0, message:`Strike $${strike} below current price $${price}; assignment is likely and marked as acceptable intent` });
  }
  if (upsideCapPct < 1 && !wantsAssignment) {
    issues.push({ id:'covered_call_low_upside_cap', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'upsideCapPct', value:upsideCapPct, warnAt:1, scoreImpact:-15, message:`Only ${upsideCapPct}% upside before shares called away; placeholder tradeoff threshold for owner review` });
  }
  if (absDelta && wantsAssignment) {
    if (absDelta < 0.15) {
      issues.push({ id:'covered_call_delta_assignment_unlikely', level:'red', category:'probability', scope:'strategy', strategy, metric:'absDelta', value:absDelta, redAt:0.15, scoreImpact:-20, message:`Delta ${absDelta.toFixed(3)} -- assignment is unlikely despite assignment intent; placeholder threshold for owner review` });
    } else if (absDelta < 0.25) {
      issues.push({ id:'covered_call_delta_assignment_low', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'absDelta', value:absDelta, warnAt:0.25, scoreImpact:-10, message:`Delta ${absDelta.toFixed(3)} -- assignment odds are low for an assignment-focused covered call; placeholder threshold for owner review` });
    } else {
      issues.push({ id:'covered_call_delta_assignment_intent', level:'info', category:'probability', scope:'context', strategy, metric:'absDelta', value:absDelta, affectsSignal:false, scoreImpact:0, message:`Delta ${absDelta.toFixed(3)} -- assignment probability is consistent with assignment intent` });
    }
  } else if (absDelta && absDelta > 0.70) {
    issues.push({ id:'covered_call_delta_high', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'absDelta', value:absDelta, warnAt:0.70, scoreImpact:-20, message:`Delta ${absDelta.toFixed(3)} -- high probability of assignment; placeholder probability threshold for owner review` });
  }
  pushDataConfidenceIssues(issues, strategy, data, { greeks, ivAvailable: greeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  const yieldData = wheelData?.ifNotCalled?.yieldData;

  return {
    strategyGroup: 'covered_call',
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

    price, strike, breakeven,
    upsideCap, upsideCapPct,
    cushionPct: upsideCapPct,
    downsideProtection,
    maxProfit,
    collateral: ownsShares ? 0 : null,
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    maxLossUnlimited: payoff.maxLossUnlimited,
    ownsShares,
    wantsAssignment,
    shareBasis,
    shareBasisProvided,
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
    probWorthless: probNotCalled,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,
    modelNotes: modelNotes(data, {
      greeks,
      structureNote: shareBasisProvided
        ? 'Covered-call max profit and breakeven use the entered average share price.'
        : 'Covered-call return uses current stock price as share basis. Add actual average share price before treating return as exact.',
    }),
    maxLoss,
    payoff,
  };
}
