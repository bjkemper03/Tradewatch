// =============================================================================
// api/analyze/strategies/ironCondor.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcCondorProbs } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, getBestVol } from './sharedGreeks.js';
import { payoffSummary } from './sharedPayoff.js';
import { checkEarningsRisk, getSignal, modelNotes } from './sharedContext.js';

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

  // Deltas
  const putDelta  = putGreeks?.delta  != null ? Math.abs(putGreeks.delta)  : Math.abs(bsDelta(price, shortPut,  dte/365, vol, 'put')  || 0);
  const callDelta = callGreeks?.delta != null ? Math.abs(callGreeks.delta) : Math.abs(bsDelta(price, shortCall, dte/365, vol, 'call') || 0);

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
  const cushMin  = prefs?.cushionMin || 5;
  const deltaMax = prefs?.deltaHigh  || 0.30;

  if (payoff.maxLossUnlimited)             issues.push({ level:'critical', weight:6, msg:'Undefined/naked risk detected -- not beginner-safe' });
  if (earningsCheck.risk)                  issues.push({ level:'critical', weight:5, msg:`Earnings ${earningsCheck.date} within expiration` });
  if (minCushionPct < cushMin)             issues.push({ level:'critical', weight:5, msg:`Tight cushion: put side ${putCushionPct}%, call side ${callCushionPct}%` });
  if (putDelta > deltaMax)                 issues.push({ level:'warning', weight:3, msg:`Put delta ${putDelta.toFixed(3)} above ${deltaMax} target` });
  if (callDelta > deltaMax)                issues.push({ level:'warning', weight:3, msg:`Call delta ${callDelta.toFixed(3)} above ${deltaMax} target` });
  if (isIronButterfly)                     issues.push({ level:'warning',  msg:'Iron butterfly -- max profit only if price pins at strike. Very tight target.' });
  if (price < shortPut || price > shortCall) issues.push({ level:'critical', weight:6, msg:'Price already outside the tent -- do not open' });

  return {
    strategyGroup: isIronButterfly ? 'iron_butterfly' : 'iron_condor',
    signal: getSignal(issues),
    issues,

    price, shortPut, longPut, shortCall, longCall,
    putWidth, callWidth, maxWidth,
    putBreakeven, callBreakeven, tentWidth,
    putCushionPct, callCushionPct, minCushionPct,
    maxProfit, maxLoss,
    putDelta, callDelta,
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
