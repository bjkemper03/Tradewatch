// =============================================================================
// api/analyze/strategies/csp.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcWheelScenarios } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, completeGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven } from './sharedPayoff.js';
import {
  checkEarningsRisk,
  finalizeUniversalSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushEarningsIssue,
  pushUndefinedRiskIssue,
} from './sharedContext.js';

export function analyzeCSP(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  const sellLeg = legs.find(l => l.a === 'SELL' && l.t === 'PUT');
  if (!sellLeg) return { error: 'CSP requires a short PUT leg' };

  const strike = safeNum(sellLeg.s);
  if (!strike) return { error: 'Enter the put strike price' };

  const contract = findChainContract(chain, strike, 'put');
  const rawGreeks = extractGreeks(contract);
  const vol      = getBestVol(rawGreeks, hv30);
  const greeks   = completeGreeks(rawGreeks, price, strike, dte / 365, vol, 'put');
  const shortPutGreeks = getLegGreek(chain, sellLeg, vol, price, dte, 'put');
  const positionGreeks = buildPositionGreeks(chain, [sellLeg], vol, price, dte, 'put');
  const keyLegGreeks = buildKeyLegGreeks({ shortPut: shortPutGreeks });

  let absDelta = null, deltaSource = 'BS';
  if (greeks?.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = rawGreeks?.delta != null ? 'Tradier' : 'BS';
  } else if (dte) {
    const bd = bsDelta(price, strike, dte / 365, vol, 'put');
    if (bd !== null) { absDelta = Math.abs(bd); }
  }
  const scoringGreeks = {
    delta: absDelta,
    deltaLabel: 'Short put delta',
  };

  const payoff       = payoffSummary(legs, cr, price, [
    { label: 'Put strike', px: strike, note: 'Short put expires worthless above here', kind: 'short' },
    { label: 'Stock $0', px: 0, note: 'Theoretical worst case', kind: 'loss' },
  ]);
  const cspNowPnl = parseFloat(((cr - Math.max(0, strike - price)) * 100).toFixed(2));
  const cspBreakeven = firstBreakeven(payoff, parseFloat((strike - cr).toFixed(2)));
  payoff.checkpoints = [
    { label: 'Now', px: price, pnl: cspNowPnl, note: '', kind: 'now' },
    { label: 'Breakeven', px: cspBreakeven, pnl: 0, note: 'P/L is about $0', kind: 'be' },
    { label: `Max profit $${strike}+`, px: strike, pnl: payoff.maxProfit, note: 'Put expires worthless at or above strike', kind: 'profit' },
    { label: 'Max loss $0', px: 0, pnl: payoff.maxLoss != null ? -payoff.maxLoss : null, note: 'Theoretical if stock goes to $0', kind: 'loss' },
  ];
  const collateral   = strike * 100;
  const maxProfit    = payoff.maxProfit;
  const maxLoss      = payoff.maxLoss;
  const breakeven    = firstBreakeven(payoff, parseFloat((strike - cr).toFixed(2)));
  const cushionPct   = parseFloat(((price - strike) / price * 100).toFixed(1));
  const beCushionPct = parseFloat(((price - breakeven) / price * 100).toFixed(1));
  const em           = calcExpectedMove(price, vol, dte);
  const dailyDecay   = greeks?.theta != null ? parseFloat((-greeks.theta).toFixed(4)) : null;
  const dailyThetaDollars = dailyDecay != null ? parseFloat((dailyDecay * 100).toFixed(2)) : null;

  // Wheel scenarios
  const wheelData = calcWheelScenarios(price, strike, cr, dte, 'put');

  // Probability
  const pow = calcPOW(price, strike, vol, dte, 'put');

  // Earnings
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  // Key question: is the strike a price you'd WANT to own the stock at?
  const strikeBelowPrice     = strike < price;
  const strikeNearSupport    = supports.length && Math.abs(strike - supports[0]) / price < 0.02;
  const strikeBelowSupport   = supports.length && strike < supports[0];

  const issues = [];
  const strategy = 'csp';
  const cushMin  = prefs?.cushionMin || 3; // lower threshold for CSPs -- assignment is acceptable
  const deltaMax = prefs?.deltaHigh  || 0.40; // can tolerate higher delta on CSPs

  if (!payoff.maxLossUnlimited && (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'CSP risk/reward could not be calculated reliably');
  }
  if (payoff.maxLossUnlimited) {
    pushUndefinedRiskIssue(issues, strategy, { message: 'Undefined risk detected in a cash-secured put model' });
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsIssue(issues, strategy, earningsCheck, {
    riskLevel: 'red',
    riskBlocking: true,
    riskMessage: `Earnings ${earningsCheck.date} falls before expiration -- binary risk`,
  });
  if (cushionPct < 0) {
    issues.push({ id:'csp_itm_put', level:'red', category:'risk', scope:'strategy', strategy, metric:'cushionPct', value:cushionPct, blocking:true, message:`Strike $${strike} above current price $${price} -- ITM put` });
  }
  if (strikeBelowSupport) {
    issues.push({ id:'csp_strike_below_support', level:'info', category:'context', scope:'context', strategy, affectsSignal:false, message:`Context: strike $${strike} is below nearest support $${supports[0]} -- assignment may buy into weakness` });
  }
  if (absDelta && absDelta > deltaMax) {
    issues.push({ id:'csp_delta_high', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'absDelta', value:absDelta, warnAt:deltaMax, message:`Delta ${absDelta.toFixed(3)} -- high assignment probability` });
  }
  const decision = finalizeUniversalSignal(issues, { cautionOnAnyMeaningfulIssue: true });

  // CSP-specific: flag if yield is very low but don't penalize -- show context instead
  const yieldData = wheelData?.ifNotAssigned?.yieldData;

  return {
    strategyGroup: 'csp',
    signal: decision.signal,
    issues: decision.issues,

    price, strike, breakeven,
    cushionPct, beCushionPct,
    collateral, maxProfit, maxLoss,
    absDelta, deltaSource,
    greeks: greeks || null,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,
    dailyDecay,
    dailyThetaDollars,

    // Wheel context
    wheelScenarios: wheelData,
    yieldData,

    // Probability
    probWorthless: pow,
    probAssignment: pow != null ? parseFloat((1 - pow).toFixed(4)) : null,

    // Levels
    supports, resistances,
    nearestSupport:    supports[0]    || null,
    nearestResistance: resistances[0] || null,
    strikeNearSupport,
    strikeBelowSupport,

    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    earningsUnknown: earningsCheck.unknown,

    // Framing note -- assignment is not a loss in wheel strategy
    wheelNote: 'Assignment means you buy shares at your effective cost basis of $' + breakeven.toFixed(2) + '. This is the goal in wheel strategy.',
    modelNotes: modelNotes(data, { greeks }),
    payoff,
  };
}
