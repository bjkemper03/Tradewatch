// =============================================================================
// api/analyze/strategies/sharedContext.js
// Shared context and signal helpers for strategy analysis.
// =============================================================================

import { decideSignal, legacyIssue } from '../signalModel.js';

export function checkEarningsRisk(earnings, expDateObj) {
  if (!earnings || !expDateObj) return { risk: false, date: null, unknown: true };
  const ed = new Date(earnings.date + 'T12:00:00');
  if (isNaN(ed.getTime())) return { risk: false, date: earnings.date || null, unknown: true };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { risk: ed >= today && ed <= expDateObj, date: earnings.date, unknown: false };
}

export function getSignal(issues) {
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

export function finalizeUniversalSignal(issues, options = {}) {
  const decision = decideSignal(issues, options);
  return {
    signal: decision.signal,
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
      blocking: true,
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
      scoreImpact: 1,
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
      message: 'Earnings date unavailable; confirm event risk before entry',
    });
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
