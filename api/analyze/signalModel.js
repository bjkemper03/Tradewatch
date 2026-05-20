// =============================================================================
// api/analyze/signalModel.js
// Universal issue contract and signal decision model.
// Strategy modules provide strategy-specific issues, but signal judgment follows
// one shared process so GO / CAUTION / NO-GO / INCOMPLETE mean the same thing.
// =============================================================================

const LEVEL_RANK = {
  red: 0,
  yellow: 1,
  info: 2,
};

const CATEGORY_RANK = {
  completeness: 0,
  structure: 1,
  risk: 2,
  account: 3,
  earnings: 4,
  compensation: 5,
  probability: 6,
  preference: 7,
  liquidity: 8,
  context: 9,
  model: 10,
};

function normalizeLevel(level) {
  if (level === 'critical') return 'red';
  if (level === 'warning') return 'yellow';
  if (level === 'note' || !level) return 'info';
  return level;
}

function defaultScoreImpact(issue, level) {
  console.warn('[analyze] Missing scoreImpact for issue ' + (issue?.id || '(unknown)') + ' at level ' + level + '; defaulting to 0');
  return 0;
}

export function createIssue(issue) {
  const level = normalizeLevel(issue.level);
  const hasScoreImpact = Object.prototype.hasOwnProperty.call(issue, 'scoreImpact');
  return {
    id: issue.id || `${issue.category || 'model'}_${level}`,
    level,
    category: issue.category || 'model',
    scope: issue.scope || 'strategy',
    strategy: issue.strategy || null,
    metric: issue.metric || null,
    value: issue.value ?? null,
    warnAt: issue.warnAt ?? null,
    redAt: issue.redAt ?? null,
    blocking: !!issue.blocking,
    scoreImpact: hasScoreImpact ? issue.scoreImpact : defaultScoreImpact(issue, level),
    message: issue.message || issue.msg || '',
    detail: issue.detail || null,
    source: issue.source || 'calculated',
    affectsSignal: issue.affectsSignal ?? (level !== 'info'),
  };
}

export function sortIssues(issues = []) {
  return [...issues].sort((a, b) => {
    const aLevel = normalizeLevel(a.level);
    const bLevel = normalizeLevel(b.level);
    const blockingDiff = (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0);
    if (blockingDiff) return blockingDiff;
    const levelDiff = (LEVEL_RANK[aLevel] ?? 9) - (LEVEL_RANK[bLevel] ?? 9);
    if (levelDiff) return levelDiff;
    const scoreDiff = (a.scoreImpact || 0) - (b.scoreImpact || 0);
    if (scoreDiff) return scoreDiff;
    return (CATEGORY_RANK[a.category] ?? 99) - (CATEGORY_RANK[b.category] ?? 99);
  });
}

export function decideSignal(issues = [], options = {}) {
  const normalized = sortIssues(issues.map(createIssue));

  if (normalized.some(issue => issue.level === 'red' && issue.category === 'completeness')) {
    return { signal: 'INCOMPLETE', issues: normalized };
  }

  if (normalized.some(issue => issue.level === 'red' && issue.blocking)) {
    return { signal: 'NO-GO', issues: normalized };
  }

  const meaningfulYellows = normalized.filter(issue =>
    issue.level === 'yellow' &&
    issue.affectsSignal &&
    issue.category !== 'context' &&
    issue.category !== 'model' &&
    issue.category !== 'liquidity'
  );
  const severeNonBlocking = normalized.filter(issue =>
    issue.level === 'red' &&
    issue.affectsSignal &&
    !issue.blocking
  );

  if (options.noGoOnThreeTradeQualityWarnings && meaningfulYellows.length >= 3) {
    return { signal: 'NO-GO', issues: normalized };
  }
  if (options.cautionOnAnyMeaningfulIssue && meaningfulYellows.length >= 1) {
    return { signal: 'CAUTION', issues: normalized };
  }
  if (severeNonBlocking.length || meaningfulYellows.length >= 2) {
    return { signal: 'CAUTION', issues: normalized };
  }
  return { signal: 'GO', issues: normalized };
}

export function scoreBand(score, issues = []) {
  if (score == null) return null;
  const flaggedMetrics = issues
    .filter(issue => issue.scoreImpact < 0)
    .map(issue => issue.metric || issue.category || issue.id)
    .filter(Boolean);
  if (score >= 70 && score <= 74) return { zone: 'approaching_go', label: 'CAUTION, approaching GO', flaggedMetrics };
  if (score >= 75 && score <= 79) return { zone: 'approaching_caution', label: 'GO, approaching CAUTION', flaggedMetrics };
  if (score >= 50 && score <= 54) return { zone: 'approaching_no_go', label: 'CAUTION, approaching NO-GO', flaggedMetrics };
  if (score >= 55 && score <= 59) return { zone: 'weakening', label: 'CAUTION, weakening', flaggedMetrics };
  return { zone: 'normal', label: '', flaggedMetrics };
}

export function decideScoredSignal(issues = []) {
  const normalized = sortIssues(issues.map(createIssue));
  if (normalized.some(issue => issue.level === 'red' && issue.category === 'completeness')) {
    return { signal: 'INCOMPLETE', score: null, scoreBand: null, issues: normalized };
  }

  const score = normalized.reduce((sum, issue) => sum + (Number.isFinite(issue.scoreImpact) ? issue.scoreImpact : 0), 100);
  const signal = score >= 75 ? 'GO' : score >= 50 ? 'CAUTION' : 'NO-GO';
  return { signal, score, scoreBand: scoreBand(score, normalized), issues: normalized };
}

export function legacyIssue(issue) {
  const normalized = createIssue(issue);
  return {
    ...normalized,
    msg: normalized.message,
  };
}
