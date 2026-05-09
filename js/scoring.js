// =============================================================================
// scoring.js -- Market signal scoring and trade assessment
// =============================================================================

// ---------------------------------------------------------------------------
// Signal scoring
// ---------------------------------------------------------------------------
function scoreVIX(level, chg) {
  let s = 62;
  if (level === null) return s;
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

function scoreStructure(above50, above200, qqqAbove50, rspDiff) {
  let s = 55;
  if (above50)  s += 15; else s -= 18;
  if (above200) s += 10; else s -= 10;
  if (qqqAbove50) s += 10; else s -= 8;
  if      (rspDiff >  0.5) s += 10;
  else if (rspDiff < -1.5) s -= 15;
  else if (rspDiff < -0.5) s -= 5;
  return Math.max(0, Math.min(100, s));
}

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

function getSignal(vixScore, structScore, sentScore) {
  const composite = vixScore * 0.40 + structScore * 0.35 + sentScore * 0.15 + 10;
  if (Math.min(vixScore, structScore) < 25 || composite < 36) return 'RED';
  if (Math.min(vixScore, structScore) < 42 || composite < 56) return 'YELLOW';
  return 'GREEN';
}

function buildSignalResult(mkt) {
  const { vix, fg, spy, qqq, hyg, rsp } = mkt;
  const creditChg = hyg?.perf5 ? -hyg.perf5 * 2 : 0;
  const rspDiff   = (rsp && spy) ? parseFloat((rsp.perf5 - spy.perf5).toFixed(2)) : 0;
  const vixScore  = scoreVIX(vix?.level, vix?.chg || 0);
  const structScore = scoreStructure(spy?.above50, spy?.above200, qqq?.above50, rspDiff);
  const sentScore = scoreSentiment(fg, creditChg);
  const composite = Math.round(vixScore * 0.40 + structScore * 0.35 + sentScore * 0.15 + 10);
  const signal    = getSignal(vixScore, structScore, sentScore);
  return { vixScore, structScore, sentScore, composite, signal, creditChg, rspDiff };
}

// ---------------------------------------------------------------------------
// Trade assessment (uses user prefs)
// ---------------------------------------------------------------------------
function assessTrade(cushionPct, dte, prefs) {
  const c = parseFloat(cushionPct) || 0;
  const d = parseInt(dte) || 999;
  const min = prefs.cushionMin;
  if (c >= min + 2 && d > 7)  return { label: 'SAFE',     color: '#22c55e', cls: 'safe' };
  if (c >= min + 2 && d <= 7) return { label: 'EXPIRING', color: '#f59e0b', cls: 'warn' };
  if (c >= min     && d > 5)  return { label: 'MONITOR',  color: '#f59e0b', cls: 'warn' };
  if (c >= min     && d <= 5) return { label: 'AT RISK',  color: '#ef4444', cls: 'risk' };
  return                              { label: 'CRITICAL', color: '#ef4444', cls: 'risk' };
}

// ---------------------------------------------------------------------------
// BWB quality scorer
// ---------------------------------------------------------------------------
function scoreBWB(legs, credit, price, dte, earningsRisk, prefs) {
  const cr  = parseFloat(credit) || 0;
  const bwb = calcBWBMaxLoss(legs, cr);
  const be  = calcBWBBreakeven(legs, cr);
  if (!bwb || !be) return null;

  const contracts = legs.find(l => l.a === 'SELL')?.n || 1;
  const crDollar  = cr * 100 * contracts;
  const crRatio   = bwb.maxLoss > 0 ? parseFloat((crDollar / bwb.maxLoss * 100).toFixed(1)) : 0;
  const beCushion = price > 0 ? parseFloat(((price - be) / price * 100).toFixed(1)) : 0;
  const dteOk     = dte >= prefs.dteLow - 2 && dte <= prefs.dteHigh + 2;
  const wingRatio = bwb.upper > 0 ? parseFloat((bwb.lower / bwb.upper).toFixed(2)) : 0;

  let score = 0;
  const notes = [];

  if      (crRatio >= 20) { score += 35; notes.push('\u2713 Strong credit/risk ratio ' + crRatio + '%'); }
  else if (crRatio >= 12) { score += 20; notes.push('\u25b3 Moderate credit ratio ' + crRatio + '%'); }
  else                    { score += 5;  notes.push('\u2717 Low credit ratio ' + crRatio + '%'); }

  if      (beCushion >= prefs.cushionMin + 3) { score += 30; notes.push('\u2713 ' + beCushion + '% cushion to breakeven'); }
  else if (beCushion >= prefs.cushionMin)     { score += 18; notes.push('\u25b3 ' + beCushion + '% cushion to BE -- acceptable'); }
  else if (beCushion >= 3)                    { score += 8;  notes.push('\u26a0 ' + beCushion + '% cushion to BE -- tight'); }
  else                                        {              notes.push('\u2717 ' + beCushion + '% cushion -- too tight'); }

  if (!earningsRisk) { score += 20; notes.push('\u2713 Earnings clear'); }
  else               {              notes.push('\u2717 Earnings within expiration'); }

  if (dteOk) { score += 10; notes.push('\u2713 DTE ' + dte + ' in range'); }
  else       {              notes.push('\u25b3 DTE ' + dte + ' outside ' + prefs.dteLow + '-' + prefs.dteHigh); }

  if (wingRatio >= 1.5 && wingRatio <= 3) { score += 5; notes.push('\u2713 Wing ratio ' + wingRatio + ':1'); }
  else                                    {             notes.push('\u25b3 Wing ratio ' + wingRatio + ':1'); }

  let grade, gradeColor, gradeLabel;
  if      (score >= 75) { grade = 'A';    gradeColor = '#22c55e'; gradeLabel = 'Strong setup'; }
  else if (score >= 50) { grade = 'B';    gradeColor = '#f59e0b'; gradeLabel = 'Acceptable -- monitor'; }
  else                  { grade = 'SKIP'; gradeColor = '#ef4444'; gradeLabel = 'Below your criteria'; }

  return { grade, gradeColor, gradeLabel, score, notes, crRatio, beCushion, maxLoss: bwb.maxLoss, crDollar, be, wingRatio };
}

// ---------------------------------------------------------------------------
// Signal guidance text
// ---------------------------------------------------------------------------
function buildGuidanceText(signal, mkt, prefs, scores) {
  const { vix, fg, spy } = mkt;
  const { rspDiff, creditChg } = scores;
  const s = prefs.cushionMin + '%';

  if (signal === 'GREEN') {
    return (vix?.ok && vix?.level
      ? 'VIX at ' + vix.level + ' is ' + (vix.level < 18 ? 'low -- ideal for premium collection.' : 'moderate and stable.')
      : 'Market structure constructive.')
      + ' ' + (fg ? 'Fear/Greed at ' + fg.score + ' (' + fg.rating + ').' : '')
      + ' ' + (spy?.above50 && spy?.above200 ? 'SPY holding above both key moving averages.' : spy?.above50 ? 'SPY above 50MA.' : 'SPY below 50MA -- watch.')
      + ' ' + (rspDiff > 0.5 ? 'Equal-weight outperforming -- broad participation.' : rspDiff < -1 ? 'Narrow market -- only large caps leading. Be selective.' : '')
      + ' Your ' + prefs.dteLow + '-' + prefs.dteHigh + ' DTE credit structures are well-positioned. Stick to ' + s + ' cushion minimum.';
  }
  if (signal === 'YELLOW') {
    return 'Mixed environment.'
      + (vix?.ok && vix?.chg > 10 ? ' VIX spiked ' + vix.chg + '% in 5 days -- elevated fear.' : '')
      + (fg && fg.score < 35 ? ' Market showing fear -- be selective.' : '')
      + (rspDiff < -1 ? ' Breadth narrowing.' : '')
      + ' Size down, close positions below ' + s + ' cushion, check calendar before any new opens.';
  }
  return 'Elevated risk.'
    + (vix?.ok && vix?.level > 30 ? ' VIX at ' + vix.level + ' is high fear.' : '')
    + (fg && fg.score < 25 ? ' Extreme fear in market.' : '')
    + (creditChg > 10 ? ' Credit spreads widening.' : '')
    + ' Avoid new positions until conditions normalize.';
}
