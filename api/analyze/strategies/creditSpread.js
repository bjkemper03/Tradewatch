// =============================================================================
// api/analyze/strategies/creditSpread.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcCreditSpreadProbs } from '../probability.js';
import { safeNum, pct } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, firstBreakeven } from './sharedPayoff.js';
import { checkEarningsRisk, finalizeScoredSignal, modelNotes, pushDataConfidenceIssues, pushEarningsScoreIssue } from './sharedContext.js';

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
  const shortLegGreeks = getLegGreek(chain, sellLeg, vol, price, dte, optType);
  const longLegGreeks = getLegGreek(chain, buyLeg, vol, price, dte, optType);
  const positionGreeks = buildPositionGreeks(chain, legs, vol, price, dte, optType);
  const keyLegGreeks = buildKeyLegGreeks(isPut
    ? { shortPut: shortLegGreeks, longPut: longLegGreeks }
    : { shortCall: shortLegGreeks, longCall: longLegGreeks });
  const scoringGreeks = {
    delta: null,
    deltaLabel: isPut ? 'Short put delta' : 'Short call delta',
  };

  // Delta -- real from chain or Black-Scholes
  let absDelta = null, deltaSource = 'BS';
  if (greeks && greeks.delta != null) {
    absDelta = Math.abs(greeks.delta);
    deltaSource = 'Tradier';
  } else if (shortStrike && price && dte) {
    const bd = bsDelta(price, shortStrike, dte / 365, vol, optType);
    if (bd !== null) absDelta = Math.abs(bd);
  }
  scoringGreeks.delta = absDelta;

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
  const dteMin  = 21;
  const dteMax  = 45;
  const crwMin  = prefs?.creditWidthMin || 8;
  const deltaMax = prefs?.deltaHigh || 0.30;
  const accountSize = safeNum(prefs?.accountSize || prefs?.startingAccountSize, null);
  const maxLossPctAccount = accountSize && maxLoss != null
    ? parseFloat((maxLoss / accountSize * 100).toFixed(1))
    : null;
  const deltaRed = parseFloat((deltaMax * 1.10).toFixed(3));
  if (absDelta == null) {
    issues.push({ id:'pcs_delta_unavailable', level:'red', category:'completeness', scope:'universal', strategy:'credit_spread', metric:'absDelta', blocking:true, scoreImpact:0, message:'Delta unavailable from market data or estimate, so PCS scoring is incomplete' });
  }
  if (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit)) {
    issues.push({ id:'pcs_risk_unavailable', level:'red', category:'completeness', scope:'universal', strategy:'credit_spread', blocking:true, scoreImpact:0, message:'Risk/reward could not be calculated reliably, so PCS scoring is incomplete' });
  }
  if (payoff.maxLossUnlimited) {
    issues.push({ id:'pcs_undefined_risk', level:'red', category:'risk', scope:'strategy', strategy:'credit_spread', metric:'maxLossUnlimited', value:true, scoreImpact:-55, message:'Undefined risk detected in a defined-risk spread' });
  }
  if (maxLossPctAccount != null && maxLossPctAccount > 100) {
    issues.push({ id:'account_risk_over_100', level:'red', category:'account', scope:'universal', metric:'maxLossPctAccount', value:maxLossPctAccount, redAt:100, scoreImpact:-55, message:`Max loss is ${maxLossPctAccount}% of account size` });
  } else if (maxLossPctAccount != null && maxLossPctAccount > 50) {
    issues.push({ id:'account_risk_over_50', level:'yellow', category:'account', scope:'universal', metric:'maxLossPctAccount', value:maxLossPctAccount, warnAt:50, scoreImpact:-35, message:`Max loss is ${maxLossPctAccount}% of account size` });
  }
  pushEarningsScoreIssue(issues, 'credit_spread', earningsCheck, dte);
  if (cushionPct < 0) {
    issues.push({ id:'pcs_price_beyond_short_strike', level:'red', category:'risk', scope:'strategy', strategy:'credit_spread', metric:'cushionPct', value:cushionPct, redAt:0, scoreImpact:-30, message:`Price is already beyond the short strike risk line (${cushionPct}% cushion)` });
  } else if (cushionPct < cushMin) {
    issues.push({ id:'pcs_cushion_below_preference', level:'yellow', category:'risk', scope:'strategy', strategy:'credit_spread', metric:'cushionPct', value:cushionPct, warnAt:cushMin, scoreImpact:-15, message:`${cushionPct}% cushion is below your ${cushMin}% preference; expected-move cushion thresholds are placeholders for owner review` });
  }
  if (crWidthPct < 10) {
    issues.push({ id:'pcs_credit_width_red', level:'red', category:'compensation', scope:'strategy', strategy:'credit_spread', metric:'creditWidthPct', value:crWidthPct, redAt:10, scoreImpact:-25, message:`Credit is only ${crWidthPct}% of spread width -- below the placeholder minimum for PCS compensation` });
  } else if (crWidthPct < 20) {
    issues.push({ id:'pcs_credit_width_yellow', level:'yellow', category:'compensation', scope:'strategy', strategy:'credit_spread', metric:'creditWidthPct', value:crWidthPct, warnAt:20, scoreImpact:-15, message:`Credit is ${crWidthPct}% of spread width, below the placeholder PCS target` });
  }
  if (absDelta && absDelta > deltaRed) {
    issues.push({ id:'pcs_delta_red', level:'red', category:'probability', scope:'strategy', strategy:'credit_spread', metric:'absDelta', value:absDelta, redAt:deltaRed, scoreImpact:-20, message:`Delta ${absDelta.toFixed(3)} is more than 10% above your ${deltaMax} placeholder target` });
  } else if (absDelta && absDelta > deltaMax) {
    issues.push({ id:'pcs_delta_yellow', level:'yellow', category:'probability', scope:'strategy', strategy:'credit_spread', metric:'absDelta', value:absDelta, warnAt:deltaMax, scoreImpact:-10, message:`Delta ${absDelta.toFixed(3)} is above your ${deltaMax} placeholder target` });
  }
  if (dte < dteMin) {
    issues.push({ id:'dte_below_preference', level:'yellow', category:'preference', scope:'preference', strategy:'credit_spread', metric:'dte', value:dte, warnAt:dteMin, scoreImpact:-10, message:`${dte} DTE is below the placeholder credit-spread fit range` });
  }
  if (dte > dteMax) {
    issues.push({ id:'dte_above_preference', level:'yellow', category:'preference', scope:'preference', strategy:'credit_spread', metric:'dte', value:dte, warnAt:dteMax, scoreImpact:-5, message:`${dte} DTE is above the placeholder credit-spread fit range` });
  }
  if (isPut && nearestSupport && shortStrike > nearestSupport) {
    issues.push({ id:'pcs_short_above_support', level:'info', category:'context', scope:'context', strategy:'credit_spread', affectsSignal:false, message:`Context: short put $${shortStrike} sits above nearest support $${nearestSupport}` });
  }
  if (!strikeOutsideEM && em) {
    issues.push({ id:'pcs_short_inside_expected_move', level:'info', category:'context', scope:'context', strategy:'credit_spread', metric:'expectedMove', value:em, affectsSignal:false, message:`Short strike is inside the 1SD expected move ($${em})` });
  }
  pushDataConfidenceIssues(issues, 'credit_spread', data, { greeks, ivAvailable: greeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  return {
    strategyGroup: 'credit_spread',
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

    // Core
    price, shortStrike, longStrike, spreadWidth,
    breakeven, cushionPct, beCushionPct, crWidthPct,
    maxProfit, maxLoss,

    // Greeks
    absDelta, deltaSource,
    greeks: greeks || null,
    positionGreeks,
    keyLegGreeks,
    scoringGreeks,
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
