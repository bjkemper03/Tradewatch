// =============================================================================
// api/analyze/strategies/sharedContext.js
// Shared context and signal helpers for strategy analysis.
// =============================================================================

import { decideSignal, legacyIssue } from '../signalModel.js';

export function checkEarningsRisk(earnings, expDateObj) {
  if (!earnings || !expDateObj) return { risk: false, date: null };
  const ed = new Date(earnings.date + 'T12:00:00');
  if (isNaN(ed.getTime())) return { risk: false, date: earnings.date || null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { risk: ed >= today && ed <= expDateObj, date: earnings.date };
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
