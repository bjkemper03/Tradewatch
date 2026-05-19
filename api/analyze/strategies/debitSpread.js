// =============================================================================
// api/analyze/strategies/debitSpread.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven, collateralFromPayoff } from './sharedPayoff.js';
import { checkEarningsRisk, getSignal, modelNotes } from './sharedContext.js';

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
  if (payoff.maxLossUnlimited) issues.push({ level:'critical', weight:6, msg:'Undefined/naked risk detected -- not beginner-safe' });
  if (earningsCheck.risk)      issues.push({ level:'critical', weight:5, msg:`Earnings ${earningsCheck.date} within expiration -- binary move` });
  if (movePct > 10)            issues.push({ level:'warning',  msg:`Needs ${movePct}% move to breakeven -- aggressive target` });
  if (riskReward && riskReward > 2) issues.push({ level:'warning', weight:3, msg:`Risk/reward ${riskReward}:1 -- risking more than potential gain` });
  if (probMaxLoss && probMaxLoss > 0.60) issues.push({ level:'warning', msg:`${pct(probMaxLoss)}% chance of max loss -- low probability trade` });

  return {
    strategyGroup: isPut ? 'put_debit_spread' : 'call_debit_spread',
    signal: getSignal(issues),
    issues,

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
    modelNotes: modelNotes(data, { greeks }),
    payoff,
  };
}
