// =============================================================================
// api/analyze/probability.js
// Probability engine for options analysis.
// Uses lognormal price distribution based on IV (preferred) or HV30 (fallback).
// All probabilities are at-expiration estimates.
// =============================================================================

// ---------------------------------------------------------------------------
// CORE MATH -- normal distribution CDF (Abramowitz & Stegun approximation)
// ---------------------------------------------------------------------------
function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x));
  return 0.5 * (1 + sgn * y);
}

// Probability that lognormal price S ends above target K at expiration
// vol = annualized volatility (decimal), T = time in years
function probAbove(S, K, vol, T) {
  if (!S || !K || !vol || !T || T <= 0 || vol <= 0) return null;
  const d2 = (Math.log(S / K) + (-0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
  return parseFloat(ncdf(d2).toFixed(4));
}

// Probability that price ends below target K
function probBelow(S, K, vol, T) {
  const pa = probAbove(S, K, vol, T);
  return pa !== null ? parseFloat((1 - pa).toFixed(4)) : null;
}

// Probability that price ends between low and high
function probBetween(S, low, high, vol, T) {
  const pAboveLow  = probAbove(S, low,  vol, T);
  const pAboveHigh = probAbove(S, high, vol, T);
  if (pAboveLow === null || pAboveHigh === null) return null;
  return parseFloat(Math.max(0, pAboveLow - pAboveHigh).toFixed(4));
}

function clampProb(v) {
  if (v === null || !Number.isFinite(v)) return null;
  return parseFloat(Math.min(1, Math.max(0, v)).toFixed(4));
}

// Approximate probability that price touches a target before expiration.
// This uses the reflection principle for a lognormal path with no drift forecast.
export function calcTouchProbability(price, target, vol, dte) {
  const T = dte / 365;
  if (!price || !target || !vol || !T || T <= 0 || vol <= 0) return null;
  if (target === price) return 1;

  const sigT = vol * Math.sqrt(T);
  const mu = -0.5 * vol * vol;

  if (target > price) {
    const barrier = Math.log(target / price);
    const p = ncdf((-barrier + mu * T) / sigT) +
      Math.exp((2 * mu * barrier) / (vol * vol)) *
      ncdf((-barrier - mu * T) / sigT);
    return clampProb(p);
  }

  const barrier = Math.log(price / target);
  const p = ncdf((-barrier - mu * T) / sigT) +
    Math.exp((-2 * mu * barrier) / (vol * vol)) *
    ncdf((-barrier + mu * T) / sigT);
  return clampProb(p);
}

// ---------------------------------------------------------------------------
// EXPECTED MOVE -- 1 SD move by expiration
// ---------------------------------------------------------------------------
export function calcExpectedMove(price, vol, dte) {
  if (!price || !vol || !dte) return null;
  return parseFloat((price * vol * Math.sqrt(dte / 365)).toFixed(2));
}

// ---------------------------------------------------------------------------
// PROBABILITY OF EXPIRING WORTHLESS (POW)
// For a short option -- probability it expires OTM (worthless = full profit)
// For puts:  P(price > strike) at expiration
// For calls: P(price < strike) at expiration
// ---------------------------------------------------------------------------
export function calcPOW(price, strike, vol, dte, optionType) {
  const T = dte / 365;
  if (optionType === 'put') {
    return probAbove(price, strike, vol, T);
  } else {
    return probBelow(price, strike, vol, T);
  }
}

// ---------------------------------------------------------------------------
// PROBABILITY OF PROFIT (POP) for defined-risk spreads
// Credit spread: P(price stays OTM of short strike)
// Same as POW for single-leg, adjusted for spread
// ---------------------------------------------------------------------------
export function calcPOP(price, shortStrike, vol, dte, optionType) {
  return calcPOW(price, shortStrike, vol, dte, optionType);
}

// ---------------------------------------------------------------------------
// CREDIT SPREAD -- probability tiers
// Returns probability of keeping various % of max profit
// ---------------------------------------------------------------------------
export function calcCreditSpreadProbs(price, shortStrike, longStrike, vol, dte, optionType, breakeven = null) {
  const T = dte / 365;
  const isput = optionType === 'put';

  // For put credit spread: profit if price stays above short strike
  // For call credit spread: profit if price stays below short strike
  const pow = calcPOW(price, shortStrike, vol, dte, optionType);

  // Probability of touching long strike (max loss territory)
  const probMaxLoss = isput
    ? probBelow(price, longStrike, vol, T)
    : probAbove(price, longStrike, vol, T);
  const probAnyProfit = breakeven
    ? (isput ? probAbove(price, breakeven, vol, T) : probBelow(price, breakeven, vol, T))
    : pow;

  return {
    probMaxProfit:  pow,                                          // expires worthless
    probAnyProfit,
    probMaxLoss:    probMaxLoss,
    probBreakeven:  breakeven ? calcTouchProbability(price, breakeven, vol, dte) : null,
    probTouchShort: calcTouchProbability(price, shortStrike, vol, dte),
    probTouchLong:  calcTouchProbability(price, longStrike, vol, dte),
  };
}

// ---------------------------------------------------------------------------
// IRON CONDOR / IRON BUTTERFLY -- probability of staying in the tent
// shortPutStrike, shortCallStrike = the two short strikes
// ---------------------------------------------------------------------------
export function calcCondorProbs(price, shortPutStrike, shortCallStrike,
                                 longPutStrike, longCallStrike, vol, dte,
                                 putBreakeven = null, callBreakeven = null) {
  const T = dte / 365;

  // Full max profit: price between both short strikes
  const probMaxProfit = probBetween(price, shortPutStrike, shortCallStrike, vol, T);

  // Any profit: price between breakevens (need credit to calculate)
  // Returned separately -- caller passes breakevens
  const probInPutWing  = probBetween(price, longPutStrike,  shortPutStrike,  vol, T);
  const probInCallWing = probBetween(price, shortCallStrike, longCallStrike, vol, T);
  const probMaxLoss    = probBetween(price, 0,               longPutStrike,  vol, T);
  const probMaxLossCall= probAbove(price,   longCallStrike,                  vol, T);
  const probAnyProfit = putBreakeven && callBreakeven
    ? probBetween(price, putBreakeven, callBreakeven, vol, T)
    : null;

  return {
    probMaxProfit,
    probAnyProfit,
    probInPutWing,
    probInCallWing,
    probMaxLossEither: parseFloat(((probMaxLoss || 0) + (probMaxLossCall || 0)).toFixed(4)),
    probTouchPutShort:  calcTouchProbability(price, shortPutStrike, vol, dte),
    probTouchCallShort: calcTouchProbability(price, shortCallStrike, vol, dte),
  };
}

// ---------------------------------------------------------------------------
// BUTTERFLY / BWB -- probability tiers based on profit zones
// centerStrike = peak profit point
// lowerBE, upperBE = the two breakeven prices
// maxProfit = dollar max profit
// ---------------------------------------------------------------------------
export function calcButterflyProbs(price, lowerBE, centerStrike, upperBE, vol, dte, maxProfit) {
  const T = dte / 365;

  // Probability of hitting full max profit zone (tight band around center)
  // Use ±5% of the smaller wing as the "full profit zone"
  const lowerWing  = centerStrike - lowerBE;
  const upperWing  = upperBE - centerStrike;
  const tightBand  = Math.min(lowerWing, upperWing) * 0.15;
  const probMax    = probBetween(price, centerStrike - tightBand, centerStrike + tightBand, vol, T);

  // Probability of any profit (between breakevens)
  const probAnyProfit = probBetween(price, lowerBE, upperBE, vol, T);

  // Profit tiers -- what % of max profit at various price points
  // Sample 20 price points across the tent
  const tiers = [];
  if (maxProfit > 0 && lowerBE && upperBE) {
    const steps = [0.25, 0.50, 0.75];
    for (const pct of steps) {
      const dollarTarget = maxProfit * pct;
      // Linear approximation of profit at each wing
      // Lower side: profit = (price - lowerBE) / (centerStrike - lowerBE) * maxProfit
      // Upper side: profit = (upperBE - price) / (upperBE - centerStrike) * maxProfit
      const lowerPriceAtPct = lowerBE + (centerStrike - lowerBE) * pct;
      const upperPriceAtPct = upperBE - (upperBE - centerStrike) * pct;
      const probAtTier = probBetween(price, lowerPriceAtPct, upperPriceAtPct, vol, T);
      tiers.push({
        pct:     pct,
        dollars: parseFloat(dollarTarget.toFixed(0)),
        prob:    probAtTier,
      });
    }
  }

  return {
    probMaxProfit:  probMax,
    probAnyProfit,
    tiers, // [{pct:0.25, dollars:100, prob:0.45}, ...]
  };
}

// ---------------------------------------------------------------------------
// LONG OPTION -- realistic profit targets
// Shows probability of achieving various % gains or price targets
// Helps counter the "unlimited profit" misconception
// ---------------------------------------------------------------------------
export function calcLongOptionTargets(price, strike, premium, vol, dte, optionType) {
  const T    = dte / 365;
  const isCall = optionType === 'call';

  // Breakeven at expiration
  const breakeven = isCall
    ? parseFloat((strike + premium).toFixed(2))
    : parseFloat((strike - premium).toFixed(2));

  // Probability of expiring in the money (any profit)
  const probITM = isCall
    ? probAbove(price, breakeven, vol, T)
    : probBelow(price, breakeven, vol, T);

  // Probability of expiring worthless (full loss of premium)
  const probWorthless = isCall
    ? probBelow(price, strike, vol, T)
    : probAbove(price, strike, vol, T);

  // Realistic price targets based on % moves
  // For calls: need price to go UP. For puts: need price to go DOWN.
  const movePcts = [0.05, 0.10, 0.20, 0.30, 0.50];
  const targets = movePcts.map(pct => {
    const targetPrice = isCall
      ? price * (1 + pct)
      : price * (1 - pct);

    // Intrinsic value at target (ignores time value -- conservative)
    const intrinsic = isCall
      ? Math.max(0, targetPrice - strike)
      : Math.max(0, strike - targetPrice);

    const profit      = intrinsic - premium;
    const profitPct   = parseFloat((profit / premium * 100).toFixed(0));
    const probHitting = isCall
      ? probAbove(price, targetPrice, vol, T)
      : probBelow(price, targetPrice, vol, T);
    const probTouch = calcTouchProbability(price, targetPrice, vol, dte);

    return {
      movePct:    pct,
      targetPrice: parseFloat(targetPrice.toFixed(2)),
      intrinsic:  parseFloat(intrinsic.toFixed(2)),
      profit:     parseFloat(profit.toFixed(2)),
      profitDollars: parseFloat((profit * 100).toFixed(0)),
      profitPct,
      prob:       probHitting,
      probTouch,
    };
  });

  // Filter to only show profitable targets
  const profitableTargets = targets.filter(t => t.profit > 0 && (t.prob || 0) >= 0.005);

  // Theta warning -- daily decay estimate (rough)
  // Using simplified: theta ≈ -(premium * vol) / (2 * sqrt(T)) / 365
  const dailyDecayEst = T > 0
    ? parseFloat((premium * 0.5 / (dte)).toFixed(4))
    : null;

  return {
    breakeven,
    probITM,
    probWorthless,
    targets: profitableTargets,
    allTargets: targets,
    dailyDecayEst,
    maxLoss:     parseFloat((premium * 100).toFixed(2)), // per contract
    theoreticalMax: isCall ? null : parseFloat(((strike - premium) * 100).toFixed(2)),
    // ^ null for calls (unlimited), real number for puts (stock → $0)
  };
}

// ---------------------------------------------------------------------------
// CSP / COVERED CALL -- yield calculations
// Annualizes the return and shows monthly equivalent
// ---------------------------------------------------------------------------
export function calcYield(credit, collateral, dte) {
  if (!credit || !collateral || !dte || collateral === 0) return null;
  const tradeReturn  = credit / collateral;
  const annualized   = tradeReturn * (365 / dte);
  const monthly      = tradeReturn * (30  / dte);
  return {
    tradeReturnPct:  parseFloat((tradeReturn * 100).toFixed(2)),
    annualizedPct:   parseFloat((annualized  * 100).toFixed(1)),
    monthlyPct:      parseFloat((monthly     * 100).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// WHEEL SCENARIO -- if assigned / if not assigned projections
// ---------------------------------------------------------------------------
export function calcWheelScenarios(price, strike, credit, dte, optionType) {
  const isCSP = optionType === 'put';

  if (isCSP) {
    // CSP scenarios
    const effectiveCostBasis = parseFloat((strike - credit).toFixed(2));
    const breakeven          = effectiveCostBasis;
    const cushionPct         = parseFloat(((price - breakeven) / price * 100).toFixed(1));
    const collateral         = strike * 100;
    const yieldData          = calcYield(credit * 100, collateral, dte);

    return {
      // If assigned: you buy shares at effective cost basis
      ifAssigned: {
        effectiveCostBasis,
        vsCurrentPrice:   parseFloat((effectiveCostBasis - price).toFixed(2)),
        vsCurrentPricePct:parseFloat(((effectiveCostBasis - price) / price * 100).toFixed(1)),
        note: effectiveCostBasis < price
          ? 'Assigned below current price -- good cost basis'
          : 'Assigned above current price -- stock moved against you',
      },
      // If not assigned: keep premium, can re-open
      ifNotAssigned: {
        keepPremium:     parseFloat((credit * 100).toFixed(2)),
        yieldData,
        canReopenNote:  'Premium collected. Can sell another CSP to continue wheel.',
      },
      breakeven,
      cushionPct,
      collateral,
    };
  } else {
    // Covered call scenarios
    const collateral = price * 100; // approx -- shares already owned
    const yieldData  = calcYield(credit * 100, price * 100, dte); // yield vs stock value
    const downside   = parseFloat((price - credit).toFixed(2)); // effective downside protection

    return {
      // If called away: shares sold at strike
      ifCalledAway: {
        salePricePerShare: strike,
        premiumCollected:  credit,
        totalPerShare:     parseFloat((strike + credit).toFixed(2)),
        note: `Shares called away at $${strike}. Total received: $${(strike + credit).toFixed(2)}/share including premium.`,
      },
      // If not called: keep shares + premium
      ifNotCalled: {
        keepPremium:   parseFloat((credit * 100).toFixed(2)),
        yieldData,
        downsideProtection: credit,
        newBreakeven:       downside,
        note: `Premium adds $${credit}/share of downside protection. New effective breakeven: $${downside}.`,
      },
      upsideCap: strike,
    };
  }
}
