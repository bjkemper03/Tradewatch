// =============================================================================
// api/analyze/strategies/creditSpread.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcCreditSpreadProbs } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, getBestVol } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven } from './sharedPayoff.js';
import { checkEarningsRisk, finalizeUniversalSignal, modelNotes } from './sharedContext.js';

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
