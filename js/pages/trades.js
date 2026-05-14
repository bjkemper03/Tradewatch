// =============================================================================
// js/pages/trades.js -- Trades page
// =============================================================================

var expandedTradeCards = {};

function jsArg(v) {
  return '\'' + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'';
}

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
    var legs       = t.legs || [];
    var dte        = t.currentDTE;
    var dteC       = dte !== undefined ? (dte <= 5 ? 'var(--red)' : dte <= 10 ? 'var(--yellow)' : 'var(--green)') : 'var(--text3)';
    var lp         = livePrices[t.ticker];
    var curPx      = (lp && lp.price) || safeNum(t.stockAtOpen);
    var priceLabel = lp ? ('$' + curPx + ' live') : (t.stockAtOpen ? '$' + t.stockAtOpen + ' open' : null);
    var be         = safeNum(t.breakeven);
    var liveCushion = curPx > 0 && be > 0
      ? calcTradeCushion(t, curPx, be)
      : safeNum(t.cushionPct);
    var assess  = assessTrade(liveCushion, dte);
    var pnl     = safeNum(t.currentPnlPct);
    var sector  = TICKER_SECTOR[t.ticker] || null;
    var tags    = t.tags || [];

    var expanded = !!expandedTradeCards[t.id];
    html += '<div class="tc ' + assess.cls + '" style="' + (!expanded ? 'padding:0;overflow:hidden' : '') + '">' +
      '<div onclick="toggleTradeDetails(' + jsArg(t.id) + ')" role="button" tabindex="0" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleTradeDetails(' + jsArg(t.id) + ')}" ' +
        'style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:' + (expanded ? '0 0 10px' : '12px 13px') + ';cursor:pointer;margin-bottom:' + (expanded ? '9px' : '0') + '">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="display:flex;align-items:center;gap:7px;margin-bottom:2px;min-width:0;flex-wrap:wrap">' +
            '<span style="font-family:var(--mono);font-size:16px;font-weight:700">' + t.ticker + '</span>' +
            '<span style="font-size:9px;color:var(--text3);font-family:var(--mono)">' + (dte !== undefined ? dte + 'DTE' : '') + '</span>' +
            '<span class="badge" style="background:' + assess.color + '15;border:1px solid ' + assess.color + '25;color:' + assess.color + ';font-size:9px">' + assess.label + '</span>' +
            (sector ? '<span style="font-size:9px;color:var(--text3)">' + sector + '</span>' : '') +
          '</div>' +
          '<div style="font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + t.strategy + (t.expDate ? ' · Exp ' + t.expDate : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;display:flex;align-items:center;gap:10px;flex-shrink:0">' +
          '<div>' +
          '<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:' +
            (liveCushion >= prefs.cushionMin + 2 ? 'var(--green)' : liveCushion >= prefs.cushionMin ? 'var(--yellow)' : 'var(--red)') +
          '">' + liveCushion + '%</div>' +
          '<div style="font-size:9px;color:var(--text3)">cushion' + (lp ? ' live' : '') + '</div>' +
          '<div style="font-size:10px;color:var(--text2);font-family:var(--mono)">BE $' + (t.breakeven || '?') + '</div>' +
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
      g3html([
        mc2('Price',      priceLabel || 'N/A',              lp ? 'var(--green)' : 'var(--text)'),
        mc2('Credit/shr', '$' + (t.creditReceived || '?'),  'var(--green)'),
        mc2('Collateral', '$' + (t.maxRisk || '?'),         'var(--text)')
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
        '<input type="number" placeholder="P&L %" value="' + (t.currentPnlPct || '') + '" onblur="updPnl(' + jsArg(t.id) + ',this.value)" style="flex:1;font-family:var(--mono);font-size:13px;color:' + (pnl >= 40 ? 'var(--green)' : pnl < -15 ? 'var(--red)' : 'var(--text)') + '">' +
        '<button onclick="closeT(' + jsArg(t.id) + ',\'PROFIT\')" class="btn btn-success btn-sm">&#10003; Win</button>' +
        '<button onclick="closeT(' + jsArg(t.id) + ',\'STOP\')"   class="btn btn-danger btn-sm">&#10007; Loss</button>' +
        '<button onclick="delT('  + jsArg(t.id) + ')"             class="btn btn-ghost btn-sm" style="color:var(--red);border-color:rgba(239,68,68,.3)">&#128465;</button>' +
      '</div>') : '') +
    '</div>';
  });

  // ── Closed trades with strategy tabs ─────────────────────────────────────
  if (closed.length > 0) {
    // Build tab list: All + unique strategies in closed trades
    var strategies = [];
    closed.forEach(function(t) {
      if (t.strategy && strategies.indexOf(t.strategy) === -1) strategies.push(t.strategy);
    });
    strategies.sort();

    // Reset tab if strategy no longer exists
    if (tradesTab !== 'All' && strategies.indexOf(tradesTab) === -1) tradesTab = 'All';

    var tabsHtml = '<div style="display:flex;overflow-x:auto;gap:0;border-bottom:1px solid var(--border);margin:12px 12px 0;scrollbar-width:none">';
    ['All'].concat(strategies).forEach(function(s) {
      var isActive = tradesTab === s;
      var count = s === 'All' ? closed.length : closed.filter(function(t){ return t.strategy === s; }).length;
      tabsHtml += '<button onclick="tradesTab=\'' + s.replace(/'/g,"\\'") + '\';tradesExpanded=false;renderTrades()" ' +
        'style="flex-shrink:0;padding:7px 13px;background:transparent;border:none;border-bottom:2px solid ' +
        (isActive ? 'var(--blue2)' : 'transparent') +
        ';color:' + (isActive ? 'var(--blue2)' : 'var(--text3)') +
        ';font-family:var(--sans);font-size:11px;font-weight:' + (isActive ? '600' : '500') +
        ';cursor:pointer;white-space:nowrap">' +
        s + ' <span style="opacity:.6">(' + count + ')</span>' +
      '</button>';
    });
    tabsHtml += '</div>';
    html += tabsHtml;

    // Filter closed trades by active tab
    var tabClosed = tradesTab === 'All'
      ? closed.slice()
      : closed.filter(function(t) { return t.strategy === tradesTab; });

    tabClosed.sort(function(a, b) {
      var da = new Date((a.closeDate || a.closed_at || a.openDate || '') + 'T12:00:00');
      var db = new Date((b.closeDate || b.closed_at || b.openDate || '') + 'T12:00:00');
      return db - da;
    });

    var SHOW_LIMIT  = 5;
    var visible     = tradesExpanded ? tabClosed : tabClosed.slice(0, SHOW_LIMIT);

    visible.forEach(function(t) { html += closedRow(t); });

    if (tabClosed.length > SHOW_LIMIT) {
      if (!tradesExpanded) {
        html += '<button class="btn btn-ghost btn-w" style="margin:4px 12px 8px;width:calc(100% - 24px)" ' +
          'onclick="tradesExpanded=true;renderTrades()">' +
          '&#9660; Show all ' + tabClosed.length + ' trades</button>';
      } else {
        html += '<button class="btn btn-ghost btn-w" style="margin:4px 12px 8px;width:calc(100% - 24px)" ' +
          'onclick="tradesExpanded=false;renderTrades()">' +
          '&#9650; Show less</button>';
      }
    }
  }

  html += '</div>';
  el.innerHTML = html;

  // Re-init leg form after render
  if (!formLegData || !formLegData.length) {
    formLegData = DEF[formStrat] ? DEF[formStrat].map(function(l) { return Object.assign({}, l); }) : [{ a:'BUY', t:'PUT', n:1, s:'' }];
  }
  buildLegs();
}

