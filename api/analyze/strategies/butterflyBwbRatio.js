// =============================================================================
// api/analyze/strategies/butterflyBwbRatio.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcButterflyProbs } from '../probability.js';
import { safeNum, pct, simpleRatio } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, collateralFromPayoff } from './sharedPayoff.js';
import { groupedByStrike, sameOptionType } from './sharedStructure.js';
import { checkEarningsRisk, getSignal, modelNotes } from './sharedContext.js';

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
  const netGreeks = buildPositionGreeks(chain, allLegs, vol, price, dte, optType);
  const keyLegGreeks = buildKeyLegGreeks({
    body: getLegGreek(chain, centerGroup, vol, price, dte, optType),
  });
  const absDelta = netGreeks?.delta != null
    ? Math.abs(netGreeks.delta)
    : Math.abs(bsDelta(price, centerStrike, dte / 365, vol, optType) || 0);
  const scoringGreeks = {
    delta: absDelta,
    deltaLabel: 'Position delta',
  };

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
    positionGreeks: netGreeks || null,
    keyLegGreeks,
    scoringGreeks,
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
