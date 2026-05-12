// =============================================================================
// js/pages/stats.js -- Performance stats page
// Depends on: trades, hist, prefs, safeNum(), mc2(), g2html(), g3html(),
//             saveHist(), toast(), renderStats() called by showPage()
// =============================================================================

var statsRange = 'ALL';
var statsCurvePoints = [];

function tradePnlDollars(t) {
  var cr = safeNum(t.creditReceived || t.credit || 0);
  var pct = safeNum(t.currentPnlPct || t.realizedPnlPct || 0);
  var contracts = safeNum(t.contracts || 0);
  if (!contracts) {
    var legs = t.legs || [];
    contracts = legs.reduce(function(max, leg) {
      return Math.max(max, safeNum(leg.n || 1));
    }, 1);
  }
  if (t.realizedPnl != null) return safeNum(t.realizedPnl);
  return cr * 100 * contracts * pct / 100;
}

function rangeStartFor(key, endDate) {
  if (key === 'ALL') return null;
  var days = { '1D':1, '5D':5, '1M':30, '3M':90, '1Y':365, '5Y':1825 }[key] || 0;
  return new Date(endDate.getTime() - days * 86400000);
}

function closedTradeDate(t) {
  return new Date((t.closeDate || t.closed_at || t.openDate || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
}

function buildPnlSeries(closed, startSize) {
  var now = new Date();
  var sorted = closed.slice().sort(function(a, b) { return closedTradeDate(a) - closedTradeDate(b); });
  var firstTradeDate = sorted.length ? closedTradeDate(sorted[0]) : now;
  var rangeStart = rangeStartFor(statsRange, now);
  var chartStart = rangeStart || new Date(Math.min(
    firstTradeDate.getTime(),
    now.getTime() - 30 * 86400000
  ));
  var baselineEnd = sorted.length ? firstTradeDate : now;
  if (baselineEnd < chartStart) baselineEnd = chartStart;

  var pts = [
    { date: chartStart, pnl: 0, label: 'Start' },
    { date: baselineEnd, pnl: safeNum(hist.realizedPnl), label: 'Baseline' }
  ];

  var running = safeNum(hist.realizedPnl);
  sorted.forEach(function(t) {
    var d = closedTradeDate(t);
    var dollars = tradePnlDollars(t);
    running += dollars;
    if (!rangeStart || d >= rangeStart) {
      pts.push({
        date: d,
        pnl: running,
        label: (t.ticker || 'Trade') + ' ' + (dollars >= 0 ? '+' : '') + '$' + dollars.toFixed(0)
      });
    }
  });

  if (!pts.length || pts[pts.length - 1].date < now) {
    pts.push({ date: now, pnl: running, label: 'Current' });
  }

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
  var xs = points.map(function(p) { return p.date.getTime(); });
  var ys = points.map(function(p) { return p.pnl; });
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
  var line = points.map(function(p) { return x(p).toFixed(1) + ',' + y(p).toFixed(1); }).join(' ');
  var zeroY = h - pad - ((0 - minY) / (maxY - minY)) * (h - pad * 2);

  statsCurvePoints = points.map(function(p) {
    return {
      x: x(p), y: y(p), pnl: p.pnl, equity: p.equity, retPct: p.retPct,
      date: p.date.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }),
      label: p.label
    };
  });

  return '<div class="card stats-chart-card">' +
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px">' +
      '<div>' +
        '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Closed Trade P/L Curve</div>' +
        '<div style="font-size:11px;color:var(--text3)">Return is anchored to starting account: $' + startSize.toFixed(0) + '</div>' +
      '</div>' +
      '<div class="stats-range">' +
        ['1D','5D','1M','3M','1Y','5Y','ALL'].map(function(r) {
          return '<button class="' + (statsRange === r ? 'active' : '') + '" onclick="statsRange=\'' + r + '\';renderStats()">' + r + '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="stats-chart-wrap" onmousemove="statsChartMove(event)" onmouseleave="statsChartLeave()">' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
        '<polyline points="' + line + '" fill="none" stroke="var(--blue2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
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
  var relX = e.clientX - rect.left;
  var svgX = relX / rect.width * 720;
  var nearest = statsCurvePoints.reduce(function(best, p) {
    return Math.abs(p.x - svgX) < Math.abs(best.x - svgX) ? p : best;
  }, statsCurvePoints[0]);
  var tip = $('stats-tip');
  if (!tip) return;
  tip.style.display = 'block';
  tip.style.left = Math.min(Math.max((nearest.x / 720 * rect.width), 90), rect.width - 90) + 'px';
  tip.style.top = Math.max((nearest.y / 260 * rect.height) - 6, 18) + 'px';
  tip.innerHTML = '<div style="font-weight:700;color:var(--text)">' + nearest.date + '</div>' +
    '<div style="color:' + (nearest.pnl >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
      (nearest.pnl >= 0 ? '+' : '') + '$' + nearest.pnl.toFixed(0) + ' / ' + (nearest.retPct >= 0 ? '+' : '') + nearest.retPct.toFixed(1) + '%' +
    '</div>' +
    '<div style="color:var(--text3)">Equity $' + nearest.equity.toFixed(0) + '</div>';
}

function statsChartLeave() {
  var tip = $('stats-tip');
  if (tip) tip.style.display = 'none';
}

function renderStats() {
  var el = $('page-stats');
  if (!el) return;

  var closed = trades.filter(function(t) { return t.status === 'CLOSED' && t.currentPnlPct !== ''; });
  var open = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closedWins = closed.filter(function(t) { return tradePnlDollars(t) > 0; }).length;
  var nTotal = safeNum(hist.totalTrades) + closed.length;
  var nWins = safeNum(hist.wins) + closedWins;
  var closedPnl = closed.reduce(function(acc, t) { return acc + tradePnlDollars(t); }, 0);
  var totalPnl = safeNum(hist.realizedPnl) + closedPnl;
  var startSize = safeNum(prefs.startingAccountSize || prefs.accountSize || 10000) || 10000;
  var currentEquity = startSize + totalPnl;
  var retPct = startSize > 0 ? totalPnl / startSize * 100 : 0;
  var wr = nTotal > 0 ? ((nWins / nTotal) * 100).toFixed(1) : '0.0';
  var wrc = parseFloat(wr) > 70 ? 'var(--green)' : parseFloat(wr) > 55 ? 'var(--yellow)' : 'var(--red)';
  var colInUse = open.reduce(function(a, t) { return a + safeNum(t.maxRisk); }, 0);
  var series = buildPnlSeries(closed, startSize);

  prefs.accountSize = Math.round(currentEquity);

  var html = '<div class="fadeup">' +
    g3html([
      '<div class="tile"><div class="tile-label">Win Rate</div><div class="tile-value" style="color:' + wrc + '">' + wr + '%</div></div>',
      '<div class="tile"><div class="tile-label">Closed Trades</div><div class="tile-value">' + nTotal + '</div></div>',
      '<div class="tile"><div class="tile-label">Realized P&amp;L</div><div class="tile-value" style="color:' + (totalPnl >= 0 ? 'var(--green)' : 'var(--red)') + ';font-size:14px">' + (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(0) + '</div></div>'
    ]) +
    g2html([
      mc2('Current Equity', '$' + currentEquity.toFixed(0), currentEquity >= startSize ? 'var(--green)' : 'var(--red)'),
      mc2('Return', (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%', retPct >= 0 ? 'var(--green)' : 'var(--red)'),
      mc2('Open Now', open.length, 'var(--blue2)'),
      mc2('Collateral Used', '$' + colInUse.toFixed(0), 'var(--yellow)')
    ]) +
    renderPnlCurve(series, startSize);

  if (nTotal === 0) {
    html += '<div class="card"><div style="font-size:12px;color:var(--text2);line-height:1.6">No closed trades yet. Set a starting account size in Settings, then closed trades will build the P/L curve here.</div></div>';
  }

  html += '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Trade Log</div>' +
    '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:700;color:var(--blue2);margin-right:7px">BASELINE</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + safeNum(hist.totalTrades) + ' trades before this log</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + safeNum(hist.winPct) + '% win rate &bull; ' + safeNum(hist.profitFactor).toFixed(2) + ' profit factor</div>' +
      '</div>' +
      '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + (safeNum(hist.realizedPnl) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (safeNum(hist.realizedPnl) >= 0 ? '+' : '') + '$' + safeNum(hist.realizedPnl).toFixed(0) + '</span>' +
    '</div>';

  closed.slice().sort(function(a, b) { return closedTradeDate(b) - closedTradeDate(a); }).forEach(function(t) {
    var dollars = tradePnlDollars(t);
    var crCol = dollars >= 0 ? 'var(--green)' : 'var(--red)';
    html += '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:600;color:var(--text2);margin-right:7px">' + t.ticker + '</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + t.strategy + '</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + closedTradeDate(t).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }) + ' &bull; ' + (t.closeReason || 'CLOSED') + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + crCol + '">' + (dollars >= 0 ? '+' : '') + '$' + dollars.toFixed(0) + '</div>' +
        '<div style="font-size:10px;color:var(--text3)">' + (safeNum(t.currentPnlPct) >= 0 ? '+' : '') + safeNum(t.currentPnlPct) + '%</div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';

  html += '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Historical Baseline</div>' +
    '<div style="font-size:12px;color:var(--text2);line-height:1.7;margin-bottom:10px">' +
      safeNum(hist.totalTrades) + ' trades &bull; ' + safeNum(hist.winPct) + '% win rate &bull; $' + safeNum(hist.realizedPnl).toFixed(0) + ' P&amp;L &bull; ' + safeNum(hist.profitFactor).toFixed(2) + ' profit factor<br>' +
      'Avg winner: +' + safeNum(hist.avgWinPct) + '% &bull; Avg loser: ' + safeNum(hist.avgLossPct) + '%' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" onclick="editHist()">Edit Numbers</button>' +
  '</div></div>';

  el.innerHTML = html;
}

function editHist() {
  var inp = prompt(
    'Edit baseline:\ntotalTrades,wins,losses,realizedPnl,winPct,avgWinPct,avgLossPct,profitFactor\nCurrent: ' +
    safeNum(hist.totalTrades) + ',' + safeNum(hist.wins) + ',' + safeNum(hist.losses) + ',' + safeNum(hist.realizedPnl) + ',' +
    safeNum(hist.winPct) + ',' + safeNum(hist.avgWinPct) + ',' + safeNum(hist.avgLossPct) + ',' + safeNum(hist.profitFactor)
  );
  if (!inp) return;
  var p = inp.split(',');
  if (p.length >= 8) {
    hist = {
      totalTrades:  +p[0], wins:         +p[1],
      losses:       +p[2], realizedPnl:  +p[3],
      winPct:       +p[4], avgWinPct:    +p[5],
      avgLossPct:   +p[6], profitFactor: +p[7]
    };
    saveHist();
    renderStats();
    toast('Updated!');
  }
}