function toggleTradeDetails(id) {
  expandedTradeCards[id] = !expandedTradeCards[id];
  renderTrades();
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
      '<button onclick="delT(' + jsArg(t.id) + ')" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px">&#10005;</button>' +
    '</div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Strategy pill selector (for log form)
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
  formStrat   = s;
  formLegData = (DEF[s] || [{ a:'BUY', t:'PUT', n:1, s:'' }]).map(function(l) { return Object.assign({}, l); });
  document.querySelectorAll('.sp').forEach(function(p) { p.classList.toggle('active', p.textContent === s); });
  buildLegs();
  tradeAutoCol();
}

// ---------------------------------------------------------------------------
// Leg builder
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

function calcTradeBreakeven(strategy, legs, credit) {
  var sellLeg = legs.find(function(l) { return l.a === 'SELL'; });
  var buyLeg = legs.find(function(l) { return l.a === 'BUY'; });
  var cr = safeNum(credit);
  if (strategy === 'LONG PUT' && buyLeg) return safeNum(buyLeg.s) - cr;
  if (strategy === 'LONG CALL' && buyLeg) return safeNum(buyLeg.s) + cr;
  if (strategy === 'CALL CREDIT SPREAD' && sellLeg) return safeNum(sellLeg.s) + cr;
  if (strategy === 'COVERED CALL') return null;
  if (sellLeg) return safeNum(sellLeg.s) - cr;
  return null;
}

