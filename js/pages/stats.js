// =============================================================================
// js/pages/stats.js -- Performance stats page
// =============================================================================

var statsRange = 'ALL';
var statsCurvePoints = [];
var statsBaselineOpen = false;

function hasStat(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(parseFloat(v));
}

function statPct(v, suffix) {
  if (!hasStat(v)) return '—';
  return (safeNum(v) > 0 && suffix !== 'loss' ? '+' : '') + safeNum(v).toFixed(1) + '%';
}

function baselineStartDate(endDate) {
  var value = Math.max(1, parseInt(hist.baselinePeriodValue, 10) || 1);
  var unit  = hist.baselinePeriodUnit || 'years';
  var days  = unit === 'weeks' ? value * 7 : value * 365;
  return new Date(endDate.getTime() - days * 86400000);
}

function tradePnlDollars(t) {
  if (t.realizedPnl != null) return safeNum(t.realizedPnl);
  var cr        = safeNum(t.creditReceived || t.credit || 0);
  var pct       = safeNum(t.currentPnlPct || t.realizedPnlPct || 0);
  var contracts = safeNum(t.contracts || 0);
  if (!contracts) {
    var legs = t.legs || [];
    contracts = legs.reduce(function(max, leg) {
      return Math.max(max, safeNum(leg.n || 1));
    }, 1);
  }
  return cr * 100 * contracts * pct / 100;
}

function tradeIsWin(t) {
  if (t.closeReason === 'PROFIT') return true;
  return tradePnlDollars(t) > 0;
}

function tradeIsLoss(t) {
  if (t.closeReason === 'STOP') return true;
  return tradePnlDollars(t) < 0;
}

function rangeStartFor(key, endDate) {
  if (key === 'ALL') return null;
  var days = { '1D':1, '5D':5, '1M':30, '3M':90, '1Y':365, '5Y':1825 }[key] || 0;
  return new Date(endDate.getTime() - days * 86400000);
}

function closedTradeDate(t) {
  return new Date(
    (t.closeDate || t.closed_at || t.openDate || new Date().toISOString().slice(0, 10))
    + 'T12:00:00'
  );
}

function buildPnlSeries(closed, startSize) {
  var now    = new Date();
  var sorted = closed.slice().sort(function(a, b) {
    return closedTradeDate(a) - closedTradeDate(b);
  });
  var rangeStart = rangeStartFor(statsRange, now);

  // Trades inside the selected window
  var inRange = rangeStart
    ? sorted.filter(function(t) { return closedTradeDate(t) >= rangeStart; })
    : sorted;

  // Chart x-axis start
  var firstTradeDate = sorted.length ? closedTradeDate(sorted[0]) : now;
  var chartStart     = rangeStart || baselineStartDate(firstTradeDate);

  // Running P/L baseline — includes hist baseline + any trades BEFORE the window
  var baselinePnl = safeNum(hist.realizedPnl);
  if (rangeStart) {
    sorted.filter(function(t) { return closedTradeDate(t) < rangeStart; })
          .forEach(function(t) { baselinePnl += tradePnlDollars(t); });
  }

  // On ALL view: diagonal dashed line from $0 at chartStart up/down to baselinePnl
  // at the first real trade date (or now). Shows historical journey without individual records.
  // On ranged views: single anchor point at the pre-computed baselinePnl.
  var pts = [];
  if (statsRange === 'ALL') {
    var baselineEnd = sorted.length ? firstTradeDate : now;
    if (baselineEnd <= chartStart) baselineEnd = new Date(chartStart.getTime() + 86400000);
    pts.push({ date: chartStart,  pnl: 0,           label: 'Baseline start' });
    pts.push({ date: baselineEnd, pnl: baselinePnl, label: 'Baseline end • ' + (baselinePnl >= 0 ? '+' : '') + '$' + baselinePnl.toFixed(0) });
  } else {
    pts.push({ date: chartStart, pnl: baselinePnl, label: 'Start' });
  }

  var running = baselinePnl;
  inRange.forEach(function(t) {
    var d       = closedTradeDate(t);
    var dollars = tradePnlDollars(t);
    running += dollars;
    pts.push({
      date:  d,
      pnl:   running,
      label: (t.ticker || 'Trade') + ' ' + (dollars >= 0 ? '+' : '') + '$' + dollars.toFixed(0)
    });
  });

  if (!pts.length || pts[pts.length - 1].date < now) {
    pts.push({ date: now, pnl: running, label: 'Current' });
  }

  // Deduplicate
  var seen = {};
  pts = pts.filter(function(p) {
    var k = p.date.toISOString().slice(0, 10) + ':' + p.pnl.toFixed(2) + ':' + p.label;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });

  return pts.map(function(p) {
    return Object.assign({}, p, {
      equity: startSize + p.pnl,
      retPct: startSize > 0 ? p.pnl / startSize * 100 : 0
    });
  });
}

