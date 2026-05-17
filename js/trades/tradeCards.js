// =============================================================================
// js/trades/tradeCards.js -- Trade card rendering
// =============================================================================

var expandedTradeCards = {};

function jsArg(v) {
  return '\'' + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'';
}

function renderOpenTradeCard(t) {
  var legs       = t.legs || [];
  var dte        = t.currentDTE;
  var lp         = livePrices[t.ticker];
  var curPx      = (lp && lp.price) || safeNum(t.stockAtOpen);
  var priceLabel = lp ? ('$' + curPx + ' live') : (t.stockAtOpen ? '$' + t.stockAtOpen + ' open' : null);
  var track = tradeTracking(t, curPx, !!lp);
  var assess = track.status;
  var pnl     = safeNum(t.currentPnlPct);
  var sector  = TICKER_SECTOR[t.ticker] || null;
  var tags    = t.tags || [];
  var expanded = !!expandedTradeCards[t.id];

  return '<div class="tc ' + assess.cls + '" style="' + (!expanded ? 'padding:0;overflow:hidden' : '') + '">' +
    '<div onclick="toggleTradeDetails(' + jsArg(t.id) + ')" role="button" tabindex="0" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleTradeDetails(' + jsArg(t.id) + ')}" ' +
      'style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:' + (expanded ? '0 0 10px' : '12px 13px') + ';cursor:pointer;margin-bottom:' + (expanded ? '9px' : '0') + '">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:2px;min-width:0;flex-wrap:wrap">' +
          '<span style="font-family:var(--mono);font-size:16px;font-weight:700">' + esc(t.ticker) + '</span>' +
          '<span style="font-size:9px;color:var(--text3);font-family:var(--mono)">' + (dte !== undefined ? dte + 'DTE' : '') + '</span>' +
          '<span class="badge" style="background:' + assess.color + '15;border:1px solid ' + assess.color + '25;color:' + assess.color + ';font-size:9px">' + assess.label + '</span>' +
          (sector ? '<span style="font-size:9px;color:var(--text3)">' + sector + '</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.strategy) + (t.expDate ? ' &middot; Exp ' + esc(t.expDate) : '') + '</div>' +
      '</div>' +
      '<div style="text-align:right;display:flex;align-items:center;gap:10px;flex-shrink:0">' +
        '<div>' +
        '<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:' + assess.color + '">' + fmtSignedPct(track.value) + '</div>' +
        '<div style="font-size:9px;color:var(--text3)">' + track.label.toLowerCase() + (lp ? ' live' : '') + '</div>' +
        '<div style="font-size:10px;color:var(--text2);font-family:var(--mono)">' + trackingLineLabel(track.line) + '</div>' +
        '</div>' +
        '<div style="font-size:16px;color:var(--text3);line-height:1">' + (expanded ? '&#9650;' : '&#9660;') + '</div>' +
      '</div>' +
    '</div>' +
    (expanded ? (
    '<div style="margin-bottom:9px;display:flex;flex-wrap:wrap">' +
      legs.map(function(l) {
        return '<span class="lb ' + (l.a === 'SELL' ? 'lb-sell' : 'lb-buy') + '">' + l.a + ' ' + l.n + '&times; $' + l.s + ' ' + l.t + '</span>';
      }).join('') +
    '</div>' +
    renderOpenTradeDetails(t, priceLabel, lp, track) +
    (tags.length > 0
      ? '<div style="margin-bottom:8px">' +
          tags.map(function(tg) {
            return '<span style="display:inline-flex;padding:2px 7px;border-radius:5px;font-size:9px;background:var(--blue-dim);border:1px solid rgba(99,102,241,.2);color:var(--blue2);font-family:var(--mono);margin:0 3px 3px 0">' + esc(tg) + '</span>';
          }).join('') +
        '</div>'
      : '') +
    (t.notes
      ? '<div style="font-size:11px;color:var(--text2);margin-bottom:8px;padding:7px 10px;background:var(--surface2);border-radius:7px;border:1px solid var(--border)">' + esc(t.notes) + '</div>'
      : '') +
    (t.exitSignal
      ? '<div style="padding:7px 10px;background:var(--red-dim);border-radius:7px;font-size:11px;color:var(--red);margin-bottom:8px;border:1px solid rgba(239,68,68,.2)">&#9889; Exit if ' + t.ticker + ' breaks $' + t.exitSignal + '</div>'
      : '') +
    '<div style="display:flex;gap:5px">' +
      '<input type="number" placeholder="P&L %" value="' + (t.currentPnlPct || '') + '" onblur="updPnl(' + jsArg(t.id) + ',this.value)" style="flex:1;font-family:var(--mono);font-size:13px;color:' + (pnl >= 40 ? 'var(--green)' : pnl < -15 ? 'var(--red)' : 'var(--text)') + '">' +
      '<button onclick="closeT(' + jsArg(t.id) + ',\'PROFIT\')" class="btn btn-success btn-sm">&#10003; Win</button>' +
      '<button onclick="closeT(' + jsArg(t.id) + ',\'STOP\')"   class="btn btn-danger btn-sm">&#10007; Loss</button>' +
      '<button onclick="delT('  + jsArg(t.id) + ')"             class="btn btn-ghost btn-sm" style="color:var(--red);border-color:rgba(239,68,68,.3)">&#128465;</button>' +
    '</div>') : '') +
  '</div>';
}

function closedTradesHtml(closed) {
  if (closed.length === 0) return '';
  var strategies = [];
  closed.forEach(function(t) {
    if (t.strategy && strategies.indexOf(t.strategy) === -1) strategies.push(t.strategy);
  });
  strategies.sort();
  if (tradesTab !== 'All' && strategies.indexOf(tradesTab) === -1) tradesTab = 'All';

  var html = '<div style="display:flex;overflow-x:auto;gap:0;border-bottom:1px solid var(--border);margin:12px 12px 0;scrollbar-width:none">';
  ['All'].concat(strategies).forEach(function(s) {
    var isActive = tradesTab === s;
    var count = s === 'All' ? closed.length : closed.filter(function(t){ return t.strategy === s; }).length;
    html += '<button onclick="tradesTab=\'' + s.replace(/'/g,"\\'") + '\';tradesExpanded=false;renderTrades()" ' +
      'style="flex-shrink:0;padding:7px 13px;background:transparent;border:none;border-bottom:2px solid ' +
      (isActive ? 'var(--blue2)' : 'transparent') +
      ';color:' + (isActive ? 'var(--blue2)' : 'var(--text3)') +
      ';font-family:var(--sans);font-size:11px;font-weight:' + (isActive ? '600' : '500') +
      ';cursor:pointer;white-space:nowrap">' +
      s + ' <span style="opacity:.6">(' + count + ')</span>' +
    '</button>';
  });
  html += '</div>';

  var tabClosed = tradesTab === 'All'
    ? closed.slice()
    : closed.filter(function(t) { return t.strategy === tradesTab; });

  tabClosed.sort(function(a, b) {
    var da = new Date((a.closeDate || a.closed_at || a.openDate || '') + 'T12:00:00');
    var db = new Date((b.closeDate || b.closed_at || b.openDate || '') + 'T12:00:00');
    return db - da;
  });

  var SHOW_LIMIT = 5;
  var visible = tradesExpanded ? tabClosed : tabClosed.slice(0, SHOW_LIMIT);
  visible.forEach(function(t) { html += closedRow(t); });

  if (tabClosed.length > SHOW_LIMIT) {
    if (!tradesExpanded) {
      html += '<button class="btn btn-ghost btn-w" style="margin:4px 12px 8px;width:calc(100% - 24px)" onclick="tradesExpanded=true;renderTrades()">&#9660; Show all ' + tabClosed.length + ' trades</button>';
    } else {
      html += '<button class="btn btn-ghost btn-w" style="margin:4px 12px 8px;width:calc(100% - 24px)" onclick="tradesExpanded=false;renderTrades()">&#9650; Show less</button>';
    }
  }
  return html;
}
function toggleTradeDetails(id) {
  expandedTradeCards[id] = !expandedTradeCards[id];
  renderTrades();
}

function renderTradePayoffShape(t) {
  var a = tradeAnalysis(t);
  if (!a.payoff || !a.payoff.points || !a.payoff.points.length) return '';
  var points = a.payoff.points;
  var low = safeNum(a.payoff.low, points[0].px);
  var high = safeNum(a.payoff.high, points[points.length - 1].px);
  var minY = Math.min.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  var maxY = Math.max.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  if (minY === maxY) { minY -= 100; maxY += 100; }
  if (low === high) { low -= 1; high += 1; }
  var w = 360, h = 92, pad = 12;
  function x(p) { return pad + (p.px - low) / (high - low) * (w - pad * 2); }
  function y(v) { return h - pad - (v - minY) / (maxY - minY) * (h - pad * 2); }
  var line = points.map(function(p) { return x(p).toFixed(1) + ',' + y(p.pnl).toFixed(1); }).join(' ');
  var zeroY = y(0);
  return '<details class="card" style="padding:10px 12px;margin-bottom:10px">' +
    '<summary style="cursor:pointer;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Entry payoff shape</summary>' +
    '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:112px;display:block;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-top:9px">' +
      '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
      '<polyline points="' + line + '" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:5px"><span>$' + low.toFixed(0) + '</span><span>$' + high.toFixed(0) + '</span></div>' +
  '</details>';
}

function renderOpenTradeDetails(t, priceLabel, lp, track) {
  var a = tradeAnalysis(t);
  var signal = a.signal || '';
  var issues = a.issues || [];
  var maxProfit = a.maxProfitUnlimited ? 'Unlimited' : fmtTradeMoney(a.maxProfit, false);
  var maxLoss = a.maxLossUnlimited ? 'Unlimited' : fmtTradeMoney(a.maxLoss ?? t.maxRisk, false);
  var entryTone = t.entryType === 'debit' ? 'var(--red)' : 'var(--green)';
  var entryLabel = t.entryType === 'debit' ? 'Debit/shr' : 'Credit/shr';
  var detail = g3html([
    mc2('Stock', priceLabel || 'N/A', lp ? 'var(--green)' : 'var(--text)'),
    mc2(entryLabel, '$' + (t.creditReceived || '?'), entryTone),
    mc2('Max Risk', maxLoss, 'var(--red)')
  ]);
  detail += g3html([
    mc2('Breakeven', t.breakeven != null ? '$' + safeNum(t.breakeven).toFixed(2) : 'N/A', 'var(--text)'),
    mc2('Max Profit', maxProfit, 'var(--green)'),
    mc2('Entry Signal', signal || 'N/A', signal === 'GO' ? 'var(--green)' : signal === 'NO-GO' ? 'var(--red)' : 'var(--yellow)')
  ]);
  detail += '<div style="font-size:11px;color:var(--text2);line-height:1.45;margin:-2px 0 10px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">' +
    '<div style="color:var(--text);margin-bottom:3px">Tracking stock price against the trade risk line, not broker spread marks.</div>' +
    esc(track.context) +
  '</div>';
  if (issues.length) {
    detail += '<div style="display:grid;gap:5px;margin-bottom:10px">' +
      issues.slice(0, 3).map(function(i) {
        var col = i.level === 'critical' ? 'var(--red)' : i.level === 'warning' ? 'var(--yellow)' : 'var(--text2)';
        return '<div style="font-size:10px;color:' + col + ';line-height:1.4">' + esc(i.msg) + '</div>';
      }).join('') +
    '</div>';
  }
  detail += renderTradePayoffShape(t);
  return detail;
}

// ---------------------------------------------------------------------------
// Closed trade row
// ---------------------------------------------------------------------------
function closedRow(t) {
  var pnl        = safeNum(t.currentPnlPct);
  var isAssigned = t.closeReason === 'ASSIGNED';
  var crCol      = isAssigned ? 'var(--yellow)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  return '<div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:9px;margin:0 12px 6px;opacity:.8">' +
    '<div style="flex:1">' +
      '<span style="font-family:var(--mono);font-weight:600;color:var(--text2);margin-right:7px">' + esc(t.ticker) + '</span>' +
      '<span style="font-size:10px;color:var(--text3)">' + esc(t.strategy) + '</span>' +
      (t.expDate ? '<div style="font-size:10px;color:var(--text3);margin-top:1px">' + esc(t.expDate) + '</div>' : '') +
    '</div>' +
    '<div style="display:flex;gap:7px;align-items:center">' +
      '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + crCol + '">' + (pnl > 0 ? '+' : '') + pnl + '%</span>' +
      '<span class="chip" style="background:' + crCol + '15;color:' + crCol + ';font-size:9px">' + (t.closeReason || 'CLOSED') + '</span>' +
      '<button onclick="delT(' + jsArg(t.id) + ')" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px">&#10005;</button>' +
    '</div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Strategy pill selector (for log form)
// ---------------------------------------------------------------------------
