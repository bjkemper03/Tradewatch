// =============================================================================
// js/pages/stats.js -- Performance stats page
// Depends on: trades, hist, prefs, safeNum(), mc2(), g2html(), g3html(),
//             saveHist(), toast(), renderStats() called by showPage()
// =============================================================================

function renderStats() {
  var el = $('page-stats');
  if (!el) return;

  var closed   = trades.filter(function(t) { return t.status === 'CLOSED' && t.currentPnlPct !== ''; });
  var open     = trades.filter(function(t) { return t.status === 'OPEN'; });
  var nw       = closed.filter(function(t) { return safeNum(t.currentPnlPct) > 0; }).length;
  var nTotal   = hist.totalTrades + closed.length;
  var nWins    = hist.wins + nw;
  var totalPnl = hist.realizedPnl + closed.reduce(function(acc, t) {
    var cr = safeNum(t.creditReceived);
    return acc + (cr * 100 * safeNum(t.currentPnlPct) / 100);
  }, 0);
  var wr      = nTotal > 0 ? ((nWins / nTotal) * 100).toFixed(1) : hist.winPct.toFixed(1);
  var wrc     = parseFloat(wr) > 70 ? 'var(--green)' : parseFloat(wr) > 55 ? 'var(--yellow)' : 'var(--red)';
  var colInUse = open.reduce(function(a, t) { return a + safeNum(t.maxRisk); }, 0);

  // ── Top stat tiles ────────────────────────────────────────────────────────
  var html = '<div class="fadeup">' +
    g3html([
      '<div class="tile"><div class="tile-label">Win Rate</div><div class="tile-value" style="color:' + wrc + '">' + wr + '%</div></div>',
      '<div class="tile"><div class="tile-label">Trades</div><div class="tile-value">' + nTotal + '</div></div>',
      '<div class="tile"><div class="tile-label">P&amp;L</div><div class="tile-value" style="color:var(--green);font-size:14px">$' + totalPnl.toFixed(0) + '</div></div>'
    ]) +
    g2html([
      mc2('Wins / Losses', nWins + ' / ' + (nTotal - nWins), nWins > nTotal - nWins ? 'var(--green)' : 'var(--yellow)'),
      mc2('Profit Factor',  hist.profitFactor.toFixed(2), 'var(--green)'),
      mc2('Avg Win',        '+' + hist.avgWinPct + '%',   'var(--green)'),
      mc2('Avg Loss',       hist.avgLossPct + '%',         'var(--red)'),
      mc2('Open Now',       open.length,                   'var(--blue2)'),
      mc2('Collateral Used','$' + colInUse.toFixed(0),    'var(--yellow)')
    ]);

  // ── Trade log ─────────────────────────────────────────────────────────────
  html += '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Trade Log</div>' +
    '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:700;color:var(--blue2);margin-right:7px">BASELINE</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + hist.totalTrades + ' trades pre-OptionsPlus</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + hist.winPct + '% win rate &bull; ' + hist.profitFactor + ' profit factor</div>' +
      '</div>' +
      '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--green)">+$' + hist.realizedPnl + '</span>' +
    '</div>';

  var allTrades = closed.concat(open).sort(function(a, b) { return b.id - a.id; });
  allTrades.forEach(function(t) {
    var pnl    = safeNum(t.currentPnlPct);
    var isOpen = t.status === 'OPEN';
    var cr     = safeNum(t.creditReceived);
    var dp     = isOpen ? null : (cr * 100 * pnl / 100);
    var crCol  = pnl > 0 ? 'var(--green)' : 'var(--red)';
    html += '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<span style="font-family:var(--mono);font-weight:600;' + (isOpen ? 'color:var(--text)' : 'color:var(--text2)') + ';margin-right:7px">' + t.ticker + '</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + t.strategy + '</span>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + (t.expDate || '') + ' ' +
          (isOpen
            ? '&bull; <span style="color:var(--blue2)">OPEN</span>'
            : '&bull; ' + (t.closeReason || 'CLOSED')) +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        (isOpen
          ? '<span class="badge" style="background:var(--blue-dim);border:1px solid rgba(99,102,241,.25);color:var(--blue2);font-size:9px">OPEN</span>'
          : '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + crCol + '">' + (pnl > 0 ? '+' : '') + pnl + '%</div>' +
            (dp !== null ? '<div style="font-size:10px;color:var(--text3)">$' + dp.toFixed(0) + '</div>' : '')) +
      '</div>' +
    '</div>';
  });
  html += '</div>';

  // ── By strategy breakdown ─────────────────────────────────────────────────
  if (closed.length > 0) {
    var byS = {};
    closed.forEach(function(t) {
      var k    = t.strategy || 'UNKNOWN';
      var cr   = safeNum(t.creditReceived);
      var col2 = safeNum(t.maxRisk) || 100;
      var pnl  = safeNum(t.currentPnlPct);
      var roc  = (cr * 100 * pnl / 100) / col2 * 100;
      var legs = t.legs || [];
      var sell = legs.find(function(l) { return l.a === 'SELL'; });
      var buy  = legs.find(function(l) { return l.a === 'BUY'; });
      var w    = (sell && buy) ? Math.abs(safeNum(sell.s) - safeNum(buy.s)) : 0;
      if (!byS[k]) byS[k] = { wins:0, losses:0, roc:0, count:0, widths:[], cols:[] };
      if (pnl > 0) byS[k].wins++; else byS[k].losses++;
      byS[k].roc += roc;
      byS[k].count++;
      if (w > 0)    byS[k].widths.push(w);
      if (col2 > 0) byS[k].cols.push(col2);
    });

    html += '<div class="card"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">By Strategy</div>';
    Object.keys(byS).forEach(function(s) {
      var d   = byS[s];
      var wr2 = ((d.wins / d.count) * 100).toFixed(0);
      var ar  = (d.roc / d.count).toFixed(1);
      var aw  = d.widths.length ? (d.widths.reduce(function(a,b){return a+b;},0) / d.widths.length).toFixed(1) : 'N/A';
      var ac  = d.cols.length   ? (d.cols.reduce(function(a,b){return a+b;},0)   / d.cols.length).toFixed(0)   : 'N/A';
      var wc  = parseInt(wr2) >= 65 ? 'var(--green)' : 'var(--yellow)';
      html += '<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<span style="font-size:12px;font-weight:600">' + s + '</span>' +
          '<div style="display:flex;gap:5px">' +
            '<span class="chip" style="background:' + wc + '15;color:' + wc + ';font-size:9px">' + wr2 + '% Win</span>' +
            '<span class="chip" style="background:var(--surface3);color:var(--text3);font-size:9px">' + d.count + '&times;</span>' +
          '</div>' +
        '</div>' +
        g3html([
          mc2('Avg Width',      aw !== 'N/A' ? '$' + aw : 'N/A', 'var(--text)'),
          mc2('Avg Collateral', ac !== 'N/A' ? '$' + ac : 'N/A', 'var(--text)'),
          mc2('Avg ROC', (parseFloat(ar) > 0 ? '+' : '') + ar + '%', parseFloat(ar) > 0 ? 'var(--green)' : 'var(--red)')
        ]) +
        '<div style="height:3px;background:var(--surface3);border-radius:2px;margin-top:7px">' +
          '<div style="height:100%;width:' + wr2 + '%;background:' + wc + ';border-radius:2px"></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  // ── Historical baseline ───────────────────────────────────────────────────
  html += '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Historical Baseline</div>' +
    '<div style="font-size:12px;color:var(--text2);line-height:1.7;margin-bottom:10px">' +
      hist.totalTrades + ' trades &bull; ' + hist.winPct + '% win rate &bull; $' + hist.realizedPnl + ' P&amp;L &bull; ' + hist.profitFactor + ' profit factor<br>' +
      'Avg winner: +' + hist.avgWinPct + '% &bull; Avg loser: ' + hist.avgLossPct + '%' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" onclick="editHist()">Edit Numbers</button>' +
  '</div></div>';

  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Edit historical baseline via prompt
// ---------------------------------------------------------------------------
function editHist() {
  var inp = prompt(
    'Edit baseline:\ntotalTrades,wins,losses,realizedPnl,winPct,avgWinPct,avgLossPct,profitFactor\nCurrent: ' +
    hist.totalTrades + ',' + hist.wins + ',' + hist.losses + ',' + hist.realizedPnl + ',' +
    hist.winPct + ',' + hist.avgWinPct + ',' + hist.avgLossPct + ',' + hist.profitFactor
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