function renderPnlCurve(points, startSize) {
  var w = 720, h = 260, pad = 34;
  var xs   = points.map(function(p) { return p.date.getTime(); });
  var ys   = points.map(function(p) { return p.pnl; });
  var minX = Math.min.apply(null, xs);
  var maxX = Math.max.apply(null, xs);
  if (minX === maxX) maxX = minX + 86400000;
  var minY = Math.min(0, Math.min.apply(null, ys));
  var maxY = Math.max(0, Math.max.apply(null, ys));
  if (minY === maxY) { minY -= 100; maxY += 100; }
  var yPad = (maxY - minY) * 0.12;
  minY -= yPad; maxY += yPad;

  function x(p) { return pad + ((p.date.getTime() - minX) / (maxX - minX)) * (w - pad * 2); }
  function y(p) { return h - pad - ((p.pnl - minY) / (maxY - minY)) * (h - pad * 2); }

  var zeroY       = h - pad - ((0 - minY) / (maxY - minY)) * (h - pad * 2);
  var baselineSeg = points.slice(0, 2).map(function(p) { return x(p).toFixed(1) + ',' + y(p).toFixed(1); }).join(' ');
  var tradeSeg    = points.slice(1).map(function(p) { return x(p).toFixed(1) + ',' + y(p).toFixed(1); }).join(' ');

  statsCurvePoints = points.map(function(p) {
    return {
      x: x(p), y: y(p), pnl: p.pnl, equity: p.equity, retPct: p.retPct,
      date:  p.date.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }),
      label: p.label
    };
  });

  return '<div class="card stats-chart-card">' +
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px">' +
      '<div>' +
        '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Closed Trade P/L Curve</div>' +
        '<div style="font-size:11px;color:var(--text3)">Return anchored to starting account: $' + startSize.toFixed(0) + '</div>' +
      '</div>' +
      '<div class="stats-range">' +
        ['1D','5D','1M','3M','1Y','5Y','ALL'].map(function(r) {
          return '<button class="' + (statsRange === r ? 'active' : '') + '" onclick="statsRange=\'' + r + '\';renderStats()">' + r + '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="stats-chart-wrap" onmousemove="statsChartMove(event)" onmouseleave="statsChartLeave()">' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w-pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
        (points.length > 1 ? '<polyline points="' + baselineSeg + '" fill="none" stroke="var(--text3)" stroke-width="2" stroke-dasharray="7 7" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
        (points.length > 2 ? '<polyline points="' + tradeSeg    + '" fill="none" stroke="var(--blue2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
        points.map(function(p) {
          return '<circle cx="' + x(p).toFixed(1) + '" cy="' + y(p).toFixed(1) + '" r="4" fill="' + (p.pnl >= 0 ? 'var(--green)' : 'var(--red)') + '"/>';
        }).join('') +
      '</svg>' +
      '<div id="stats-tip" class="stats-tip"></div>' +
    '</div>' +
  '</div>';
}

function statsChartMove(e) {
  if (!statsCurvePoints.length) return;
  var wrap = e.currentTarget;
  var rect = wrap.getBoundingClientRect();
  var svgX = (e.clientX - rect.left) / rect.width * 720;
  var nearest = statsCurvePoints.reduce(function(best, p) {
    return Math.abs(p.x - svgX) < Math.abs(best.x - svgX) ? p : best;
  }, statsCurvePoints[0]);
  var tip = $('stats-tip');
  if (!tip) return;
  tip.style.display = 'block';
  tip.style.left = Math.min(Math.max((nearest.x / 720 * rect.width), 90), rect.width - 90) + 'px';
  tip.style.top  = Math.max((nearest.y / 260 * rect.height) - 6, 18) + 'px';
  tip.innerHTML =
    '<div style="font-weight:700;color:var(--text)">'   + nearest.date + '</div>' +
    '<div style="color:' + (nearest.pnl >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
      (nearest.pnl >= 0 ? '+' : '') + '$' + nearest.pnl.toFixed(0) +
      ' / ' + (nearest.retPct >= 0 ? '+' : '') + nearest.retPct.toFixed(1) + '%' +
    '</div>' +
    '<div style="color:var(--text3)">Equity $' + nearest.equity.toFixed(0) + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + nearest.label + '</div>';
}

function statsChartLeave() {
  var tip = $('stats-tip');
  if (tip) tip.style.display = 'none';
}

function renderStats() {
  var el = $('page-stats');
  if (!el) return;

  var closed       = trades.filter(function(t) { return t.status === 'CLOSED'; });
  var open         = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closedWins   = closed.filter(tradeIsWin).length;
  var closedLosses = closed.filter(tradeIsLoss).length;
  var nTotal       = safeNum(hist.totalTrades) + closed.length;
  var nWins        = safeNum(hist.wins) + closedWins;
  var nLosses      = safeNum(hist.losses) + closedLosses;
  var closedPnl    = closed.reduce(function(acc, t) { return acc + tradePnlDollars(t); }, 0);
  var totalPnl     = safeNum(hist.realizedPnl) + closedPnl;
  var startSize    = safeNum(prefs.startingAccountSize || prefs.accountSize || 10000) || 10000;
  var currentEquity= startSize + totalPnl;
  var retPct       = startSize > 0 ? totalPnl / startSize * 100 : 0;
  var wr           = nTotal > 0 ? ((nWins / nTotal) * 100).toFixed(1) : '0.0';
  var wrc          = parseFloat(wr) > 70 ? 'var(--green)' : parseFloat(wr) > 55 ? 'var(--yellow)' : 'var(--red)';
  var colInUse     = open.reduce(function(a, t) { return a + safeNum(t.maxRisk); }, 0);
  var series       = buildPnlSeries(closed, startSize);

  var loggedWinPcts  = closed.filter(function(t) { return tradeIsWin(t) && t.currentPnlPct !== ''; }).map(function(t) { return safeNum(t.currentPnlPct); });
  var loggedLossPcts = closed.filter(function(t) { return tradeIsLoss(t) && t.currentPnlPct !== ''; }).map(function(t) { return safeNum(t.currentPnlPct); });
  var loggedGrossWin  = closed.reduce(function(a, t) { var d = tradePnlDollars(t); return d > 0 ? a + d : a; }, 0);
  var loggedGrossLoss = Math.abs(closed.reduce(function(a, t) { var d = tradePnlDollars(t); return d < 0 ? a + d : a; }, 0));

  var avgWin = hasStat(hist.avgWinPct) && !loggedWinPcts.length
    ? safeNum(hist.avgWinPct)
    : loggedWinPcts.length ? loggedWinPcts.reduce(function(a,b){return a+b;},0)/loggedWinPcts.length : null;
  var avgLoss = hasStat(hist.avgLossPct) && !loggedLossPcts.length
    ? safeNum(hist.avgLossPct)
    : loggedLossPcts.length ? loggedLossPcts.reduce(function(a,b){return a+b;},0)/loggedLossPcts.length : null;
  var pf = hasStat(hist.profitFactor) && !closed.length
    ? safeNum(hist.profitFactor).toFixed(2)
    : loggedGrossLoss > 0 ? (loggedGrossWin/loggedGrossLoss).toFixed(2)
    : loggedGrossWin > 0 ? '∞' : '—';

  prefs.accountSize = Math.round(currentEquity);

  var html = '<div class="fadeup">' +
    g2html([
      mc2('Account / Collateral',
        '$' + currentEquity.toFixed(0) + ' equity<br><span style="font-size:10px;color:var(--yellow)">$' + colInUse.toFixed(0) + ' used</span>',
        currentEquity >= startSize ? 'var(--green)' : 'var(--red)'),
      mc2('Trades',
        nTotal + ' closed<br><span style="font-size:10px;color:var(--blue2)">' + open.length + ' open</span>',
        'var(--text)'),
      mc2('Win / Loss',
        nWins + ' / ' + nLosses + '<br><span style="font-size:10px;color:' + wrc + '">' + wr + '% win rate</span>',
        wrc),
      mc2('P/L / Return',
        (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(0) +
        '<br><span style="font-size:10px;color:' + (retPct >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
        (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%</span>',
        totalPnl >= 0 ? 'var(--green)' : 'var(--red)')
    ]) +
    g3html([
      mc2('Avg Winner',    avgWin  === null ? '—' : statPct(avgWin),        'var(--green)'),
      mc2('Avg Loser',     avgLoss === null ? '—' : statPct(avgLoss,'loss'), 'var(--red)'),
      mc2('Profit Factor', pf, pf === '—' ? 'var(--text3)' : 'var(--green)')
    ]) +
    renderPnlCurve(series, startSize);

  if (nTotal === 0) {
    html += '<div class="card"><div style="font-size:12px;color:var(--text2);line-height:1.6">No closed trades yet. Set a starting account size in Settings, then closed trades will build the P/L curve here.</div></div>';
  }

  // ── Trade log ──────────────────────────────────────────────────────────────
  html += '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Trade Log</div>' +
    '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:700;color:var(--blue2);margin-right:7px">BASELINE</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + safeNum(hist.totalTrades) + ' trades before this log</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' +
          (hasStat(hist.winPct) ? safeNum(hist.winPct).toFixed(1) + '% win rate' : 'Win rate pending') +
          ' &bull; ' + (hasStat(hist.profitFactor) ? safeNum(hist.profitFactor).toFixed(2) : '—') + ' profit factor' +
        '</div>' +
      '</div>' +
      '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:' +
        (safeNum(hist.realizedPnl) >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
        (safeNum(hist.realizedPnl) >= 0 ? '+' : '') + '$' + safeNum(hist.realizedPnl).toFixed(0) +
      '</span>' +
    '</div>';

  closed.slice().sort(function(a,b){ return closedTradeDate(b)-closedTradeDate(a); }).forEach(function(t) {
    var dollars = tradePnlDollars(t);
    var crCol   = dollars >= 0 ? 'var(--green)' : 'var(--red)';
    html += '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:600;color:var(--text2);margin-right:7px">' + t.ticker + '</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + t.strategy + '</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' +
          closedTradeDate(t).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) +
          ' &bull; ' + (t.closeReason || 'CLOSED') +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + crCol + '">' +
          (dollars >= 0 ? '+' : '') + '$' + dollars.toFixed(0) +
        '</div>' +
        '<div style="font-size:10px;color:var(--text3)">' +
          (safeNum(t.currentPnlPct) >= 0 ? '+' : '') + safeNum(t.currentPnlPct) + '%' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';

  // ── Import Baseline (collapsible) ─────────────────────────────────────────
  html += '<div class="card">' +
    '<button onclick="statsBaselineOpen=!statsBaselineOpen;renderStats()" ' +
      'style="width:100%;background:transparent;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:0;color:var(--text3);font-family:var(--sans);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">' +
      '<span>Import Baseline</span><span style="font-size:14px">' + (statsBaselineOpen ? '▲' : '▼') + '</span>' +
    '</button>';

  if (statsBaselineOpen) {
    html += '<div style="margin-top:12px">' +
      '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:10px">Use this for trading history before OptionsPlus. Leave optional fields blank; they will fill in once closed trades are logged.</div>' +
      '<div class="fg3">' +
        '<div class="fld"><label>Total trades</label><input id="hist-total"  type="number" value="' + safeNum(hist.totalTrades) + '" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>Wins</label>        <input id="hist-wins"   type="number" value="' + safeNum(hist.wins)        + '" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>Losses</label>      <input id="hist-losses" type="number" value="' + safeNum(hist.losses)      + '" style="font-family:var(--mono)"></div>' +
      '</div>' +
      '<div class="fg3">' +
        '<div class="fld"><label>Baseline P/L $</label><input id="hist-pnl"      type="number" value="' + safeNum(hist.realizedPnl) + '" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>Avg winner %</label>  <input id="hist-avg-win"  type="number" step="0.01" value="' + (hasStat(hist.avgWinPct)  ? safeNum(hist.avgWinPct)  : '') + '" placeholder="Optional" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>Avg loser %</label>   <input id="hist-avg-loss" type="number" step="0.01" value="' + (hasStat(hist.avgLossPct) ? safeNum(hist.avgLossPct) : '') + '" placeholder="Optional" style="font-family:var(--mono)"></div>' +
      '</div>' +
      '<div class="fg3">' +
        '<div class="fld"><label>Profit factor</label>  <input id="hist-pf"           type="number" step="0.01" value="' + (hasStat(hist.profitFactor) ? safeNum(hist.profitFactor) : '') + '" placeholder="Optional" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>History length</label> <input id="hist-period-value" type="number" min="1"     value="' + (parseInt(hist.baselinePeriodValue,10)||1) + '" style="font-family:var(--mono)"></div>' +
        '<div class="fld"><label>Unit</label><select id="hist-period-unit">' +
          '<option value="weeks"' + (hist.baselinePeriodUnit==='weeks'?' selected':'') + '>Weeks</option>' +
          '<option value="years"' + (hist.baselinePeriodUnit!=='weeks'?' selected':'') + '>Years</option>' +
        '</select></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-w" onclick="saveBaselineImport()">Save Baseline</button>' +
    '</div>';
  }

  html += '</div></div>';
  el.innerHTML = html;
}

function inputOptionalNumber(id) {
  var el = $(id);
  if (!el || el.value.trim() === '') return null;
  return safeNum(el.value, null);
}

function saveBaselineImport() {
  var wins    = safeNum($('hist-wins')   && $('hist-wins').value);
  var losses  = safeNum($('hist-losses') && $('hist-losses').value);
  var total   = safeNum($('hist-total')  && $('hist-total').value);
  var counted = wins + losses;
  if (!total && counted) total = counted;
  hist = {
    ...hist,
    totalTrades:         total,
    wins:                wins,
    losses:              losses,
    breakeven:           Math.max(0, total - counted),
    realizedPnl:         safeNum($('hist-pnl') && $('hist-pnl').value),
    winPct:              total > 0 ? parseFloat((wins/total*100).toFixed(1)) : null,
    avgWinPct:           inputOptionalNumber('hist-avg-win'),
    avgLossPct:          inputOptionalNumber('hist-avg-loss'),
    profitFactor:        inputOptionalNumber('hist-pf'),
    baselinePeriodValue: Math.max(1, parseInt(($('hist-period-value') && $('hist-period-value').value)||'1',10)),
    baselinePeriodUnit:  (($('hist-period-unit') && $('hist-period-unit').value)||'years')
  };
  saveHist();
  renderStats();
  toast('Baseline saved');
}
