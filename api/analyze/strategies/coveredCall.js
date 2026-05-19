// =============================================================================
// api/analyze/strategies/coveredCall.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcWheelScenarios } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven } from './sharedPayoff.js';
import { checkEarningsRisk, getSignal, modelNotes } from './sharedContext.js';

export function analyzeCoveredCall(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  const sellLeg = legs.find(l => l.a === 'SELL' && l.t === 'CALL');
  if (!sellLeg) return { error: 'Covered call requires a short CALL leg' };

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
  ], { underlyingShares: 100, underlyingBasis: price });
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
  if (earningsCheck.risk)  issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} within expiration` });
  if (strike < price)      issues.push({ level:'critical', msg:`Strike $${strike} below current price $${price} -- ITM call, immediate assignment risk` });
  if (upsideCapPct < 1)   issues.push({ level:'warning',  msg:`Only ${upsideCapPct}% upside before shares called away` });
  if (absDelta && absDelta > 0.70) issues.push({ level:'warning', msg:`Delta ${absDelta.toFixed(3)} -- high probability of assignment` });

  const yieldData = wheelData?.ifNotCalled?.yieldData;

  return {
    strategyGroup: 'covered_call',
    signal: getSignal(issues),
    issues,

    price, strike, breakeven,
    upsideCap, upsideCapPct,
    downsideProtection,
    maxProfit,
    collateral: 0,
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
    modelNotes: modelNotes(data, {
      greeks,
      structureNote: 'Covered-call return uses current stock price as share basis. Add actual share cost basis before treating wheel return as exact.',
    }),
    maxLoss,
    payoff,
  };
}
