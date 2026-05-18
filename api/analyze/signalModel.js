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

function defaultScoreImpact(level) {
  if (level === 'yellow') return 1;
  if (level === 'red') return 3;
  return 0;
}

export function createIssue(issue) {
  const level = normalizeLevel(issue.level);
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
    scoreImpact: issue.scoreImpact ?? defaultScoreImpact(level),
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
    const scoreDiff = (b.scoreImpact || 0) - (a.scoreImpact || 0);
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
  if (severeNonBlocking.length || meaningfulYellows.length >= 2) {
    return { signal: 'CAUTION', issues: normalized };
  }
  return { signal: 'GO', issues: normalized };
}

export function legacyIssue(issue) {
  const normalized = createIssue(issue);
  return {
    ...normalized,
    msg: normalized.message,
  };
}
