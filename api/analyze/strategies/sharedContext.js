// =============================================================================
// api/analyze/strategies/sharedContext.js
// Shared context and signal helpers for strategy analysis.
// =============================================================================

import { decideScoredSignal, decideSignal, legacyIssue } from '../signalModel.js';

export function checkEarningsRisk(earnings, expDateObj) {
  if (!earnings || !expDateObj) return { risk: false, date: null, unknown: true };
  const ed = new Date(earnings.date + 'T12:00:00');
  if (isNaN(ed.getTime())) return { risk: false, date: earnings.date || null, unknown: true };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { risk: ed >= today && ed <= expDateObj, date: earnings.date, unknown: false };
}

export function finalizeUniversalSignal(issues, options = {}) {
  const decision = decideSignal(issues, options);
  return {
    signal: decision.signal,
    issues: decision.issues.map(legacyIssue),
  };
}

export function finalizeScoredSignal(issues) {
  const decision = decideScoredSignal(issues);
  return {
    signal: decision.signal,
    score: decision.score,
    scoreBand: decision.scoreBand,
    issues: decision.issues.map(legacyIssue),
  };
}

export function issueId(strategy, key) {
  return `${strategy}_${key}`;
}

export function pushCompletenessIssue(issues, strategy, metric, message) {
  issues.push({
    id: issueId(strategy, `${metric || 'calculation'}_unavailable`),
    level: 'red',
    category: 'completeness',
    scope: 'universal',
    strategy,
    metric,
    blocking: true,
    scoreImpact: 0,
    message,
  });
}

export function pushUndefinedRiskIssue(issues, strategy, {
  intentional = false,
  blocking = true,
  message,
} = {}) {
  issues.push({
    id: issueId(strategy, intentional ? 'intentional_undefined_risk' : 'undefined_risk'),
    level: intentional ? 'yellow' : 'red',
    category: 'structure',
    scope: 'strategy',
    strategy,
    blocking,
    scoreImpact: intentional ? -20 : -55,
    message: message || (intentional
      ? 'Structure has intentional undefined risk; confirm this is part of the plan before entry'
      : 'Undefined or naked risk detected in this structure'),
  });
}

export function pushAccountRiskIssues(issues, strategy, maxLoss, prefs = {}) {
  const accountSize = Number.parseFloat(prefs?.accountSize || prefs?.startingAccountSize);
  if (!accountSize || !Number.isFinite(accountSize) || accountSize <= 0 || maxLoss == null || !Number.isFinite(maxLoss)) return;
  const maxLossPctAccount = parseFloat((maxLoss / accountSize * 100).toFixed(1));
  if (maxLossPctAccount > 100) {
    issues.push({
      id: 'account_risk_over_100',
      level: 'red',
      category: 'account',
      scope: 'universal',
      strategy,
      metric: 'maxLossPctAccount',
      value: maxLossPctAccount,
      redAt: 100,
      blocking: false,
      scoreImpact: -55,
      message: `Max loss is ${maxLossPctAccount}% of account size`,
    });
  } else if (maxLossPctAccount > 50) {
    issues.push({
      id: 'account_risk_over_50',
      level: 'yellow',
      category: 'account',
      scope: 'universal',
      strategy,
      metric: 'maxLossPctAccount',
      value: maxLossPctAccount,
      warnAt: 50,
      scoreImpact: -35,
      message: `Max loss is ${maxLossPctAccount}% of account size`,
    });
  }
}

export function pushEarningsIssue(issues, strategy, earningsCheck, {
  riskLevel = 'red',
  riskBlocking = false,
  riskMessage,
} = {}) {
  if (earningsCheck.risk) {
    issues.push({
      id: issueId(strategy, 'earnings_before_expiration'),
    level: riskLevel,
      category: 'earnings',
      scope: 'universal',
      strategy,
      blocking: riskBlocking,
      scoreImpact: 0,
      message: riskMessage || `Earnings ${earningsCheck.date} falls before expiration`,
    });
  } else if (earningsCheck.unknown) {
    issues.push({
      id: issueId(strategy, 'earnings_unknown'),
      level: 'info',
      category: 'earnings',
      scope: 'context',
      strategy,
      affectsSignal: false,
      scoreImpact: 0,
      message: 'Earnings date unavailable; confirm event risk before entry',
    });
  }
}

