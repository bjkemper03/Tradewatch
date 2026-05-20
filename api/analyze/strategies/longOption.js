// =============================================================================
// api/analyze/strategies/longOption.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcLongOptionTargets } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven, collateralFromPayoff } from './sharedPayoff.js';
import {
  checkEarningsRisk,
  finalizeScoredSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushDataConfidenceIssues,
  pushDteFitIssue,
  pushEarningsScoreIssue,
} from './sharedContext.js';

export function analyzeLongOption(data, legs, expDateObj, dte, premium, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const prem = safeNum(premium);

  const buyLeg = legs.find(l => l.a === 'BUY');
  if (!buyLeg) return { error: 'Long option requires a BUY leg' };

  const strike  = safeNum(buyLeg.s);
  const optType = (buyLeg.t || 'CALL').toLowerCase();
  const isCall  = optType === 'call';

  if (!strike) return { error: 'Enter the strike price' };

  const contract = findChainContract(chain, strike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);
  const longLegGreeks = getLegGreek(chain, buyLeg, vol, price, dte, optType);
  const positionGreeks = buildPositionGreeks(chain, [buyLeg], vol, price, dte, optType);
  const keyLegGreeks = buildKeyLegGreeks(isCall
    ? { longCall: longLegGreeks }
    : { longPut: longLegGreeks });

  const absDelta = greeks?.delta != null
    ? Math.abs(greeks.delta)
    : Math.abs(bsDelta(price, strike, dte / 365, vol, optType) || 0);
  const scoringGreeks = {
    delta: absDelta,
    deltaLabel: isCall ? 'Long call delta' : 'Long put delta',
  };

  // Detailed probability analysis with realistic targets
  const targetData = calcLongOptionTargets(price, strike, prem, vol, dte, optType);

  const em      = calcExpectedMove(price, vol, dte);
  const payoff  = payoffSummary(legs, -prem, price, [
    { label: 'Strike', px: strike, note: isCall ? 'Call begins intrinsic value above here' : 'Put begins intrinsic value below here', kind: 'long' },
  ]);
  const breakeven = firstBreakeven(payoff, targetData.breakeven);
  const nowPnl = parseFloat((-prem * 100 + (isCall
    ? Math.max(0, price - strike)
    : Math.max(0, strike - price)) * 100).toFixed(2));
  payoff.checkpoints = isCall
    ? [
        { label: 'Now', px: price, pnl: nowPnl, note: '', kind: 'now' },
        { label: 'Breakeven', px: breakeven, pnl: 0, note: 'P/L is about $0', kind: 'be' },
        { label: `Max loss $${strike}-`, px: strike, pnl: -payoff.maxLoss, note: 'Call expires worthless at or below strike', kind: 'loss' },
      ]
    : [
        { label: 'Now', px: price, pnl: nowPnl, note: '', kind: 'now' },
        { label: 'Breakeven', px: breakeven, pnl: 0, note: 'P/L is about $0', kind: 'be' },
        { label: `Max loss $${strike}+`, px: strike, pnl: -payoff.maxLoss, note: 'Put expires worthless at or above strike', kind: 'loss' },
        { label: 'Max profit $0', px: 0, pnl: payoff.maxProfit, note: 'Theoretical if stock goes to $0', kind: 'profit' },
      ];
  const maxLoss = payoff.maxLoss;

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  const issues = [];
  const strategy = isCall ? 'long_call' : 'long_put';
  // Long options: inform, don't gatekeep -- but flag obvious problems
  if (maxLoss == null || !Number.isFinite(maxLoss)) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Long option max loss could not be calculated reliably');
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsScoreIssue(issues, strategy, earningsCheck, dte);
  pushDteFitIssue(issues, strategy, dte, { min:45, max:180, severeBelow:21, label:'long-option' });
  if (targetData.probTouchBreakeven != null && targetData.probTouchBreakeven < 0.30) {
    issues.push({ id:'long_option_efficiency_low', level:'red', category:'compensation', scope:'strategy', strategy, metric:'probTouchBreakeven', value:targetData.probTouchBreakeven, redAt:0.30, scoreImpact:-25, message:`${pct(targetData.probTouchBreakeven)}% probability of touching breakeven; placeholder efficiency threshold for owner review` });
  } else if (targetData.probTouchBreakeven != null && targetData.probTouchBreakeven < 0.45) {
    issues.push({ id:'long_option_efficiency_moderate', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'probTouchBreakeven', value:targetData.probTouchBreakeven, warnAt:0.45, scoreImpact:-15, message:`${pct(targetData.probTouchBreakeven)}% probability of touching breakeven; placeholder efficiency threshold for owner review` });
  }
  if (absDelta < 0.20) {
    issues.push({ id:'long_option_low_delta', level:'info', category:'context', scope:'context', strategy, metric:'absDelta', value:absDelta, warnAt:0.20, scoreImpact:0, affectsSignal:false, message:`Low delta ${absDelta.toFixed(3)} -- context for low probability option` });
  }
  if (dte < 14) {
    issues.push({ id:'long_option_short_dte', level:'info', category:'context', scope:'context', strategy, metric:'dte', value:dte, warnAt:14, scoreImpact:0, affectsSignal:false, message:`${dte} DTE -- theta decay accelerates sharply this close to expiration` });
  }
  if (targetData.probWorthless > 0.70) {
    issues.push({ id:'long_option_prob_worthless_high', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'probWorthless', value:targetData.probWorthless, warnAt:0.70, scoreImpact:targetData.probWorthless > 0.85 ? -20 : -10, message:`${pct(targetData.probWorthless)}% probability of expiring worthless; placeholder probability threshold for owner review` });
  }
  pushDataConfidenceIssues(issues, strategy, data, { greeks, ivAvailable: greeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  return {
    strategyGroup: strategy,
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

    price, strike, prem,
    breakeven,
    maxLoss,
    collateral: collateralFromPayoff(payoff),
    maxProfit: payoff.maxProfit,
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    theoreticalMax: targetData.theoreticalMax, // null for calls, real for puts

    absDelta,
    greeks: greeks || null,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    // Probability framing -- the key feature for long options
    probITM:       targetData.probITM,
    probWorthless: targetData.probWorthless,
    probTouchBreakeven: targetData.probTouchBreakeven,
    dailyDecay:    targetData.dailyDecayEst,

    // Realistic profit targets -- counters "unlimited profit" misconception
    profitTargets: targetData.profitTargets || targetData.targets,
    allTargets:    targetData.allTargets,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,

    // Honest framing note
    framingNote: isCall
      ? `Theoretical max profit is unlimited, but realistically: a 20% move in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability at current volatility.`
      : `Theoretical max profit requires stock to reach $0. Realistically: a 20% drop in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability.`,
    modelNotes: modelNotes(data, { greeks }),
    payoff,
  };
}
