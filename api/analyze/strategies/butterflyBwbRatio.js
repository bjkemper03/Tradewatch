// =============================================================================
// api/analyze/strategies/butterflyBwbRatio.js
// =============================================================================

import { findChainContract, extractGreeks } from '../dataFetch.js';
import { calcExpectedMove, calcPOW, calcButterflyProbs } from '../probability.js';
import { safeNum, pct, simpleRatio } from './sharedMath.js';
import { bsDelta, buildKeyLegGreeks, buildPositionGreeks, getBestVol, getLegGreek } from './sharedGreeks.js';
import { payoffSummary, collateralFromPayoff } from './sharedPayoff.js';
import { groupedByStrike, sameOptionType } from './sharedStructure.js';
import {
  checkEarningsRisk,
  finalizeScoredSignal,
  modelNotes,
  pushAccountRiskIssues,
  pushCompletenessIssue,
  pushDataConfidenceIssues,
  pushDteFitIssue,
  pushEarningsScoreIssue,
  pushUndefinedRiskIssue,
} from './sharedContext.js';

export function analyzeButterflyBWB(data, legs, expDateObj, dte, credit, prefs, isCredit) {
  const { price, hv30, supports, resistances, earnings, chain } = data;
  const cr = safeNum(credit);

  // Sort legs by strike to identify structure
  const allLegs = legs.map(l => ({ ...l, strike: safeNum(l.s) })).filter(l => l.strike > 0);
  if (!sameOptionType(allLegs)) return { error: 'Butterfly/BWB/ratio legs must use the same option type' };
  const optType = allLegs[0].t.toLowerCase();

  // Identify structure
  const sells = allLegs.filter(l => l.a === 'SELL');
  const buys  = allLegs.filter(l => l.a === 'BUY');
  const twoLegRatio = allLegs.length === 2 &&
    sells.length === 1 &&
    buys.length === 1 &&
    Math.max(safeNum(sells[0].n || sells[0].qty || 1, 1), safeNum(buys[0].n || buys[0].qty || 1, 1)) >
      Math.min(safeNum(sells[0].n || sells[0].qty || 1, 1), safeNum(buys[0].n || buys[0].qty || 1, 1));

  if (allLegs.length < 3 && !twoLegRatio) {
    return { error: 'Ratio spread requires one long leg and one larger short leg; butterfly/BWB requires at least 3 legs' };
  }
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
  const isRatio     = twoLegRatio || !hasLongBelow || !hasLongAbove;
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
  const payoffLabels = isRatio
    ? groups.map(g => ({
        label: g.netQty < 0 ? 'Short ratio strike' : 'Long hedge strike',
        px: g.strike,
        note: g.netQty < 0 ? 'Net short side of the ratio' : 'Net long hedge side',
        kind: g.netQty < 0 ? 'short' : 'long',
      }))
    : [
        { label: 'Lower wing', px: lowerStrike, note: 'Outer long strike', kind: 'wing' },
        { label: 'Center', px: centerStrike, note: 'Tent peak / short strike area', kind: 'short' },
        ...(upperStrike ? [{ label: 'Upper wing', px: upperStrike, note: 'Outer long strike', kind: 'wing' }] : []),
      ];
  const payoff = payoffSummary(legs, isCredit ? cr : -cr, price, payoffLabels);
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
  const strategy = isBWB ? 'bwb' : isRatio ? 'ratio_spread' : 'butterfly';
  if (!payoff.maxLossUnlimited && (maxLoss == null || !Number.isFinite(maxLoss) || maxProfit == null || !Number.isFinite(maxProfit))) {
    pushCompletenessIssue(issues, strategy, 'maxLoss', 'Butterfly/BWB/ratio risk/reward could not be calculated reliably');
  }
  if (payoff.maxLossUnlimited) {
    pushUndefinedRiskIssue(issues, strategy, {
      intentional: isRatio,
      blocking: !isRatio,
      message: isRatio
        ? 'Ratio spread has intentional undefined risk on one side; confirm this is part of the plan before entry'
        : 'Structure has uncapped expiration loss on one side',
    });
  }
  pushAccountRiskIssues(issues, strategy, maxLoss, prefs);
  pushEarningsScoreIssue(issues, strategy, earningsCheck, dte);
  pushDteFitIssue(issues, strategy, dte, { min:21, max:60, label:'butterfly/BWB/ratio' });
  if (nowPayoff != null && nowPayoff < 0) {
    issues.push({ id:'butterfly_outside_profit_zone', level:'yellow', category:'risk', scope:'strategy', strategy, metric:'nowPayoff', value:nowPayoff, scoreImpact:-15, message:'Price is currently outside the expiration profit zone; placeholder cushion threshold for owner review' });
  }
  if (crRatio && crRatio < 12) {
    issues.push({ id:'butterfly_low_credit_risk_ratio', level:'yellow', category:'compensation', scope:'strategy', strategy, metric:'crRatio', value:crRatio, warnAt:12, scoreImpact:crRatio < 8 ? -25 : -15, message:`Low credit/risk ratio: ${crRatio}%; placeholder efficiency threshold for owner review` });
  }
  if (probs?.probAnyProfit != null && probs.probAnyProfit < 0.35) {
    issues.push({ id:'butterfly_probability_low', level:'red', category:'probability', scope:'strategy', strategy, metric:'probAnyProfit', value:probs.probAnyProfit, redAt:0.35, scoreImpact:-20, message:`${pct(probs.probAnyProfit)}% probability of any profit; placeholder probability threshold for owner review` });
  } else if (probs?.probAnyProfit != null && probs.probAnyProfit < 0.50) {
    issues.push({ id:'butterfly_probability_moderate', level:'yellow', category:'probability', scope:'strategy', strategy, metric:'probAnyProfit', value:probs.probAnyProfit, warnAt:0.50, scoreImpact:-10, message:`${pct(probs.probAnyProfit)}% probability of any profit; placeholder probability threshold for owner review` });
  }
  pushDataConfidenceIssues(issues, strategy, data, { greeks: netGreeks || greeks, ivAvailable: greeks?.iv != null });
  const decision = finalizeScoredSignal(issues);

  return {
    strategyGroup: strategy,
    entryType: isCredit ? 'credit' : 'debit',
    isCredit, isBWB, isSymmetric, isRatio,
    signal: decision.signal,
    issues: decision.issues,
    score: decision.score,
    scoreBand: decision.scoreBand,

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
    earningsUnknown: earningsCheck.unknown,
    modelNotes: modelNotes(data, {
      greeks: netGreeks || greeks,
      structureNote: 'Butterfly/BWB/ratio payoff now uses exact entered legs at expiration. Probability tiers are still estimated from a simplified profit zone.',
    }),
    payoff,
  };
}
