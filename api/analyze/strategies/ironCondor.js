// =============================================================================
// api/analyze/strategies/ironCondor.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcCondorProbs } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary } from './sharedPayoff.js';
import {
  checkEarningsRisk,
  finalizeScoredSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushCushionIssue,
  pushDataConfidenceIssues,
  pushDteFitIssue,
  pushEarningsScoreIssue,
  pushUndefinedRiskIssue,
} from './sharedContext.js';

export function analyzeIronCondor(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  // Identify all four legs
  const puts  = legs.filter(l => l.t === 'PUT');
  const calls = legs.filter(l => l.t === 'CALL');
  const sellPut  = puts.find(l => l.a === 'SELL');
  const buyPut   = puts.find(l => l.a === 'BUY');
  const sellCall = calls.find(l => l.a === 'SELL');
  const buyCall  = calls.find(l => l.a === 'BUY');

  if (!sellPut || !buyPut || !sellCall || !buyCall) {
    return { error: 'Iron condor requires 4 legs: sell put, buy put, sell call, buy call' };
  }
  if (puts.length !== 2 || calls.length !== 2) {
    return { error: 'Iron condor expects exactly two put legs and two call legs' };
  }

  const shortPut  = safeNum(sellPut.s);
  const longPut   = safeNum(buyPut.s);
  const shortCall = safeNum(sellCall.s);
  const longCall  = safeNum(buyCall.s);

  if (!shortPut || !longPut || !shortCall || !longCall) {
    return { error: 'Enter all four strike prices' };
  }

  const putWidth  = Math.abs(shortPut  - longPut);
  const callWidth = Math.abs(longCall  - shortCall);
  const maxWidth  = Math.max(putWidth, callWidth);
  const isIronButterfly = Math.abs(shortPut - shortCall) < 0.50;

  // Get vol from put side chain
  const putContract  = findChainContract(chain, shortPut,  'put');
  const callContract = findChainContract(chain, shortCall, 'call');
  const putGreeks    = extractGreeks(putContract);
  const callGreeks   = extractGreeks(callContract);
  const vol          = getBestVol(putGreeks || callGreeks, hv30);
  const positionGreeks = buildPositionGreeks(chain, legs, vol, price, dte);
  const keyLegGreeks = buildKeyLegGreeks({
    shortPut: getLegGreek(chain, sellPut, vol, price, dte, 'put'),
    shortCall: getLegGreek(chain, sellCall, vol, price, dte, 'call'),
  });

  // Deltas
  const putDelta  = putGreeks?.delta  != null ? Math.abs(putGreeks.delta)  : Math.abs(bsDelta(price, shortPut,  dte/365, vol, 'put')  || 0);
  const callDelta = callGreeks?.delta != null ? Math.abs(callGreeks.delta) : Math.abs(bsDelta(price, shortCall, dte/365, vol, 'call') || 0);
  const scoringGreeks = {
    putDelta,
    callDelta,
    deltaLabel: 'Short put / short call delta',
  };

  // Core metrics
  const payoff = payoffSummary(legs, cr, price, [
    { label: 'Put short', px: shortPut, note: 'Max-profit zone starts above here', kind: 'short' },
    { label: 'Call short', px: shortCall, note: 'Max-profit zone ends below here', kind: 'short' },
    { label: 'Put max loss', px: longPut, note: 'Lower wing fully breached', kind: 'loss' },
    { label: 'Call max loss', px: longCall, note: 'Upper wing fully breached', kind: 'loss' },
  ]);
  const maxProfit = payoff.maxProfit;
  const maxLoss   = payoff.maxLoss;
  const putBreakeven  = payoff.breakevens[0] ?? parseFloat((shortPut  - cr).toFixed(2));
  const callBreakeven = payoff.breakevens[1] ?? parseFloat((shortCall + cr).toFixed(2));
  const tentWidth     = parseFloat((callBreakeven - putBreakeven).toFixed(2));

  // Distance from price to each short strike
  const putCushionPct  = parseFloat(((price - shortPut)  / price * 100).toFixed(1));
  const callCushionPct = parseFloat(((shortCall - price) / price * 100).toFixed(1));
  const minCushionPct  = Math.min(putCushionPct, callCushionPct);

  const em = calcExpectedMove(price, vol, dte);

  // Probability
  const probs = calcCondorProbs(price, shortPut, shortCall, longPut, longCall, vol, dte, putBreakeven, callBreakeven);

  // Earnings
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  // Issues
  const issues = [];
  const strategy = isIronButterfly ? 'iron_butterfly' : 'iron_condor';
  const cushMin  = prefs?.cushionMin || 5;
  const deltaMax = prefs?.deltaHigh  || 0.30;

  if (!payoff.maxLossUnlimited && (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Iron condor risk/reward could not be calculated reliably');
  }
  if (payoff.maxLossUnlimited) {
    pushUndefinedRiskIssue(issues, strategy, { message: 'Undefined risk detected in an iron condor model' });
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsScoreIssue(issues, strategy, earningsCheck, dte);
  pushCushionIssue(issues, strategy, {
    distance: Math.min(price - shortPut, shortCall - price),
    expectedMove: em,
    metric: 'shortStrikeCushionToExpectedMove',
    messagePrefix: 'Iron condor nearest short-strike cushion',
  });
  const creditWingPct = maxWidth > 0 ? parseFloat((cr / maxWidth * 100).toFixed(1)) : null;
  if (creditWingPct != null && creditWingPct < 10) {
    issues.push({ id:'iron_condor_efficiency_low', level:'red', category:'compensation', scope:'strategy', strategy, metric:'creditWingPct', value:creditWingPct, redAt:10, scoreImpact:-25, message:`Credit is ${creditWingPct}% of widest wing; placeholder efficiency threshold for owner review` });
  } else if (creditWingPct != null && creditWingPct < 20) {
    issues.push({ id:'iron_condor_efficiency_moderate', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'creditWingPct', value:creditWingPct, warnAt:20, scoreImpact:-15, message:`Credit is ${creditWingPct}% of widest wing; placeholder efficiency threshold for owner review` });
  }
  pushDteFitIssue(issues, strategy, dte, { min:21, max:45, label:'iron-condor' });
  if (minCushionPct < 0) {
    issues.push({ id:'iron_condor_price_outside_tent', level:'red', category:'risk', scope:'strategy', strategy, metric:'minCushionPct', value:minCushionPct, redAt:0, scoreImpact:-30, message:'Price already outside the tent -- do not open' });
  } else if (minCushionPct < cushMin) {
    issues.push({ id:'iron_condor_tight_cushion', level:'yellow', category:'risk', scope:'strategy', strategy, metric:'minCushionPct', value:minCushionPct, warnAt:cushMin, scoreImpact:-15, message:`Tight cushion: put side ${putCushionPct}%, call side ${callCushionPct}%` });
  }
  const worstShortDelta = Math.max(putDelta, callDelta);
  if (worstShortDelta > deltaMax) {
    issues.push({ id:'iron_condor_worst_short_delta_high', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'worstShortDelta', value:worstShortDelta, warnAt:deltaMax, scoreImpact:worstShortDelta > deltaMax * 1.1 ? -20 : -10, message:`Worst short-leg delta ${worstShortDelta.toFixed(3)} is above ${deltaMax} placeholder target (put ${putDelta.toFixed(3)}, call ${callDelta.toFixed(3)})` });
  }
  if (isIronButterfly) {
    issues.push({ id:'iron_butterfly_pin_risk', level:'yellow', category:'structure', scope:'strategy', strategy, scoreImpact:-10, message:'Iron butterfly -- max profit only if price pins at strike. Very tight target.' });
  }
  pushDataConfidenceIssues(issues, strategy, data, { greeks: putGreeks || callGreeks, ivAvailable: putGreeks?.iv != null || callGreeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  return {
    strategyGroup: strategy,
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

    price, shortPut, longPut, shortCall, longCall,
    putWidth, callWidth, maxWidth,
    putBreakeven, callBreakeven, tentWidth,
    putCushionPct, callCushionPct, minCushionPct,
    maxProfit, maxLoss,
    putDelta, callDelta,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
    iv: putGreeks?.iv || callGreeks?.iv || null,
    vol: pct(vol),
    em,

    probMaxProfit:   probs.probMaxProfit,
    probAnyProfit:   probs.probAnyProfit,
    probInPutWing:   probs.probInPutWing,
    probInCallWing:  probs.probInCallWing,
    probMaxLoss:     probs.probMaxLossEither,
    probTouchPutShort:  probs.probTouchPutShort,
    probTouchCallShort: probs.probTouchCallShort,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,
    isIronButterfly,
    modelNotes: modelNotes(data, {
      greeks: putGreeks || callGreeks,
      structureNote: isIronButterfly
        ? 'Iron butterfly max profit is a pin-at-strike estimate, not a broad profit zone.'
        : null,
    }),
    payoff,
  };
}