export function pushEarningsScoreIssue(issues, strategy, earningsCheck, dte) {
  if (earningsCheck.unknown) {
    pushEarningsIssue(issues, strategy, earningsCheck);
    return;
  }
  if (!earningsCheck.risk) return;
  if (dte >= 90) {
    issues.push({
      id: issueId(strategy, 'earnings_long_dte_context'),
      level: 'info',
      category: 'earnings',
      scope: 'context',
      strategy,
      metric: 'dte',
      value: dte,
      affectsSignal: false,
      scoreImpact: 0,
      message: `Earnings ${earningsCheck.date} occurs before expiration, but DTE >= 90 so earnings is context-only`,
    });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const earningsDate = new Date(earningsCheck.date + 'T12:00:00');
  const daysToEarnings = Math.max(0, Math.ceil((earningsDate - today) / 86400000));
  const firstHalf = daysToEarnings <= Math.ceil((dte || 0) / 2);
  const deduction = firstHalf
    ? (dte < 30 ? -45 : -25)
    : -20;
  issues.push({
    id: issueId(strategy, firstHalf ? 'earnings_first_half' : 'earnings_second_half'),
    level: deduction <= -45 ? 'red' : 'yellow',
    category: 'earnings',
    scope: 'universal',
    strategy,
    metric: 'daysToEarnings',
    value: daysToEarnings,
    warnAt: dte >= 30 ? Math.ceil(dte / 2) : null,
    redAt: dte < 30 ? Math.ceil(dte / 2) : null,
    scoreImpact: deduction,
    message: `Earnings ${earningsCheck.date} falls in the ${firstHalf ? 'first' : 'second'} half of this trade window`,
  });
}

export function pushScoredIssue(issues, {
  id,
  level = 'yellow',
  category,
  scope = 'strategy',
  strategy,
  metric,
  value = null,
  warnAt = null,
  redAt = null,
  scoreImpact,
  message,
}) {
  issues.push({
    id,
    level,
    category,
    scope,
    strategy,
    metric,
    value,
    warnAt,
    redAt,
    scoreImpact,
    message,
  });
}

export function pushCushionIssue(issues, strategy, {
  distance,
  expectedMove,
  metric = 'riskLineCushion',
  messagePrefix = 'Risk-line cushion',
} = {}) {
  if (!expectedMove || !Number.isFinite(expectedMove) || distance == null || !Number.isFinite(distance)) return;
  const ratio = distance / expectedMove;
  if (ratio >= 1) return;
  const major = ratio < 0.5;
  pushScoredIssue(issues, {
    id: issueId(strategy, major ? 'cushion_major' : 'cushion_minor'),
    level: major ? 'red' : 'yellow',
    category: 'risk',
    scope: 'strategy',
    strategy,
    metric,
    value: parseFloat(ratio.toFixed(2)),
    warnAt: 1,
    redAt: 0.5,
    scoreImpact: major ? -30 : -15,
    message: `${messagePrefix} is ${Math.round(ratio * 100)}% of expected move; placeholder threshold for owner review`,
  });
}

export function pushDteFitIssue(issues, strategy, dte, {
  min,
  max,
  severeBelow = null,
  label = 'strategy',
} = {}) {
  if (dte == null || !Number.isFinite(dte)) return;
  if (dte >= min && dte <= max) return;
  const severe = severeBelow != null && dte < severeBelow;
  pushScoredIssue(issues, {
    id: issueId(strategy, dte < min ? 'dte_below_fit' : 'dte_above_fit'),
    level: 'yellow',
    category: 'preference',
    scope: 'preference',
    strategy,
    metric: 'dte',
    value: dte,
    warnAt: dte < min ? min : max,
    scoreImpact: severe ? -10 : -5,
    message: `${dte} DTE is outside the placeholder ${label} fit range (${min}-${max})`,
  });
}

export function pushDataConfidenceIssues(issues, strategy, data, opts = {}) {
  if (!data?.chain || !data.chain.length) {
    issues.push({
      id: issueId(strategy, 'option_chain_missing'),
      level: 'info',
      category: 'model',
      scope: 'context',
      strategy,
      metric: 'optionChain',
      scoreImpact: 0,
      affectsSignal: false,
      message: 'Option chain data unavailable; Greeks and probabilities may rely on fallback estimates',
    });
  }
  if (!opts.greeks) {
    issues.push({
      id: issueId(strategy, 'greeks_estimated'),
      level: 'info',
      category: 'model',
      scope: 'context',
      strategy,
      metric: 'greeksSource',
      scoreImpact: 0,
      affectsSignal: false,
      message: 'Greeks estimated from volatility fallback because option-chain Greeks were unavailable',
    });
  }
  if (!opts.ivAvailable) {
    issues.push({
      id: issueId(strategy, 'expected_move_hv_fallback'),
      level: 'info',
      category: 'model',
      scope: 'context',
      strategy,
      metric: 'volatilitySource',
      scoreImpact: 0,
      affectsSignal: false,
      message: 'Expected move uses historical-volatility fallback because IV was unavailable',
    });
  }
  if (data?.lastDate) {
    const quoteDate = new Date(data.lastDate);
    const ageMs = Date.now() - quoteDate.getTime();
    if (!Number.isNaN(ageMs) && ageMs > 3 * 86400000) {
      issues.push({
        id: issueId(strategy, 'quote_stale'),
        level: 'info',
        category: 'model',
        scope: 'context',
        strategy,
        metric: 'lastDate',
        value: data.lastDate,
        scoreImpact: 0,
        affectsSignal: false,
        message: `Quote as-of date ${data.lastDate} may be stale`,
      });
    }
  }
}

export function modelNotes(data, opts = {}) {
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
