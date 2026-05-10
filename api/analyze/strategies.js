// =============================================================================
// api/analyze/strategies.js
// Strategy-specific analysis modules.
// Each function receives clean data from dataFetch and returns structured results.
// =============================================================================

import { findChainContract, extractGreeks } from './dataFetch.js';
import {
  calcExpectedMove,
  calcPOW,
  calcPOP,
  calcCreditSpreadProbs,
  calcCondorProbs,
  calcButterflyProbs,
  calcLongOptionTargets,
  calcYield,
  calcWheelScenarios,
} from './probability.js';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function safeNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v, decimals = 1) {
  return parseFloat((v * 100).toFixed(decimals));
}

// Black-Scholes delta (fallback when Tradier Greeks unavailable)
function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x));
  return 0.5 * (1 + sgn * y);
}
function bsDelta(S, K, T, vol, type) {
  if (!S || !K || !T || !vol || T <= 0 || vol <= 0) return null;
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}

// Get best available volatility -- IV from chain preferred, HV30 fallback
function getBestVol(greeks, hv30) {
  if (greeks && greeks.iv && greeks.iv > 0) return greeks.iv / 100;
  return hv30 || 0.30;
}

// Earnings risk check
function checkEarningsRisk(earnings, expDateObj) {
  if (!earnings || !expDateObj) return { risk: false, date: null };
  const ed = new Date(earnings.date + 'T12:00:00');
  return { risk: ed <= expDateObj, date: earnings.date };
}

// Signal from prefs thresholds
function getSignal(issues) {
  const critical = issues.filter(i => i.level === 'critical');
  const warnings = issues.filter(i => i.level === 'warning');
  if (critical.length > 0) return 'NO-GO';
  if (warnings.length > 1) return 'CAUTION';
  return 'GO';
}

