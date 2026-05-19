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
import { analyzePayoff } from './payoffEngine.js';
import { decideSignal, legacyIssue } from './signalModel.js';

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
function npdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function bsGreekSet(S, K, T, vol, type) {
  if (!S || !K || !T || !vol || T <= 0 || vol <= 0) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const isCall = type === 'call';
  const delta = isCall ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * vol * sqrtT);
  const theta = (-(S * npdf(d1) * vol) / (2 * sqrtT)) / 365;
  const vega = S * npdf(d1) * sqrtT / 100;
  const rho = (isCall ? K * T * ncdf(d2) : -K * T * ncdf(-d2)) / 100;
  return {
    delta: parseFloat(delta.toFixed(4)),
    gamma: parseFloat(gamma.toFixed(4)),
    theta: parseFloat(theta.toFixed(4)),
    vega: parseFloat(vega.toFixed(4)),
    rho: parseFloat(rho.toFixed(4)),
  };
}

function completeGreeks(greeks, S, K, T, vol, type) {
  const fallback = bsGreekSet(S, K, T, vol, type);
  if (!fallback && !greeks) return null;
  return {
    ...(fallback || {}),
    ...(greeks || {}),
  };
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
  if (isNaN(ed.getTime())) return { risk: false, date: earnings.date || null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { risk: ed >= today && ed <= expDateObj, date: earnings.date };
}

// Signal from prefs thresholds
function getSignal(issues) {
  const score = issues.reduce((sum, issue) => {
    if (issue.level === 'critical') return sum + (issue.weight || 5);
    if (issue.level === 'warning') return sum + (issue.weight || 2);
    return sum + (issue.weight || 1);
  }, 0);
  if (issues.some(i => i.level === 'critical' && (i.weight || 5) >= 5)) return 'NO-GO';
  if (score >= 5) return 'NO-GO';
  if (score >= 2) return 'CAUTION';
  return 'GO';
}

function finalizeUniversalSignal(issues, options = {}) {
  const decision = decideSignal(issues, options);
  return {
    signal: decision.signal,
    issues: decision.issues.map(legacyIssue),
  };
}

function modelNotes(data, opts = {}) {
  const notes = [];
  if (!data.history) {
    notes.push({ level:'weak', msg:'Key levels unavailable without historical candles.' });
  } else {
    notes.push({ level:'estimate', msg:'Support/resistance uses daily swing/SMA levels only; freshness, retests, broken levels, and volume confirmation are not fully modeled yet.' });
  }
  if (!opts.greeks) {
    notes.push({ level:'estimate', msg:'Greeks and probabilities are estimated from volatility because option-chain Greeks were not available.' });
  }
  notes.push({ level:'estimate', msg:'Probabilities assume a lognormal price path from current volatility. Expiration odds and touch odds answer different questions.' });
  if (opts.structureNote) notes.push({ level:'weak', msg: opts.structureNote });
  return notes;
}

function payoffSummary(legs, netPremiumPerShare, price, labels = [], opts = {}) {
  const qtys = (legs || []).map(l => Math.max(1, safeNum(l.n || l.qty || 1, 1)));
  const sameQty = qtys.length > 0 && qtys.every(q => Math.abs(q - qtys[0]) < 0.0001);
  return analyzePayoff({
    legs,
    netPremiumPerShare,
    premiumContracts: opts.premiumContracts || (sameQty ? qtys[0] : 1),
    underlyingShares: opts.underlyingShares || 0,
    underlyingBasis: opts.underlyingBasis || 0,
  }, {
    currentPrice: price,
    labels,
    extraPrices: opts.extraPrices || [],
  });
}

function firstBreakeven(payoff, fallback = null) {
  return payoff?.breakevens?.length ? payoff.breakevens[0] : fallback;
}

function collateralFromPayoff(payoff, fallback = 0) {
  if (!payoff) return fallback;
  if (payoff.maxLossUnlimited) return null;
  return payoff.collateral ?? payoff.maxLoss ?? fallback;
}

function riskFieldsFromPayoff(payoff) {
  return {
    maxProfit: payoff.maxProfit,
    maxLoss: payoff.maxLoss,
    collateral: collateralFromPayoff(payoff),
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    maxLossUnlimited: payoff.maxLossUnlimited,
  };
}

function sameOptionType(legs) {
  const types = [...new Set((legs || []).map(l => String(l.t || '').toUpperCase()).filter(Boolean))];
  return types.length <= 1 ? types[0] || null : null;
}

function groupedByStrike(legs) {
  const map = new Map();
  for (const leg of legs) {
    const strike = safeNum(leg.s);
    if (!strike) continue;
    const item = map.get(strike) || { strike, buyQty: 0, sellQty: 0, netQty: 0 };
    const qty = Math.max(1, safeNum(leg.n || 1, 1));
    if (leg.a === 'BUY') item.buyQty += qty;
    if (leg.a === 'SELL') item.sellQty += qty;
    item.netQty = item.buyQty - item.sellQty;
    map.set(strike, item);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

function simpleRatio(a, b) {
  if (!a || !b) return null;
  const x = Math.round(Math.abs(a) * 100);
  const y = Math.round(Math.abs(b) * 100);
  function gcd(m, n) { return n ? gcd(n, m % n) : m; }
  const g = gcd(x, y) || 1;
  return `${x / g}:${y / g}`;
}

function aggregateLegGreeks(chain, legs, fallbackVol, price, dte, optTypeFallback) {
  const totals = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  let found = false;
  let source = 'BS';

  for (const leg of legs) {
    const type = String(leg.t || optTypeFallback || 'PUT').toLowerCase();
    const strike = safeNum(leg.s);
    const qty = Math.max(1, safeNum(leg.n || 1, 1));
    const side = leg.a === 'BUY' ? 1 : -1;
    const g = extractGreeks(findChainContract(chain, strike, type));
    if (g) {
      ['delta', 'gamma', 'theta', 'vega', 'rho'].forEach(k => {
        if (g[k] != null) {
          totals[k] += side * qty * safeNum(g[k]);
          found = true;
          source = 'Tradier';
        }
      });
    } else if (strike && price && dte && fallbackVol && !found) {
      const bd = bsDelta(price, strike, dte / 365, fallbackVol, type);
      if (bd !== null) {
        totals.delta += side * qty * bd;
        found = true;
      }
    }
  }

  if (!found) return null;
  Object.keys(totals).forEach(k => { totals[k] = parseFloat(totals[k].toFixed(4)); });
  totals.source = source;
  return totals;
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

  if (String(buyLeg.t || '').toUpperCase() !== String(sellLeg.t || '').toUpperCase()) {
    return { error: 'Credit spread legs must use the same option type' };
  }
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
  const payoff = payoffSummary(legs, cr, price, [
    { label: 'Short strike', px: shortStrike, note: 'Max profit starts beyond here', kind: 'short' },
    { label: 'Long strike', px: longStrike, note: 'Max loss starts beyond here', kind: 'loss' },
  ]);
  const maxProfit = payoff.maxProfit;
  const maxLoss = payoff.maxLoss;
  const breakeven = firstBreakeven(payoff, isPut
    ? parseFloat((shortStrike - cr).toFixed(2))
    : parseFloat((shortStrike + cr).toFixed(2)));

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
  const probs = calcCreditSpreadProbs(price, shortStrike, longStrike, vol, dte, optType, breakeven);
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
  const accountSize = safeNum(prefs?.accountSize || prefs?.startingAccountSize, null);
  const maxLossPctAccount = accountSize && maxLoss != null
    ? parseFloat((maxLoss / accountSize * 100).toFixed(1))
    : null;
  const deltaRed = parseFloat((deltaMax * 1.10).toFixed(3));
  const earningsDays = earningsCheck.date
    ? Math.ceil((new Date(earningsCheck.date + 'T12:00:00') - new Date()) / 86400000)
    : null;
  const earningsFirstHalf = earningsDays != null && dte
    ? earningsDays <= Math.ceil(dte / 2)
    : true;

  if (absDelta == null) {
    issues.push({ id:'pcs_delta_unavailable', level:'red', category:'completeness', scope:'universal', strategy:'credit_spread', metric:'absDelta', blocking:true, message:'Delta unavailable from market data or estimate, so PCS scoring is incomplete' });
  }
  if (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit)) {
    issues.push({ id:'pcs_risk_unavailable', level:'red', category:'completeness', scope:'universal', strategy:'credit_spread', blocking:true, message:'Risk/reward could not be calculated reliably, so PCS scoring is incomplete' });
  }
  if (payoff.maxLossUnlimited) {
    issues.push({ id:'pcs_undefined_risk', level:'red', category:'risk', scope:'strategy', strategy:'credit_spread', blocking:true, message:'Undefined risk detected in a defined-risk spread' });
  }
  if (maxLossPctAccount != null && maxLossPctAccount > 100) {
    issues.push({ id:'account_risk_over_100', level:'red', category:'account', scope:'universal', metric:'maxLossPctAccount', value:maxLossPctAccount, redAt:100, blocking:true, message:`Max loss is ${maxLossPctAccount}% of account size` });
  } else if (maxLossPctAccount != null && maxLossPctAccount > 50) {
    issues.push({ id:'account_risk_over_50', level:'yellow', category:'account', scope:'universal', metric:'maxLossPctAccount', value:maxLossPctAccount, warnAt:50, scoreImpact:1, message:`Max loss is ${maxLossPctAccount}% of account size` });
  }
  if (earningsCheck.risk && earningsFirstHalf) {
    issues.push({ id:'earnings_first_half', level:'red', category:'earnings', scope:'universal', strategy:'credit_spread', blocking:true, message:`Earnings ${earningsCheck.date} falls in the first half of this trade` });
  } else if (earningsCheck.risk) {
    issues.push({ id:'earnings_second_half', level:'yellow', category:'earnings', scope:'universal', strategy:'credit_spread', scoreImpact:1, message:`Earnings ${earningsCheck.date} falls before expiration` });
  }
  if (cushionPct < 0) {
    issues.push({ id:'pcs_price_beyond_short_strike', level:'red', category:'risk', scope:'strategy', strategy:'credit_spread', metric:'cushionPct', value:cushionPct, blocking:true, message:`Price is already beyond the short strike risk line (${cushionPct}% cushion)` });
  } else if (cushionPct < cushMin) {
    issues.push({ id:'pcs_cushion_below_preference', level:'yellow', category:'preference', scope:'preference', strategy:'credit_spread', metric:'cushionPct', value:cushionPct, warnAt:cushMin, scoreImpact:1, message:`${cushionPct}% cushion is below your ${cushMin}% preference` });
  }
  if (crWidthPct < 10) {
    issues.push({ id:'pcs_credit_width_red', level:'red', category:'compensation', scope:'strategy', strategy:'credit_spread', metric:'creditWidthPct', value:crWidthPct, redAt:10, blocking:true, message:`Credit is only ${crWidthPct}% of spread width -- below the 10% minimum for PCS compensation` });
  } else if (crWidthPct < 20) {
    issues.push({ id:'pcs_credit_width_yellow', level:'yellow', category:'compensation', scope:'strategy', strategy:'credit_spread', metric:'creditWidthPct', value:crWidthPct, warnAt:20, scoreImpact:1, message:`Credit is ${crWidthPct}% of spread width, below the 20% PCS target` });
  }
  if (absDelta && absDelta > deltaRed) {
    issues.push({ id:'pcs_delta_red', level:'red', category:'probability', scope:'strategy', strategy:'credit_spread', metric:'absDelta', value:absDelta, redAt:deltaRed, blocking:false, message:`Delta ${absDelta.toFixed(3)} is more than 10% above your ${deltaMax} target` });
  } else if (absDelta && absDelta > deltaMax) {
    issues.push({ id:'pcs_delta_yellow', level:'yellow', category:'probability', scope:'strategy', strategy:'credit_spread', metric:'absDelta', value:absDelta, warnAt:deltaMax, scoreImpact:1, message:`Delta ${absDelta.toFixed(3)} is above your ${deltaMax} target` });
  }
  if (dte < dteMin) {
    issues.push({ id:'dte_below_preference', level:'info', category:'context', scope:'preference', metric:'dte', value:dte, warnAt:dteMin, affectsSignal:false, message:`${dte} DTE is below your ${dteMin} preferred minimum` });
  }
  if (dte > dteMax) {
    issues.push({ id:'dte_above_preference', level:'info', category:'context', scope:'preference', metric:'dte', value:dte, warnAt:dteMax, affectsSignal:false, message:`${dte} DTE is above your ${dteMax} preferred maximum` });
  }
  if (isPut && nearestSupport && shortStrike > nearestSupport) {
    issues.push({ id:'pcs_short_above_support', level:'info', category:'context', scope:'context', strategy:'credit_spread', affectsSignal:false, message:`Context: short put $${shortStrike} sits above nearest support $${nearestSupport}` });
  }
  if (!strikeOutsideEM && em) {
    issues.push({ id:'pcs_short_inside_expected_move', level:'info', category:'context', scope:'context', strategy:'credit_spread', metric:'expectedMove', value:em, affectsSignal:false, message:`Short strike is inside the 1SD expected move ($${em})` });
  }
  const decision = finalizeUniversalSignal(issues);

  return {
    strategyGroup: 'credit_spread',
    signal: decision.signal,
    issues: decision.issues,

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
    probAnyProfit:   probs.probAnyProfit,
    probMaxLoss:     probs.probMaxLoss,
    probWorthless:   pow,
    probTouchShort:  probs.probTouchShort,
    probTouchLong:   probs.probTouchLong,

    // Move context
    em, strikeOutsideEM,

    // Levels
    supports, resistances, nearestSupport, nearestResistance,
    exitSignal, strikeAboveSupport,

    // Earnings
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    modelNotes: modelNotes(data, { greeks }),
    payoff,
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
  const rawGreeks = extractGreeks(contract);
  const vol      = getBestVol(rawGreeks, hv30);
  const greeks   = completeGreeks(rawGreeks, price, strike, dte / 365, vol, 'put');

  let absDelta = null, deltaSource = 'BS';
  if (greeks?.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = rawGreeks?.delta != null ? 'Tradier' : 'BS';
  } else if (dte) {
    const bd = bsDelta(price, strike, dte / 365, vol, 'put');
    if (bd !== null) { absDelta = Math.abs(bd); }
  }

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

    // Framing note -- assignment is not a loss in wheel strategy
    wheelNote: 'Assignment means you buy shares at your effective cost basis of $' + breakeven.toFixed(2) + '. This is the goal in wheel strategy.',
    modelNotes: modelNotes(data, { greeks }),
    payoff,
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
  if (!sameOptionType(allLegs)) return { error: 'Butterfly/BWB/ratio legs must use the same option type' };

  // Identify structure
  const sells = allLegs.filter(l => l.a === 'SELL');
  const buys  = allLegs.filter(l => l.a === 'BUY');

  if (sells.length === 0 || buys.length === 0) return { error: 'Need both buy and sell legs' };

  const groups = groupedByStrike(allLegs);
  const shortGroups = groups.filter(g => g.netQty < 0);
  const longGroups = groups.filter(g => g.netQty > 0);
  if (!shortGroups.length || !longGroups.length) return { error: 'Could not identify net long and short strikes' };

  const centerGroup = shortGroups.reduce((best, g) => Math.abs(g.netQty) > Math.abs(best.netQty) ? g : best, shortGroups[0]);
  const centerStrike = centerGroup.strike;
  const lowerStrike  = groups[0].strike;
  const upperStrike  = groups.length > 1 ? groups[groups.length - 1].strike : null;
  const hasLongBelow = longGroups.some(g => g.strike < centerStrike);
  const hasLongAbove = longGroups.some(g => g.strike > centerStrike);

  // Wings
  const lowerWing = hasLongBelow ? centerStrike - lowerStrike : null;
  const upperWing = hasLongAbove && upperStrike ? upperStrike - centerStrike : null;
  const isSymmetric = lowerWing && upperWing && Math.abs(lowerWing - upperWing) < 0.26;
  const isRatio     = !hasLongBelow || !hasLongAbove;
  const isBWB       = !isRatio && !isSymmetric;

  // Get vol
  const contract = findChainContract(chain, centerStrike, optType);
  const greeks   = extractGreeks(contract);
  const vol      = getBestVol(greeks, hv30);
  const netGreeks = aggregateLegGreeks(chain, allLegs, vol, price, dte, optType);
  const absDelta = netGreeks?.delta != null
    ? Math.abs(netGreeks.delta)
    : Math.abs(bsDelta(price, centerStrike, dte / 365, vol, optType) || 0);

  // Expiration payoff from exact leg geometry.
  const payoff = payoffSummary(legs, isCredit ? cr : -cr, price, [
    { label: 'Lower wing', px: lowerStrike, note: 'Outer long strike', kind: 'wing' },
    { label: 'Center', px: centerStrike, note: 'Tent peak / short strike area', kind: 'short' },
    ...(upperStrike ? [{ label: 'Upper wing', px: upperStrike, note: 'Outer long strike', kind: 'wing' }] : []),
  ]);
  const maxProfit = payoff.maxProfit;
  const maxLoss = payoff.maxLoss;
  const lowerBE = payoff.breakevens[0] || null;
  const upperBE = payoff.breakevens[1] || null;

  const em = calcExpectedMove(price, vol, dte);

  // Probability of max profit zone and tiers
  let probs = null;
  if (lowerBE && upperBE && maxProfit > 0) {
    probs = calcButterflyProbs(price, lowerBE, centerStrike, upperBE, vol, dte, maxProfit);
  } else if (lowerBE) {
    probs = {
      probMaxProfit: null,
      probAnyProfit: calcPOW(price, lowerBE, vol, dte, optType),
      tiers: [],
    };
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
  const wingRatioLabel = lowerWing && upperWing ? simpleRatio(lowerWing, upperWing) : null;
  const crRatio   = maxLoss && maxLoss > 0 && isCredit
    ? parseFloat(((cr * 100) / maxLoss * 100).toFixed(1))
    : null;
  const creditDollars = isCredit ? cr * 100 : 0;
  const creditCapturePct = isCredit && maxProfit && maxProfit > 0
    ? parseFloat((creditDollars / maxProfit * 100).toFixed(1))
    : null;
  const profitWindowUpside = isCredit && maxProfit != null
    ? parseFloat((maxProfit - creditDollars).toFixed(0))
    : null;

  const earningsCheck = checkEarningsRisk(earnings, expDateObj);
  const nowPayoff = payoff.checkpoints.find(p => p.label === 'Now')?.pnl;

  const issues = [];
  if (earningsCheck.risk)                issues.push({ level:'critical', weight:5, msg:`Earnings ${earningsCheck.date} within expiration` });
  if (payoff.maxLossUnlimited)          issues.push({ level:'critical', weight:6, msg:'Structure has uncapped expiration loss on one side' });
  if (nowPayoff != null && nowPayoff < 0) issues.push({ level:'warning', msg:'Price is currently outside the expiration profit zone' });
  if (crRatio && crRatio < 12)          issues.push({ level:'warning',  msg:`Low credit/risk ratio: ${crRatio}%` });

  return {
    strategyGroup: isBWB ? 'bwb' : isRatio ? 'ratio_spread' : 'butterfly',
    entryType: isCredit ? 'credit' : 'debit',
    isCredit, isBWB, isSymmetric, isRatio,
    signal: getSignal(issues),
    issues,

    price, centerStrike, lowerStrike, upperStrike,
    lowerWing, upperWing, wingRatio, wingRatioLabel,
    lowerBE, upperBE,
    maxProfit, maxLoss,
    collateral: collateralFromPayoff(payoff),
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    maxLossUnlimited: payoff.maxLossUnlimited,
    crRatio,
    creditCapturePct,
    openingCredit: isCredit ? parseFloat(creditDollars.toFixed(0)) : null,
    openingDebit: !isCredit ? parseFloat((cr * 100).toFixed(0)) : null,
    profitWindowUpside,
    vol: pct(vol),
    em,

    probMaxProfit:  probs?.probMaxProfit || null,
    probAnyProfit:  probs?.probAnyProfit || null,
    profitTiers:    probs?.tiers         || [],
    expectedValue: null,

    absDelta,
    deltaSource: netGreeks?.source || 'BS',
    greeks: netGreeks || greeks || null,
    iv: greeks?.iv || null,

    supports, resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    modelNotes: modelNotes(data, {
      greeks: netGreeks || greeks,
      structureNote: 'Butterfly/BWB/ratio payoff now uses exact entered legs at expiration. Probability tiers are still estimated from a simplified profit zone.',
    }),
    payoff,
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
    breakeven,
    maxLoss,
    collateral: collateralFromPayoff(payoff),
    maxProfit: payoff.maxProfit,
    maxProfitUnlimited: payoff.maxProfitUnlimited,
    theoreticalMax: targetData.theoreticalMax, // null for calls, real for puts

    absDelta,
    greeks: greeks || null,
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

    // Honest framing note
    framingNote: isCall
      ? `Theoretical max profit is unlimited, but realistically: a 20% move in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability at current volatility.`
      : `Theoretical max profit requires stock to reach $0. Realistically: a 20% drop in ${dte} days has ~${pct(targetData.allTargets?.find(t=>t.movePct===0.20)?.prob || 0.05)}% probability.`,
    modelNotes: modelNotes(data, { greeks }),
    payoff,
  };
}

// ---------------------------------------------------------------------------
// 8. CUSTOM -- generic payoff-engine analysis
// ---------------------------------------------------------------------------
export function analyzeCustomPayoff(data, legs, expDateObj, dte, credit, prefs, isCredit = true) {
  const { price, hv30, supports, resistances, earnings } = data;
  const entry = safeNum(credit);
  const netPremiumPerShare = isCredit ? entry : -entry;
  const payoff = payoffSummary(legs, netPremiumPerShare, price);
  const earningsCheck = checkEarningsRisk(earnings, expDateObj);
  const issues = [];

  if (payoff.maxLossUnlimited) {
    issues.push({ level:'critical', weight:6, msg:'Custom structure has undefined/naked risk' });
  }
  if (earningsCheck.risk) {
    issues.push({ level:'critical', weight:5, msg:`Earnings ${earningsCheck.date} within expiration` });
  }
  if (!payoff.breakevens.length) {
    issues.push({ level:'warning', weight:2, msg:'No breakeven found in modeled expiration range' });
  }

  return {
    strategyGroup: 'custom',
    signal: getSignal(issues),
    issues,
    price,
    entryType: isCredit ? 'credit' : 'debit',
    entryPremium: entry,
    breakevens: payoff.breakevens,
    breakeven: firstBreakeven(payoff),
    ...riskFieldsFromPayoff(payoff),
    vol: pct(hv30 || 0.30),
    supports,
    resistances,
    earningsRisk: earningsCheck.risk,
    earningsDate: earningsCheck.date,
    modelNotes: modelNotes(data, {
      structureNote: 'Custom analysis uses the generic payoff engine from the exact entered legs. Probability and strategy-specific quality checks are intentionally limited.',
    }),
    payoff,
  };
}
