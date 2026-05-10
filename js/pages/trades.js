// =============================================================================
// js/pages/trades.js -- Trades page: log form, open positions, closed trades
// Depends on globals: trades, prefs, formLegData, formStrat, selectedTags,
//   showHistory, livePrices, azResult, DEF, STRAT_GROUPS, TRADE_TAGS,
//   TICKER_SECTOR, safeNum(), calcDTE(), calcCollateral(), assessTrade(),
//   fetchQuote(), saveTrades(), toast(), showPage(), mc2(), g3html()
// =============================================================================

// ---------------------------------------------------------------------------
// Live price loader
// ---------------------------------------------------------------------------
async function loadLivePrices() {
  var tickers = [];
  var seen = {};
  trades.filter(function(t) { return t.status === 'OPEN'; }).forEach(function(t) {
    if (!seen[t.ticker]) { seen[t.ticker] = true; tickers.push(t.ticker); }
  });
  for (var i = 0; i < tickers.length; i++) {
    var p = await fetchQuote(tickers[i]);
    if (p) livePrices[tickers[i]] = p;
    await new Promise(function(r) { setTimeout(r, 500); });
  }
}

// ---------------------------------------------------------------------------
// Main trades page render
// ---------------------------------------------------------------------------
function renderTrades() {
  var el = $('page-trades');
  if (!el) return;

  var today  = new Date();
  var open   = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closed = trades.filter(function(t) { return t.status === 'CLOSED'; });
  var recent = closed.filter(function(t) {
    return !t.closeDate || (today - new Date(t.closeDate)) < 30 * 24 * 60 * 60 * 1000;
  });
  var old = closed.filter(function(t) {
    return t.closeDate && (today - new Date(t.closeDate)) >= 30 * 24 * 60 * 60 * 1000;
  });

  open.forEach(function(t) {
    var d = parseExp(t.expDate);
    if (d) t.currentDTE = Math.max(0, Math.ceil((d - today) / 86400000));
  });

  var hasLive = Object.keys(livePrices).length > 0;

  // ── Header ────────────────────────────────────────────────────────────────
  var html = '<div class="fadeup">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 16px;margin-bottom:10px">' +
      '<div style="font-size:13px;font-weight:600">' + open.length + ' Open Position' + (open.length !== 1 ? 's' : '') + '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="toggleTradeForm()">+ Log Trade</button>' +
    '</div>';

  // ── Log trade form (hidden by default) ────────────────────────────────────
  html += '<div id="tfm" style="display:none"><div class="card" style="margin-bottom:10px">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Strategy</div>' +
    buildStratPills(formStrat) +
    '<div class="fg2" style="margin-top:10px">' +
      '<div class="fld"><label>Ticker</label><input id="tf-tk" placeholder="NVDA" oninput="this.value=this.value.toUpperCase()" style="font-family:var(--mono);font-size:14px;font-weight:600"></div>' +
      '<div class="fld"><label>Stock Price at Open</label><input id="tf-px" placeholder="118.50" type="number" step="0.01" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fld"><label>Option Legs</label></div>' +
    '<div id="lc"></div>' +
    '<button onclick="addLeg()" style="padding:5px 11px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:10px;cursor:pointer;margin-bottom:10px">+ Add Leg</button>' +
    '<div class="fg2">' +
      '<div class="fld"><label>Expiration (5/10/26)</label><input id="tf-exp" placeholder="5/23/26" style="font-family:var(--mono)" oninput="tradeAutoCol()"></div>' +
      '<div class="fld"><label>DTE at Open</label><input id="tf-dte" placeholder="18" type="number" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fg3">' +
      '<div class="fld"><label>Credit/share $</label><input id="tf-cr" placeholder="0.45" type="number" step="0.01" oninput="tradeAutoCol()" style="font-family:var(--mono)"></div>' +
      '<div class="fld"><label>Collateral $ (auto)</label><input id="tf-col" placeholder="Auto" type="number" step="1" style="font-family:var(--mono)"></div>' +
      '<div class="fld"><label>Exit Trigger $</label><input id="tf-exit" placeholder="108" type="number" step="0.01" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fld"><label>Journal Tags</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' +
        TRADE_TAGS.map(function(tag, i) {
          return '<button class="tag" id="ttag-' + i + '" onclick="toggleTag(' + i + ',\'' + tag + '\')" data-tag="' + tag + '">' + tag + '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="fld"><label>Notes</label><input id="tf-notes" placeholder="Delta, context..."></div>' +
    '<button class="btn btn-primary btn-w" onclick="submitTrade()">&rarr; Log Trade</button>' +
  '</div></div>';

  // ── Live price loader prompt ───────────────────────────────────────────────
  if (!hasLive && open.length > 0) {
    html += '<div style="margin:0 12px 8px;padding:9px 12px;background:var(--blue-dim);border:1px solid rgba(99,102,241,.25);border-radius:8px;font-size:11px;color:var(--blue2);cursor:pointer" onclick="loadLivePrices().then(renderTrades)">' +
      '&rarr; Load live prices for open positions</div>';
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (open.length === 0) {
    html += '<div style="text-align:center;color:var(--text3);padding:40px 0;font-size:12px">No open trades &mdash; tap Log Trade to add one</div>';
  }

  // ── Open trade cards ──────────────────────────────────────────────────────
  open.forEach(function(t) {
    var legs   = t.legs || [];
    var dte    = t.currentDTE;
    var dteC   = dte !== undefined ? (dte <= 5 ? 'var(--red)' : dte <= 10 ? 'var(--yellow)' : 'var(--green)') : 'var(--text3)';
    var lp     = livePrices[t.ticker];
    var curPx  = (lp && lp.price) || safeNum(t.stockAtOpen);
    var priceLabel = lp ? ('$' + curPx + ' live') : (t.stockAtOpen ? '$' + t.stockAtOpen + ' open' : null);
    var be     = safeNum(t.breakeven);
    var liveCushion = curPx > 0 && be > 0
      ? parseFloat(((curPx - be) / curPx * 100).toFixed(1))
      : safeNum(t.cushionPct);
    var assess = assessTrade(liveCushion, dte);
    var pnl    = safeNum(t.currentPnlPct);
    var sector = TICKER_SECTOR[t.ticker] || null;
    var tags   = t.tags || [];

    html += '<div class="tc ' + assess.cls + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:9px">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:7px;margin-bottom:2px">' +
            '<span style="font-family:var(--mono);font-size:16px;font-weight:700">' + t.ticker + '</span>' +
            '<span class="badge" style="background:' + assess.color + '15;border:1px solid ' + assess.color + '25;color:' + assess.color + ';font-size:9px">' + assess.label + '</span>' +
            (sector ? '<span style="font-size:9px;color:var(--text3)">' + sector + '</span>' : '') +
          '</div>' +
          '<div style="font-size:10px;color:var(--text3)">' + t.strategy + '</div>' +
          '<div style="font-size:10px;color:var(--text2);margin-top:2px">Exp ' + t.expDate + ' &bull; <span style="color:' + dteC + ';font-weight:600">' + (dte !== undefined ? dte + 'D left' : '?') + '</span></div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:' +
            (liveCushion >= prefs.cushionMin + 2 ? 'var(--green)' : liveCushion >= prefs.cushionMin ? 'var(--yellow)' : 'var(--red)') +
          '">' + liveCushion + '%</div>' +
          '<div style="font-size:9px;color:var(--text3)">cushion' + (lp ? ' live' : '') + '</div>' +
          '<div style="font-size:10px;color:var(--text2);font-family:var(--mono)">BE $' + (t.breakeven || '?') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:9px;display:flex;flex-wrap:wrap">' +
        legs.map(function(l) {
          return '<span class="lb ' + (l.a === 'SELL' ? 'lb-sell' : 'lb-buy') + '">' + l.a + ' ' + l.n + '&times; $' + l.s + ' ' + l.t + '</span>';
        }).join('') +
      '</div>' +
      g3html([
        mc2('Price',       priceLabel || 'N/A', lp ? 'var(--green)' : 'var(--text)'),
        mc2('Credit/shr',  '$' + (t.creditReceived || '?'), 'var(--green)'),
        mc2('Collateral',  '$' + (t.maxRisk || '?'),        'var(--text)')
      ]) +
      (tags.length > 0
        ? '<div style="margin-bottom:8px">' +
            tags.map(function(tg) {
              return '<span style="display:inline-flex;padding:2px 7px;border-radius:5px;font-size:9px;background:var(--blue-dim);border:1px solid rgba(99,102,241,.2);color:var(--blue2);font-family:var(--mono);margin:0 3px 3px 0">' + tg + '</span>';
            }).join('') +
          '</div>'
        : '') +
      (t.notes
        ? '<div style="font-size:11px;color:var(--text2);margin-bottom:8px;padding:7px 10px;background:var(--surface2);border-radius:7px;border:1px solid var(--border)">' + t.notes + '</div>'
        : '') +
      (t.exitSignal
        ? '<div style="padding:7px 10px;background:var(--red-dim);border-radius:7px;font-size:11px;color:var(--red);margin-bottom:8px;border:1px solid rgba(239,68,68,.2)">&#9889; Exit if ' + t.ticker + ' breaks $' + t.exitSignal + '</div>'
        : '') +
      '<div style="display:flex;gap:5px">' +
        '<input type="number" placeholder="P&L %" value="' + (t.currentPnlPct || '') + '" onblur="updPnl(' + t.id + ',this.value)" style="flex:1;font-family:var(--mono);font-size:13px;color:' + (pnl >= 40 ? 'var(--green)' : pnl < -15 ? 'var(--red)' : 'var(--text)') + '">' +
        '<button onclick="closeT(' + t.id + ',\'PROFIT\')" class="btn btn-success btn-sm">&#10003; Win</button>' +
        '<button onclick="closeT(' + t.id + ',\'STOP\')" class="btn btn-danger btn-sm">&#10007; Loss</button>' +
        '<button onclick="delT(' + t.id + ')" class="btn btn-ghost btn-sm" style="color:var(--red);border-color:rgba(239,68,68,.3)">&#128465;</button>' +
      '</div>' +
    '</div>';
  });

  // ── Closed trades ─────────────────────────────────────────────────────────
  if (recent.length > 0) {
    html += '<div class="mhdr">Recently Closed</div>';
    recent.forEach(function(t) { html += closedRow(t); });
  }
  if (old.length > 0) {
    html += '<button class="btn btn-ghost btn-w" style="margin:6px 12px;width:calc(100% - 24px)" onclick="showHistory=!showHistory;renderTrades()">' +
      (showHistory ? '&#9650; Hide' : '&#9660; Show') + ' Older Trades (' + old.length + ')</button>';
    if (showHistory) old.forEach(function(t) { html += closedRow(t); });
  }

  html += '</div>';
  el.innerHTML = html;

  // Re-init leg form after render
  formLegData = DEF[formStrat] ? DEF[formStrat].map(function(l) { return Object.assign({}, l); }) : [{ a:'BUY', t:'PUT', n:1, s:'' }];
  buildLegs();
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
      '<span style="font-family:var(--mono);font-weight:600;color:var(--text2);margin-right:7px">' + t.ticker + '</span>' +
      '<span style="font-size:10px;color:var(--text3)">' + t.strategy + '</span>' +
      (t.expDate ? '<div style="font-size:10px;color:var(--text3);margin-top:1px">' + t.expDate + '</div>' : '') +
    '</div>' +
    '<div style="display:flex;gap:7px;align-items:center">' +
      '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + crCol + '">' + (pnl > 0 ? '+' : '') + pnl + '%</span>' +
      '<span class="chip" style="background:' + crCol + '15;color:' + crCol + ';font-size:9px">' + (t.closeReason || 'CLOSED') + '</span>' +
      '<button onclick="delT(' + t.id + ')" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px">&#10005;</button>' +
    '</div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Strategy pill selector
// ---------------------------------------------------------------------------
function buildStratPills(active) {
  return Object.keys(STRAT_GROUPS).map(function(grp) {
    var strats = STRAT_GROUPS[grp];
    return '<div style="font-size:8px;color:var(--text3);letter-spacing:1px;margin:8px 0 4px">' + grp + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
        strats.map(function(s) {
          return '<button class="sp ' + (s === active ? 'active' : '') + '" onclick="selectStrat(\'' + s + '\')">' + s + '</button>';
        }).join('') +
      '</div>';
  }).join('');
}

function selectStrat(s) {
  formStrat  = s;
  formLegData = (DEF[s] || [{ a:'BUY', t:'PUT', n:1, s:'' }]).map(function(l) { return Object.assign({}, l); });
  document.querySelectorAll('.sp').forEach(function(p) { p.classList.toggle('active', p.textContent === s); });
  buildLegs();
  tradeAutoCol();
}

// ---------------------------------------------------------------------------
// Leg builder -- trade log form
// ---------------------------------------------------------------------------
function buildLegs() {
  var c = $('lc');
  if (!c) return;
  c.innerHTML = formLegData.map(function(leg, i) {
    return '<div class="leg-row ' + (leg.a === 'SELL' ? 'sell' : 'buy-l') + '">' +
      '<select class="leg-action" style="color:' + (leg.a === 'SELL' ? '#ef4444' : '#22c55e') + '" onchange="formLegData[' + i + '].a=this.value;buildLegs();tradeAutoCol()">' +
        '<option ' + (leg.a === 'SELL' ? 'selected' : '') + '>SELL</option>' +
        '<option ' + (leg.a === 'BUY'  ? 'selected' : '') + '>BUY</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.n || 1) + '" min="1" max="20" class="leg-ct" onblur="formLegData[' + i + '].n=parseInt(this.value)||1;tradeAutoCol()">' +
      '<span style="color:var(--text3);font-size:10px">&times;</span>' +
      '<select class="leg-type" onchange="formLegData[' + i + '].t=this.value">' +
        '<option ' + (leg.t === 'PUT'  ? 'selected' : '') + '>PUT</option>' +
        '<option ' + (leg.t === 'CALL' ? 'selected' : '') + '>CALL</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.s || '') + '" placeholder="Strike $" class="strike-input" style="flex:1" ' +
        'oninput="formLegData[' + i + '].s=this.value" onblur="formLegData[' + i + '].s=this.value;tradeAutoCol()">' +
      (formLegData.length > 1
        ? '<button class="leg-x" onclick="formLegData.splice(' + i + ',1);buildLegs();tradeAutoCol()">&times;</button>'
        : '') +
    '</div>';
  }).join('');
}

function tradeAutoCol() {
  var cr  = safeNum($('tf-cr') ? $('tf-cr').value : 0);
  var col = calcCollateral(formStrat, formLegData, cr);
  var el  = $('tf-col');
  if (el) el.value = col > 0 ? col.toFixed(0) : '';
}

function addLeg() {
  formLegData.push({ a:'BUY', t:'PUT', n:1, s:'' });
  buildLegs();
}

// ---------------------------------------------------------------------------
// Form toggle
// ---------------------------------------------------------------------------
function toggleTradeForm() {
  var f    = $('tfm');
  var show = f.style.display === 'none';
  f.style.display = show ? 'block' : 'none';
  if (show) { selectedTags = []; buildLegs(); }
}

// ---------------------------------------------------------------------------
// Tag toggle
// ---------------------------------------------------------------------------
function toggleTag(i, tag) {
  var idx = selectedTags.indexOf(tag);
  if (idx > -1) selectedTags.splice(idx, 1);
  else selectedTags.push(tag);
  var btn = $('ttag-' + i);
  if (btn) btn.classList.toggle('on', selectedTags.includes(tag));
}

// ---------------------------------------------------------------------------
// Submit new trade
// ---------------------------------------------------------------------------
function submitTrade() {
  var ticker = $('tf-tk') ? $('tf-tk').value.trim().toUpperCase() : '';
  if (!ticker) { alert('Enter a ticker'); return; }
  var stock      = safeNum($('tf-px')  ? $('tf-px').value  : 0);
  var credit     = safeNum($('tf-cr')  ? $('tf-cr').value  : 0);
  var collateral = safeNum($('tf-col') ? $('tf-col').value : 0);
  var expRaw     = $('tf-exp')  ? $('tf-exp').value  : '';
  var exitVal    = $('tf-exit') ? $('tf-exit').value : '';
  var notesVal   = $('tf-notes')? $('tf-notes').value: '';
  var dteInput   = $('tf-dte')  ? $('tf-dte').value  : '';
  var shortLeg   = formLegData.find(function(l) { return l.a === 'SELL'; });
  var strike     = safeNum(shortLeg && shortLeg.s);
  var be         = (strike > 0 && credit > 0) ? parseFloat((strike - credit).toFixed(2)) : null;
  var cushionVal = (stock > 0 && be) ? parseFloat(((stock - be) / stock * 100).toFixed(1)) : null;
  var dte        = calcDTE(expRaw);
  var sector     = TICKER_SECTOR[ticker] || null;

  trades.unshift({
    id:             Date.now(),
    ticker:         ticker,
    strategy:       formStrat,
    legs:           formLegData.map(function(l) { return Object.assign({}, l); }),
    expDate:        expRaw,
    dteOpen:        dteInput || (dte != null ? dte.toString() : ''),
    creditReceived: credit.toString(),
    maxRisk:        collateral.toString(),
    stockAtOpen:    stock.toString(),
    exitSignal:     exitVal,
    notes:          notesVal,
    openDate:       new Date().toISOString().slice(0, 10),
    breakeven:      be,
    cushionPct:     cushionVal,
    status:         'OPEN',
    currentPnlPct:  '',
    closeReason:    '',
    tags:           selectedTags.slice(),
    sector:         sector
  });

  saveTrades();
  toast('Trade logged!');
  selectedTags = [];
  renderTrades();
}

// ---------------------------------------------------------------------------
// Trade actions
// ---------------------------------------------------------------------------
function updPnl(id, v) {
  var t = trades.find(function(t) { return t.id === id; });
  if (t) { t.currentPnlPct = v; saveTrades(); }
}

function closeT(id, r) {
  var t = trades.find(function(t) { return t.id === id; });
  if (t) {
    t.status      = 'CLOSED';
    t.closeReason = r;
    t.closeDate   = new Date().toISOString().slice(0, 10);
    saveTrades();
    renderTrades();
    toast(t.ticker + ' closed -- ' + r);
  }
}

function delT(id) {
  if (confirm('Delete this trade?')) {
    trades = trades.filter(function(t) { return t.id !== id; });
    saveTrades();
    renderTrades();
  }
}

// ---------------------------------------------------------------------------
// Log from analysis -- pre-fills trade form from analyze result
// ---------------------------------------------------------------------------
function logFromAnalysis() {
  if (!azResult) return;
  formStrat   = azResult.strategy || 'PUT CREDIT SPREAD';
  formLegData = azResult.legs || DEF[formStrat].map(function(l) { return Object.assign({}, l); });
  showPage('trades');
  setTimeout(function() {
    var f = $('tfm');
    if (f && f.style.display === 'none') f.style.display = 'block';
    setTimeout(function() {
      if ($('tf-tk'))    $('tf-tk').value    = azResult.ticker || '';
      if ($('tf-px'))    $('tf-px').value    = azResult.price    != null ? azResult.price.toFixed(2)    : '';
      if ($('tf-exp'))   $('tf-exp').value   = azResult.exp      || '';
      if ($('tf-cr'))    $('tf-cr').value    = azResult.credit   != null ? azResult.credit.toString()   : '';
      if ($('tf-col'))   $('tf-col').value   = azResult.collateral != null ? azResult.collateral.toFixed(0) : '';
      if ($('tf-exit'))  $('tf-exit').value  = azResult.exitSignal != null ? azResult.exitSignal.toString() : '';
      if ($('tf-notes')) $('tf-notes').value =
        'Delta:' + (azResult.absDelta != null ? azResult.absDelta.toFixed(3) : '?') +
        '(' + azResult.deltaSource + ') HV30:' + ((azResult.hv30 || 0) * 100).toFixed(1) + '%' +
        (azResult.earningsRisk ? ' \u26a0 Earnings:' + azResult.earningsDate : '');
      buildLegs();
    }, 80);
  }, 150);
}