// ---------------------------------------------------------------------------
// 1. PUT CREDIT SPREAD / CALL CREDIT SPREAD
// ---------------------------------------------------------------------------
export function analyzeCreditSpread(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  // Identify legs
  const sellLeg = legs.find(l => l.a === 'SELL');
  const buyLeg  = legs.find(l => l.a === 'BUY');
  if (!sellLeg || !buyLeg) return { error: 'Credit spread requires one SELL and one BUY leg' };

  const shortStrike = safeNum(sellLeg.s);
  const longStrike  = safeNum(buyLeg.s);
  const optType     = (sellLeg.t || 'PUT').toLowerCase();
  const isPut       = optType === 'put';

  if (!shortStrike || !longStrike) return { error: 'Enter strike prices for both legs' };

  const spreadWidth = Math.abs(shortStrike - longStrike);
  if (spreadWidth === 0) return { error: 'Short and long strikes cannot be the same' };

  // Greeks from chain
  const contract = findChainContract(chain, shortStrike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);

  // Delta -- real from chain or Black-Scholes
  let absDelta = null, deltaSource = 'BS';
  if (greeks && greeks.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = 'Tradier';
  } else if (shortStrike && price && dte) {
    const bd = bsDelta(price, shortStrike, dte / 365, vol, optType);
    if (bd !== null) absDelta = Math.abs(bd);
  }

  // Core metrics
  const maxProfit  = cr * 100; // per contract
  const maxLoss    = (spreadWidth - cr) * 100;
  const breakeven  = isPut
    ? parseFloat((shortStrike - cr).toFixed(2))
    : parseFloat((shortStrike + cr).toFixed(2));

  // Cushion = distance from current price to short strike
  const cushionPct = isPut
    ? parseFloat(((price - shortStrike) / price * 100).toFixed(1))
    : parseFloat(((shortStrike - price) / price * 100).toFixed(1));

  // Breakeven cushion = distance from price to breakeven
  const beCushionPct = isPut
    ? parseFloat(((price - breakeven) / price * 100).toFixed(1))
    : parseFloat(((breakeven - price) / price * 100).toFixed(1));

  // Credit as % of spread width (quality metric)
  const crWidthPct = parseFloat((cr / spreadWidth * 100).toFixed(1));

  // Expected move
  const em = calcExpectedMove(price, vol, dte);
  const strikeOutsideEM = em
    ? (isPut ? (price - shortStrike) > em : (shortStrike - price) > em)
    : null;

  // Probability
  const probs = calcCreditSpreadProbs(price, shortStrike, longStrike, vol, dte, optType);
  const pow   = calcPOW(price, shortStrike, vol, dte, optType);

  // Support/resistance context
  const nearestSupport    = supports.length    ? supports[0]    : null;
  const nearestResistance = resistances.length ? resistances[0] : null;
  const strikeAboveSupport = isPut && nearestSupport
    ? shortStrike > nearestSupport
    : null;

  // Exit signal -- closest support below (for puts)
  const exitSignal = isPut && supports.length ? supports[0] : null;

  // Earnings
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  // Issues
  const issues = [];
  const cushMin = prefs?.cushionMin || 5;
  const dteMin  = prefs?.dteLow || 14;
  const dteMax  = prefs?.dteHigh || 21;
  const crwMin  = prefs?.creditWidthMin || 8;
  const deltaMax = prefs?.deltaHigh || 0.30;

  if (earningsCheck.risk)                             issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} falls within expiration` });
  if (cushionPct < cushMin)                           issues.push({ level:'critical', msg:`${cushionPct}% cushion below your ${cushMin}% minimum` });
  if (absDelta && absDelta > deltaMax)                issues.push({ level:'warning',  msg:`Delta ${absDelta.toFixed(3)} above your ${deltaMax} target` });
  if (crWidthPct < crwMin)                            issues.push({ level:'warning',  msg:`Credit is only ${crWidthPct}% of spread width -- low return on risk` });
  if (dte < dteMin)                                   issues.push({ level:'warning',  msg:`${dte} DTE below your ${dteMin} minimum` });
  if (dte > dteMax)                                   issues.push({ level:'warning',  msg:`${dte} DTE above your ${dteMax} maximum` });
  if (isPut && nearestSupport && shortStrike < nearestSupport) issues.push({ level:'warning', msg:`Short strike $${shortStrike} below support $${nearestSupport}` });
  if (!strikeOutsideEM && em)                         issues.push({ level:'warning',  msg:`Short strike inside 1SD expected move ($${em})` });

  return {
    strategyGroup: 'credit_spread',
    signal: getSignal(issues),
    issues,

    // Core
    price, shortStrike, longStrike, spreadWidth,
    breakeven, cushionPct, beCushionPct, crWidthPct,
    maxProfit, maxLoss,

    // Greeks
    absDelta, deltaSource,
    greeks: greeks || null,
    iv: greeks?.iv || null,
    vol: pct(vol),

    // Probability
    probMaxProfit:   probs.probMaxProfit,
    probMaxLoss:     probs.probMaxLoss,
    probWorthless:   pow,

    // Move context
    em, strikeOutsideEM,

    // Levels
    supports, resistances, nearestSupport, nearestResistance,
    exitSignal, strikeAboveSupport,

    // Earnings
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
  };
}

// ---------------------------------------------------------------------------
// 2. IRON CONDOR + IRON BUTTERFLY
// ---------------------------------------------------------------------------
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
  const maxProfit = cr * 100;
  const maxLoss   = (maxWidth - cr) * 100;
  const putBreakeven  = parseFloat((shortPut  - cr).toFixed(2));
  const callBreakeven = parseFloat((shortCall + cr).toFixed(2));
  const tentWidth     = parseFloat((callBreakeven - putBreakeven).toFixed(2));

  // Distance from price to each short strike
  const putCushionPct  = parseFloat(((price - shortPut)  / price * 100).toFixed(1));
  const callCushionPct = parseFloat(((shortCall - price) / price * 100).toFixed(1));
  const minCushionPct  = Math.min(putCushionPct, callCushionPct);

  const em = calcExpectedMove(price, vol, dte);

  // Probability
  const probs = calcCondorProbs(price, shortPut, shortCall, longPut, longCall, vol, dte);

  // Earnings
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  // Issues
  const issues = [];
  const cushMin  = prefs?.cushionMin || 5;
  const deltaMax = prefs?.deltaHigh  || 0.30;

  if (earningsCheck.risk)                  issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} within expiration` });
  if (minCushionPct < cushMin)             issues.push({ level:'critical', msg:`Tight cushion: put side ${putCushionPct}%, call side ${callCushionPct}%` });
  if (putDelta > deltaMax)                 issues.push({ level:'warning',  msg:`Put delta ${putDelta.toFixed(3)} above ${deltaMax} target` });
  if (callDelta > deltaMax)                issues.push({ level:'warning',  msg:`Call delta ${callDelta.toFixed(3)} above ${deltaMax} target` });
  if (isIronButterfly)                     issues.push({ level:'warning',  msg:'Iron butterfly -- max profit only if price pins at strike. Very tight target.' });
  if (price < shortPut || price > shortCall) issues.push({ level:'critical', msg:'Price already outside the tent -- do not open' });

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
    probInPutWing:   probs.probInPutWing,
    probInCallWing:  probs.probInCallWing,
    probMaxLoss:     probs.probMaxLossEither,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    isIronButterfly,
  };
}

