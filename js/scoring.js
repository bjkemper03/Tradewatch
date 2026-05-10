// =============================================================================
// js/scoring.js -- Market signal scoring and trade assessment
// Loaded by index.html as a plain script tag -- no imports/exports needed.
// All functions are global so index.html and page modules can call them.
// =============================================================================

// ---------------------------------------------------------------------------
// VIX scoring (0-100)
// ---------------------------------------------------------------------------
function scoreVIX(level, chg) {
  let s = 62;
  if (level === null || level === undefined) return s;
  if      (level < 16) s += 18;
  else if (level < 20) s += 10;
  else if (level < 24) s += 2;
  else if (level < 28) s -= 10;
  else if (level < 33) s -= 22;
  else                 s -= 38;
  if      (chg >  35) s -= 28;
  else if (chg >  20) s -= 16;
  else if (chg >  12) s -= 7;
  else if (chg < -15) s += 8;
  else if (chg <  -8) s += 4;
  return Math.max(0, Math.min(100, s));
}

// ---------------------------------------------------------------------------
// Market structure scoring (0-100)
// ---------------------------------------------------------------------------
function scoreStructure(above50, above200, qqqAbove50, rspDiff) {
  let s = 55;
  if (above50)    s += 15; else s -= 18;
  if (above200)   s += 10; else s -= 10;
  if (qqqAbove50) s += 10; else s -= 8;
  if      (rspDiff >  0.5) s += 10;
  else if (rspDiff < -1.5) s -= 15;
  else if (rspDiff < -0.5) s -= 5;
  return Math.max(0, Math.min(100, s));
}

// ---------------------------------------------------------------------------
// Sentiment scoring (0-100)
// ---------------------------------------------------------------------------
function scoreSentiment(fg, creditChg) {
  let s = 65;
  if (fg) {
    if      (fg.score > 75) s -= 5;
    else if (fg.score < 30) s -= 20;
    else if (fg.score < 45) s -= 10;
  }
  if      (creditChg >  20) s -= 28;
  else if (creditChg >  10) s -= 15;
  else if (creditChg >   4) s -= 7;
  else if (creditChg <  -5) s += 10;
  return Math.max(0, Math.min(100, s));
}

// ---------------------------------------------------------------------------
// Overall signal -- GREEN / YELLOW / RED
// ---------------------------------------------------------------------------
function getSignal(vixScore, structScore, sentScore) {
  const composite = vixScore * 0.40 + structScore * 0.35 + sentScore * 0.15 + 10;
  if (Math.min(vixScore, structScore) < 25 || composite < 36) return 'RED';
  if (Math.min(vixScore, structScore) < 42 || composite < 56) return 'YELLOW';
  return 'GREEN';
}

// ---------------------------------------------------------------------------
// Build full signal result from market data object
// ---------------------------------------------------------------------------
function buildSignalResult(mkt) {
  const { vix, fg, spy, qqq, hyg, rsp } = mkt;
  const creditChg   = (hyg && hyg.perf5) ? -hyg.perf5 * 2 : 0;
  const rspDiff     = (rsp && spy) ? parseFloat((rsp.perf5 - spy.perf5).toFixed(2)) : 0;
  const vixScore    = scoreVIX(vix && vix.level, (vix && vix.chg) || 0);
  const structScore = scoreStructure(
    spy && spy.above50,
    spy && spy.above200,
    qqq && qqq.above50,
    rspDiff
  );
  const sentScore = scoreSentiment(fg, creditChg);
  const composite = Math.round(vixScore * 0.40 + structScore * 0.35 + sentScore * 0.15 + 10);
  const signal    = getSignal(vixScore, structScore, sentScore);
  return { vixScore, structScore, sentScore, composite, signal, creditChg, rspDiff };
}

// ---------------------------------------------------------------------------
// Trade assessment -- uses global prefs object from index.html
// ---------------------------------------------------------------------------
function assessTrade(cushion, dte) {
  const c   = parseFloat(cushion) || 0;
  const d   = parseInt(dte) || 999;
  const min = (typeof prefs !== 'undefined') ? prefs.cushionMin : 5;
  if (c >= min + 2 && d > 7)  return { label: 'SAFE',     color: '#22c55e', cls: 'safe' };
  if (c >= min + 2 && d <= 7) return { label: 'EXPIRING', color: '#f59e0b', cls: 'warn' };
  if (c >= min     && d > 5)  return { label: 'MONITOR',  color: '#f59e0b', cls: 'warn' };
  if (c >= min     && d <= 5) return { label: 'AT RISK',  color: '#ef4444', cls: 'risk' };
  return                              { label: 'CRITICAL', color: '#ef4444', cls: 'risk' };
}

// ---------------------------------------------------------------------------
// Guidance text for overview page
// ---------------------------------------------------------------------------
function buildGuidance(sig, vix, spy, creditChg, fg, rspDiff) {
  const cushMin = (typeof prefs !== 'undefined') ? prefs.cushionMin : 5;
  const dteRange = (typeof prefs !== 'undefined') ? prefs.dteLow + '-' + prefs.dteHigh : '14-21';
  const s = cushMin + '%';

  if (sig === 'GREEN') {
    return (vix && vix.ok && vix.level
        ? 'VIX at ' + vix.level + ' is ' + (vix.level < 18 ? 'low -- ideal for premium collection.' : 'moderate and stable.')
        : 'Market structure constructive.')
      + ' ' + (fg ? 'Fear/Greed at ' + fg.score + ' (' + fg.rating + ').' : '')
      + ' ' + (spy && spy.above50 && spy.above200 ? 'SPY holding above both key moving averages.'
               : spy && spy.above50 ? 'SPY above 50MA.' : 'SPY below 50MA -- watch.')
      + ' ' + (rspDiff > 0.5 ? 'Equal-weight outperforming -- broad participation.'
               : rspDiff < -1 ? 'Narrow market -- only large caps leading. Be selective.' : '')
      + ' Your ' + dteRange + ' DTE credit structures are well-positioned. Stick to ' + s + ' cushion minimum.';
  }
  if (sig === 'YELLOW') {
    return 'Mixed environment.'
      + (vix && vix.ok && vix.chg > 10 ? ' VIX spiked ' + vix.chg + '% in 5 days -- elevated fear.' : '')
      + (fg && fg.score < 35 ? ' Market showing fear -- be selective.' : '')
      + (rspDiff < -1 ? ' Breadth narrowing.' : '')
      + ' Size down, close positions below ' + s + ' cushion, check calendar before any new opens.';
  }
  return 'Elevated risk.'
    + (vix && vix.ok && vix.level > 30 ? ' VIX at ' + vix.level + ' is high fear.' : '')
    + (fg && fg.score < 25 ? ' Extreme fear in market.' : '')
    + (creditChg > 10 ? ' Credit spreads widening.' : '')
    + ' Avoid new positions until conditions normalize.';
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases (index.html uses old short names)
// These keep existing code working without changes during the split
// ---------------------------------------------------------------------------
var sVIX    = scoreVIX;
var sStruct = scoreStructure;
var sSent   = scoreSentiment;
var getSig  = getSignal;
