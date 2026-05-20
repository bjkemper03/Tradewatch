// =============================================================================
// api/analyze/strategies/debitSpread.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW } from '../probability.js';
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
  pushUndefinedRiskIssue,
} from './sharedContext.js';

export function analyzeDebitSpread(data, legs, expDateObj, dte, debit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const db = safeNum(debit); // debit paid per share

  const buyLeg  = legs.find(l => l.a === 'BUY');
  const sellLeg = legs.find(l => l.a === 'SELL');
  if (!buyLeg || !sellLeg) return { error: 'Debit spread requires one BUY and one SELL leg' };

  const longStrike  = safeNum(buyLeg.s);
  const shortStrike = safeNum(sellLeg.s);
  const optType     = (buyLeg.t || 'PUT').toLowerCase();
  const isPut       = optType === 'put';

  if (String(buyLeg.t || '').toUpperCase() !== String(sellLeg.t || '').toUpperCase()) {
    return { error: 'Debit spread legs must use the same option type' };
  }
  if (!longStrike || !shortStrike) return { error: 'Enter strike prices for both legs' };

  const spreadWidth = Math.abs(longStrike - shortStrike);
  const payoff = payoffSummary(legs, -db, price, [
    { label: 'Long strike', px: longStrike, note: 'Option bought', kind: 'long' },
    { label: 'Short strike', px: shortStrike, note: 'Max profit starts beyond here', kind: 'short' },
  ]);
  const maxProfit   = payoff.maxProfit;
  const maxLoss     = payoff.maxLoss;
  const riskReward  = maxProfit > 0 ? parseFloat((maxLoss / maxProfit).toFixed(2)) : null;

  // Breakeven -- different for puts vs calls
  const breakeven = firstBreakeven(payoff, isPut
    ? parseFloat((longStrike - db).toFixed(2))   // put: long strike - debit
    : parseFloat((longStrike + db).toFixed(2)));  // call: long strike + debit

  // Distance stock needs to move to breakeven
  const moveToBreakeven = isPut
    ? parseFloat((price - breakeven).toFixed(2))
    : parseFloat((breakeven - price).toFixed(2));
  const movePct = parseFloat((moveToBreakeven / price * 100).toFixed(1));

  // Get Greeks from long leg (the one you bought)
  const contract = findChainContract(chain, longStrike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);
  const longLegGreeks = getLegGreek(chain, buyLeg, vol, price, dte, optType);
  const shortLegGreeks = getLegGreek(chain, sellLeg, vol, price, dte, optType);
  const positionGreeks = buildPositionGreeks(chain, legs, vol, price, dte, optType);
  const keyLegGreeks = buildKeyLegGreeks(isPut
    ? { longPut: longLegGreeks, shortPut: shortLegGreeks }
    : { longCall: longLegGreeks, shortCall: shortLegGreeks });

  const absDelta = greeks?.delta != null
    ? Math.abs(greeks.delta)
    : Math.abs(bsDelta(price, longStrike, dte / 365, vol, optType) || 0);
  const scoringGreeks = {
    delta: absDelta,
    deltaLabel: isPut ? 'Long put delta' : 'Long call delta',
  };

  const em = calcExpectedMove(price, vol, dte);

  // Probability of max profit -- stock beyond short strike at expiry
  const probMaxProfit = isPut
    ? calcPOW(price, shortStrike, vol, dte, 'call') // P(price < shortStrike)
    : calcPOW(price, shortStrike, vol, dte, 'put'); // P(price > shortStrike)

  // Probability of any profit -- stock beyond breakeven
  const probAnyProfit = isPut
    ? calcPOW(price, breakeven, vol, dte, 'call')
    : calcPOW(price, breakeven, vol, dte, 'put');

  // Probability of max loss -- expires worthless
  const probMaxLoss = isPut
    ? calcPOW(price, longStrike, vol, dte, 'put') // P(price > longStrike for puts = worthless)
    : calcPOW(price, longStrike, vol, dte, 'call'); // P(price < longStrike for calls = worthless)

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  const issues = [];
  const strategy = isPut ? 'put_debit_spread' : 'call_debit_spread';
  if (!payoff.maxLossUnlimited && (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Debit spread risk/reward could not be calculated reliably');
  }
  if (payoff.maxLossUnlimited) {
    pushUndefinedRiskIssue(issues, strategy, { message: 'Undefined risk detected in a defined-risk debit spread' });
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsScoreIssue(issues, strategy, earningsCheck, dte);
  const breakevenMoveRatio = em ? moveToBreakeven / em : null;
  if (breakevenMoveRatio != null && breakevenMoveRatio > 1) {
    issues.push({ id:'debit_spread_breakeven_move_major', level:'red', category:'risk', scope:'strategy', strategy, metric:'breakevenMoveToExpectedMove', value:parseFloat(breakevenMoveRatio.toFixed(2)), redAt:1, scoreImpact:-30, message:'Breakeven move is larger than expected move; placeholder cushion threshold for owner review' });
  } else if (breakevenMoveRatio != null && breakevenMoveRatio > 0.5) {
    issues.push({ id:'debit_spread_breakeven_move_minor', level:'yellow', category:'risk', scope:'strategy', strategy, metric:'breakevenMoveToExpectedMove', value:parseFloat(breakevenMoveRatio.toFixed(2)), warnAt:0.5, scoreImpact:-15, message:'Breakeven move is more than half the expected move; placeholder cushion threshold for owner review' });
  }
  pushDteFitIssue(issues, strategy, dte, { min:30, max:60, label:'debit-spread' });
  if (movePct > 10) {
    issues.push({ id:'debit_spread_large_breakeven_move', level:'info', category:'context', scope:'context', strategy, metric:'movePct', value:movePct, warnAt:10, scoreImpact:0, affectsSignal:false, message:`Needs ${movePct}% move to breakeven -- aggressive target` });
  }
  if (riskReward && riskReward > 2) {
    issues.push({ id:'debit_spread_risk_reward_high', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'riskReward', value:riskReward, warnAt:2, scoreImpact:riskReward > 3 ? -25 : -15, message:`Risk/reward ${riskReward}:1 -- risking more than potential gain; placeholder efficiency threshold for owner review` });
  }
  if (probAnyProfit != null && probAnyProfit < 0.40) {
    issues.push({ id:'debit_spread_profit_probability_low', level:'red', category:'probability', scope:'strategy', strategy, metric:'probAnyProfit', value:probAnyProfit, redAt:0.40, scoreImpact:-20, message:`${pct(probAnyProfit)}% probability of any profit; placeholder probability threshold for owner review` });
  } else if (probAnyProfit != null && probAnyProfit < 0.55) {
    issues.push({ id:'debit_spread_profit_probability_moderate', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'probAnyProfit', value:probAnyProfit, warnAt:0.55, scoreImpact:-10, message:`${pct(probAnyProfit)}% probability of any profit; placeholder probability threshold for owner review` });
  }
  pushDataConfidenceIssues(issues, strategy, data, { greeks, ivAvailable: greeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  return {
    strategyGroup: strategy,
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

    price, longStrike, shortStrike, spreadWidth,
    breakeven, moveToBreakeven, movePct,
    maxProfit, maxLoss, riskReward,
    collateral: collateralFromPayoff(payoff),
    debit: db,

    absDelta,
    greeks: greeks || null,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    probMaxProfit, probAnyProfit, probMaxLoss,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,
    modelNotes: modelNotes(data, { greeks }),
    payoff,
  };
}