// ---------------------------------------------------------------------------
// 3. CASH SECURED PUT -- wheel-aware
// ---------------------------------------------------------------------------
export function analyzeCSP(data, legs, expDateObj, dte, credit, prefs) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  const sellLeg = legs.find(l => l.a === 'SELL' && l.t === 'PUT');
  if (!sellLeg) return { error: 'CSP requires a short PUT leg' };

  const strike = safeNum(sellLeg.s);
  if (!strike) return { error: 'Enter the put strike price' };

  const contract = findChainContract(chain, strike, 'put');
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);

  let absDelta = null, deltaSource = 'BS';
  if (greeks?.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = 'Tradier';
  } else if (dte) {
    const bd = bsDelta(price, strike, dte / 365, vol, 'put');
    if (bd !== null) { absDelta = Math.abs(bd); }
  }

  const collateral   = strike * 100;
  const maxProfit    = cr * 100;
  const maxLoss      = (strike - cr) * 100; // assigned at strike, stock goes to 0
  const breakeven    = parseFloat((strike - cr).toFixed(2));
  const cushionPct   = parseFloat(((price - strike) / price * 100).toFixed(1));
  const beCushionPct = parseFloat(((price - breakeven) / price * 100).toFixed(1));
  const em           = calcExpectedMove(price, vol, dte);

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
  const cushMin  = prefs?.cushionMin || 3; // lower threshold for CSPs -- assignment is acceptable
  const deltaMax = prefs?.deltaHigh  || 0.40; // can tolerate higher delta on CSPs

  if (earningsCheck.risk)    issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} within expiration -- binary risk` });
  if (cushionPct < 0)        issues.push({ level:'critical', msg:`Strike $${strike} above current price $${price} -- ITM put` });
  if (strikeBelowSupport)    issues.push({ level:'warning',  msg:`Strike $${strike} below nearest support $${supports[0]} -- buying into weakness if assigned` });
  if (absDelta && absDelta > deltaMax) issues.push({ level:'warning', msg:`Delta ${absDelta.toFixed(3)} -- high assignment probability` });

  // CSP-specific: flag if yield is very low but don't penalize -- show context instead
  const yieldData = wheelData?.ifNotAssigned?.yieldData;

  return {
    strategyGroup: 'csp',
    signal: getSignal(issues),
    issues,

    price, strike, breakeven,
    cushionPct, beCushionPct,
    collateral, maxProfit, maxLoss,
    absDelta, deltaSource,
    greeks: greeks || null,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

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

    // Framing note -- assignment is not a loss in wheel strategy
    wheelNote: 'Assignment means you buy shares at your effective cost basis of $' + breakeven.toFixed(2) + '. This is the goal in wheel strategy.',
  };
}

// ---------------------------------------------------------------------------
// 4. COVERED CALL -- wheel-aware
// ---------------------------------------------------------------------------
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

  let absDelta = null, deltaSource = 'BS';
  if (greeks?.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = 'Tradier';
  } else if (dte) {
    const bd = bsDelta(price, strike, dte / 365, vol, 'call');
    if (bd !== null) { absDelta = Math.abs(bd); }
  }

  const maxProfit     = (strike - price + cr) * 100; // called away at strike + premium
  const downsideProtection = cr; // premium reduces cost basis
  const breakeven     = parseFloat((price - cr).toFixed(2)); // new effective downside BE
  const upsideCap     = strike;
  const upsideCapPct  = parseFloat(((strike - price) / price * 100).toFixed(1));
  const em            = calcExpectedMove(price, vol, dte);

  // Wheel scenarios
  const wheelData = calcWheelScenarios(price, strike, cr, dte, 'call');

  // Probability of being called away
  const probCalledAway = calcPOW(price, strike, vol, dte, 'put'); // P(price < strike) for CC = P(not called)
  const probNotCalled  = probCalledAway;
  const probCalled     = probCalledAway != null ? parseFloat((1 - probCalledAway).toFixed(4)) : null;

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
    absDelta, deltaSource,
    greeks: greeks || null,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    wheelScenarios: wheelData,
    yieldData,

    probCalled, probNotCalled,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
  };
}

// ---------------------------------------------------------------------------
// 5. BUTTERFLY / BWB / PUT RATIO SPREAD
// Credit or debit -- detected from credit value sign/user input
// ---------------------------------------------------------------------------
export function analyzeButterflyBWB(data, legs, expDateObj, dte, credit, prefs, isCredit) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  // Sort legs by strike to identify structure
  const allLegs = legs.map(l => ({ ...l, strike: safeNum(l.s) })).filter(l => l.strike > 0);
  if (allLegs.length < 3) return { error: 'Butterfly/BWB requires at least 3 legs' };

  const optType = allLegs[0].t.toLowerCase();
  const sorted  = [...allLegs].sort((a, b) => a.strike - b.strike);

  // Identify structure
  const sells = allLegs.filter(l => l.a === 'SELL');
  const buys  = allLegs.filter(l => l.a === 'BUY');

  if (sells.length === 0 || buys.length === 0) return { error: 'Need both buy and sell legs' };

  // For BWB/ratio: typically 1 buy + 2 sells (or 2 sells + 1 buy upper)
  // For butterfly: 2 buys (outer) + 2 sells (inner, same strike)
  const sellStrikes = sells.map(l => l.strike).sort((a, b) => a - b);
  const buyStrikes  = buys.map(l => l.strike).sort((a, b) => a - b);

  // Center strike = the sold strike(s)
  const centerStrike = sells[0].strike;
  const lowerStrike  = buyStrikes[0];
  const upperStrike  = buyStrikes.length > 1 ? buyStrikes[buyStrikes.length - 1] : null;

  // Wings
  const lowerWing = centerStrike - lowerStrike;
  const upperWing = upperStrike ? upperStrike - centerStrike : null;
  const isSymmetric = upperWing && Math.abs(lowerWing - upperWing) < 0.26;
  const isBWB       = upperWing && !isSymmetric;
  const isRatio     = !upperStrike; // sell 2, buy 1 -- uncapped upside risk

  // Get vol
  const contract = findChainContract(chain, centerStrike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);

  // Max profit calculation
  let maxProfit, maxLoss, lowerBE, upperBE;

  if (isCredit) {
    // Credit BWB/ratio: max profit at center + credit collected
    maxProfit = (lowerWing * 100) + (cr * 100); // simplified
    if (upperWing) {
      // BWB: max loss is difference between wings minus credit
      maxLoss = upperWing > lowerWing
        ? ((upperWing - lowerWing) * 100) - (cr * 100)
        : ((lowerWing - upperWing) * 100) - (cr * 100);
      maxLoss = Math.max(0, maxLoss);
    } else {
      maxLoss = null; // ratio spread -- uncapped below long strike
    }
    lowerBE = parseFloat((lowerStrike + cr).toFixed(2));
    upperBE = upperStrike ? parseFloat((upperStrike - (upperWing > 0 ? 0 : cr)).toFixed(2)) : null;
  } else {
    // Debit butterfly: max profit at center - debit paid
    maxProfit = (lowerWing * 100) - (cr * 100);
    maxLoss   = cr * 100; // debit paid
    lowerBE   = parseFloat((lowerStrike + cr).toFixed(2));
    upperBE   = upperStrike ? parseFloat((upperStrike - cr).toFixed(2)) : null;
  }

  const em = calcExpectedMove(price, vol, dte);

  // Probability of max profit zone and tiers
  let probs = null;
  if (lowerBE && upperBE && maxProfit > 0) {
    probs = calcButterflyProbs(price, lowerBE, centerStrike, upperBE, vol, dte, maxProfit);
  }

  // Expected value -- probability-weighted return
  const expectedValue = probs
    ? parseFloat((
        (probs.probMaxProfit * maxProfit) +
        (probs.probAnyProfit - probs.probMaxProfit) * (maxProfit * 0.5) +
        ((1 - probs.probAnyProfit) * -(maxLoss || cr * 100))
      ).toFixed(2))
    : null;

  // Wing ratio for BWB quality
  const wingRatio = upperWing ? parseFloat((lowerWing / upperWing).toFixed(2)) : null;
  const crRatio   = maxLoss && maxLoss > 0 && isCredit
    ? parseFloat(((cr * 100) / maxLoss * 100).toFixed(1))
    : null;

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  const issues = [];
  if (earningsCheck.risk)                issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} within expiration` });
  if (isRatio && !isCredit)             issues.push({ level:'warning',  msg:'Ratio spread with no upper protection -- unlimited loss risk below long strike' });
  if (price < lowerBE || (upperBE && price > upperBE)) issues.push({ level:'warning', msg:'Price already outside profit zone' });
  if (crRatio && crRatio < 12)          issues.push({ level:'warning',  msg:`Low credit/risk ratio: ${crRatio}%` });

  return {
    strategyGroup: isBWB ? 'bwb' : isRatio ? 'ratio_spread' : 'butterfly',
    isCredit, isBWB, isSymmetric, isRatio,
    signal: getSignal(issues),
    issues,

    price, centerStrike, lowerStrike, upperStrike,
    lowerWing, upperWing, wingRatio,
    lowerBE, upperBE,
    maxProfit, maxLoss,
    crRatio,
    vol: pct(vol),
    em,

    probMaxProfit:  probs?.probMaxProfit || null,
    probAnyProfit:  probs?.probAnyProfit || null,
    profitTiers:    probs?.tiers         || [],
    expectedValue,

    greeks: greeks || null,
    iv: greeks?.iv || null,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
  };
}