function calcTradeCushion(t, price, breakeven) {
  if (!price || !breakeven) return null;
  if (t.strategy === 'LONG PUT' || t.strategy === 'PUT DEBIT SPREAD') return parseFloat(((breakeven - price) / price * 100).toFixed(1));
  if (t.strategy === 'LONG CALL' || t.strategy === 'CALL DEBIT SPREAD' || t.strategy === 'CALL CREDIT SPREAD' || t.strategy === 'COVERED CALL') {
    return parseFloat(((breakeven - price) / price * 100).toFixed(1));
  }
  return parseFloat(((price - breakeven) / price * 100).toFixed(1));
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
async function submitTrade() {
  var ticker = $('tf-tk') ? $('tf-tk').value.trim().toUpperCase() : '';
  if (!ticker) { alert('Enter a ticker'); return; }
  var stock      = safeNum($('tf-px')  ? $('tf-px').value  : 0);
  var credit     = safeNum($('tf-cr')  ? $('tf-cr').value  : 0);
  var collateral = safeNum($('tf-col') ? $('tf-col').value : 0);
  var expRaw     = $('tf-exp')  ? $('tf-exp').value  : '';
  var exitVal    = $('tf-exit') ? $('tf-exit').value : '';
  var notesVal   = $('tf-notes')? $('tf-notes').value: '';
  var dteInput   = $('tf-dte')  ? $('tf-dte').value  : '';
  var beRaw      = calcTradeBreakeven(formStrat, formLegData, credit);
  var be         = beRaw != null ? parseFloat(beRaw.toFixed(2)) : null;
  var cushionVal = (stock > 0 && be) ? calcTradeCushion({ strategy: formStrat }, stock, be) : null;
  var dte        = calcDTE(expRaw);
  var sector     = TICKER_SECTOR[ticker] || null;

  var newTrade = {
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
  };

  trades.unshift(newTrade);
  saveTrades();
  toast('Trade logged. Syncing...');
  selectedTags = [];
  renderTrades();

  try {
    await persistTrade(newTrade);
    renderTrades();
    toast('Trade saved to Supabase');
  } catch(e) {
    console.warn('[OP] Trade Supabase save failed:', e);
    toast('Trade saved locally. Supabase sync failed.');
  }
}

// ---------------------------------------------------------------------------
// Trade actions
// ---------------------------------------------------------------------------
async function updPnl(id, v) {
  var t = trades.find(function(t) { return t.id === id; });
  if (t) {
    t.currentPnlPct = v;
    saveTrades();
    try {
      await persistTrade(t);
    } catch(e) {
      console.warn('[OP] P&L Supabase save failed:', e);
      toast('P&L saved locally. Supabase sync failed.');
    }
  }
}

function estimateRealizedPnl(t) {
  if (t.realizedPnl != null && t.realizedPnl !== '') return safeNum(t.realizedPnl);
  var cr = safeNum(t.creditReceived || t.credit || 0);
  var pct = safeNum(t.currentPnlPct || 0);
  var contracts = safeNum(t.contracts || 0);
  if (!contracts) {
    var legs = t.legs || [];
    contracts = legs.reduce(function(max, leg) {
      return Math.max(max, safeNum(leg.n || 1));
    }, 1);
  }
  return cr * 100 * contracts * pct / 100;
}

async function closeT(id, r) {
  var t = trades.find(function(t) { return t.id === id; });
  if (t) {
    t.status      = 'CLOSED';
    t.closeReason = r;
    t.closeDate   = new Date().toISOString().slice(0, 10);
    t.realizedPnl = estimateRealizedPnl(t);
    saveTrades();
    renderTrades();
    toast(t.ticker + ' closed. Syncing...');
    try {
      await persistTrade(t);
      renderTrades();
      toast(t.ticker + ' closed -- ' + r);
    } catch(e) {
      console.warn('[OP] Close trade Supabase save failed:', e);
      toast(t.ticker + ' closed locally. Supabase sync failed.');
    }
  }
}

async function delT(id) {
  if (confirm('Delete this trade?')) {
    try {
      if (!isLocalTradeId(id) && _sbClient && currentUser) await deleteTrade(id);
    } catch(e) {
      console.warn('[OP] Delete trade Supabase failed:', e);
      toast('Delete failed in Supabase.');
      return;
    }
    trades = trades.filter(function(t) { return t.id !== id; });
    saveTrades();
    renderTrades();
  }
}

// ---------------------------------------------------------------------------
// Log from analysis
// ---------------------------------------------------------------------------
function logFromAnalysis() {
  if (!azResult) return;
  formStrat   = azResult.strategy || 'PUT CREDIT SPREAD';
  formLegData = azResult.legs || DEF[formStrat].map(function(l) { return Object.assign({}, l); });
  showPage('trades');
  setTimeout(function() {
    formStrat   = azResult.strategy || 'PUT CREDIT SPREAD';
    formLegData = (azResult.legs || DEF[formStrat] || []).map(function(l) { return Object.assign({}, l); });
    var f = $('tfm');
    if (f && f.style.display === 'none') f.style.display = 'block';
    setTimeout(function() {
      if ($('tf-tk'))    $('tf-tk').value    = azResult.ticker || '';
      if ($('tf-px'))    $('tf-px').value    = azResult.price    != null ? azResult.price.toFixed(2)    : '';
      if ($('tf-exp'))   $('tf-exp').value   = azResult.exp      || '';
      if ($('tf-dte'))   $('tf-dte').value   = azResult.dte      != null ? azResult.dte.toString()      : '';
      if ($('tf-cr'))    $('tf-cr').value    = azResult.credit   != null ? azResult.credit.toString()   : '';
      if ($('tf-col'))   $('tf-col').value   = azResult.collateral != null ? azResult.collateral.toFixed(0) : '';
      if ($('tf-exit'))  $('tf-exit').value  = azResult.exitSignal != null ? azResult.exitSignal.toString() : '';
      if ($('tf-notes')) $('tf-notes').value = azResult.notes || '';
      buildLegs();
    }, 80);
  }, 150);
}