// ---------------------------------------------------------------------------
// 6. DEBIT SPREADS (Put Debit Spread / Call Debit Spread)
// ---------------------------------------------------------------------------
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

  if (!longStrike || !shortStrike) return { error: 'Enter strike prices for both legs' };

  const spreadWidth = Math.abs(longStrike - shortStrike);
  const maxProfit   = (spreadWidth - db) * 100; // per contract
  const maxLoss     = db * 100;                  // debit paid
  const riskReward  = maxProfit > 0 ? parseFloat((maxLoss / maxProfit).toFixed(2)) : null;

  // Breakeven -- different for puts vs calls
  const breakeven = isPut
    ? parseFloat((longStrike - db).toFixed(2))   // put: long strike - debit
    : parseFloat((longStrike + db).toFixed(2));  // call: long strike + debit

  // Distance stock needs to move to breakeven
  const moveToBreakeven = isPut
    ? parseFloat((price - breakeven).toFixed(2))
    : parseFloat((breakeven - price).toFixed(2));
  const movePct = parseFloat((moveToBreakeven / price * 100).toFixed(1));

  // Get Greeks from long leg (the one you bought)
  const contract = findChainContract(chain, longStrike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);

  const absDelta = greeks?.delta != null
    ? Math.abs(greeks.delta)
    : Math.abs(bsDelta(price, longStrike, dte / 365, vol, optType) || 0);

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
  if (earningsCheck.risk)      issues.push({ level:'critical', msg:`Earnings ${earningsCheck.date} within expiration -- binary move` });
  if (movePct > 10)            issues.push({ level:'warning',  msg:`Needs ${movePct}% move to breakeven -- aggressive target` });
  if (riskReward && riskReward > 2) issues.push({ level:'warning', msg:`Risk/reward ${riskReward}:1 -- risking more than potential gain` });
  if (probMaxLoss && probMaxLoss > 0.60) issues.push({ level:'warning', msg:`${pct(probMaxLoss)}% chance of max loss -- low probability trade` });

  return {
    strategyGroup: isPut ? 'put_debit_spread' : 'call_debit_spread',
    signal: getSignal(issues),
    issues,

    price, longStrike, shortStrike, spreadWidth,
    breakeven, moveToBreakeven, movePct,
    maxProfit, maxLoss, riskReward,
    debit: db,

    absDelta,
    greeks: greeks || null,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    probMaxProfit, probAnyProfit, probMaxLoss,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
  };
}

// ---------------------------------------------------------------------------
// 7. LONG CALL / LONG PUT -- basic analysis with realistic framing
// ---------------------------------------------------------------------------
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

  const absDelta = greeks?.delta != null
    ? Math.abs(greeks.delta)
    : Math.abs(bsDelta(price, strike, dte / 365, vol, optType) || 0);

  // Detailed probability analysis with realistic targets
  const targetData = calcLongOptionTargets(price, strike, prem, vol, dte, optType);

  const em      = calcExpectedMove(price, vol, dte);
  const maxLoss = prem * 100; // per contract -- what you WILL lose if wrong

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);

  const issues = [];
  // Long options: inform, don't gatekeep -- but flag obvious problems
  if (earningsCheck.risk) issues.push({ level:'warning', msg:`Earnings ${earningsCheck.date} within expiration -- large move possible both ways` });
  if (absDelta < 0.20)    issues.push({ level:'warning', msg:`Low delta ${absDelta.toFixed(3)} -- low probability option, high chance of total loss` });
  if (dte < 14)           issues.push({ level:'warning', msg:`${dte} DTE -- theta decay accelerates sharply this close to expiration` });
  if (targetData.probWorthless > 0.70) issues.push({ level:'warning', msg:`${pct(targetData.probWorthless)}% probability of expiring worthless` });

  return {
    strategyGroup: isCall ? 'long_call' : 'long_put',
    signal: getSignal(issues),
    issues,

    price, strike, prem,
    breakeven:    targetData.breakeven,
    maxLoss,
    theoreticalMax: targetData.theoreticalMax, // null for calls, real for puts

    absDelta,
    greeks: greeks || null,
    iv: greeks?.iv || null,
    vol: pct(vol),
    em,

    // Probability framing -- the key feature for long options
    probITM:       targetData.probITM,
    probWorthless: targetData.probWorthless,
    dailyDecay:    targetData.dailyDecayEst,

    // Realistic profit targets -- counters "unlimited profit" misconception
    profitTargets: targetData.profitTargets || targetData.targets,
    allTargets:    targetData.allTargets,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,

    // Honest framing note
    framingNote: isCall
      ? `Theoretical max profit is unlimited, but realistically: a 20% move in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability at current volatility.`
      : `Theoretical max profit requires stock to reach $0. Realistically: a 20% drop in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability.`,
  };
}
