// =============================================================================
// js/trades/tradeActions.js -- Trade actions and live price refresh
// =============================================================================
// ---------------------------------------------------------------------------
// Live price loader
// ---------------------------------------------------------------------------
function cachedLiveQuote(ticker) {
  try {
    var c = JSON.parse(localStorage.getItem(CK.lp + ticker) || 'null');
    if (c && Date.now() - c.ts < TTL.lp && c.data) {
      return Object.assign({ fetchedAt: c.ts }, c.data);
    }
  } catch(e) {}
  return null;
}

function hydrateLivePrices() {
  trades.filter(function(t) { return t.status === 'OPEN'; }).forEach(function(t) {
    if (livePrices[t.ticker] && livePrices[t.ticker].fetchedAt && Date.now() - livePrices[t.ticker].fetchedAt > TTL.lp) {
      delete livePrices[t.ticker];
    }
    if (!livePrices[t.ticker]) {
      var cached = cachedLiveQuote(t.ticker);
      if (cached) livePrices[t.ticker] = cached;
    }
  });
}

async function loadLivePrices(force) {
  if (force === undefined) force = false;
  var tickers = [];
  var seen = {};
  trades.filter(function(t) { return t.status === 'OPEN'; }).forEach(function(t) {
    if (!seen[t.ticker]) { seen[t.ticker] = true; tickers.push(t.ticker); }
  });
  for (var i = 0; i < tickers.length; i++) {
    var p = await fetchQuote(tickers[i], force);
    if (p) livePrices[tickers[i]] = Object.assign({ fetchedAt: Date.now() }, p);
    await new Promise(function(r) { setTimeout(r, 500); });
  }
}

function openLiveQuotes(openTrades) {
  var tickers = {};
  (openTrades || []).forEach(function(t) { tickers[t.ticker] = true; });
  return Object.keys(tickers).map(function(k) { return livePrices[k]; }).filter(Boolean);
}

function liveQuoteAgeText(openTrades) {
  var times = openLiveQuotes(openTrades).map(function(q) { return q && q.fetchedAt; }).filter(Boolean);
  if (!times.length) return '';
  var newest = Math.max.apply(null, times);
  var mins = Math.max(0, Math.round((Date.now() - newest) / 60000));
  return mins < 1 ? 'just now' : mins + 'm ago';
}
function livePricePromptHtml(open, hasLive, liveAge) {
  if (open.length === 0) return '';
  return '<div style="margin:0 12px 8px;padding:9px 12px;background:var(--blue-dim);border:1px solid rgba(99,102,241,.25);border-radius:8px;font-size:11px;color:var(--blue2);cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center" onclick="loadLivePrices(true).then(renderTrades)">' +
    '<span>&rarr; ' + (hasLive ? 'Refresh' : 'Load') + ' live stock prices</span>' +
    (liveAge ? '<span style="font-family:var(--mono);color:var(--text3)">as of ' + liveAge + '</span>' : '') +
  '</div>';
}
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
  var entryType  = isDebitStrat(formStrat) ? 'debit' : 'credit';
  var beRaw      = calcTradeBreakeven(formStrat, formLegData, credit);
  var be         = beRaw != null ? parseFloat(beRaw.toFixed(2)) : null;
  var cushionVal = (stock > 0 && be) ? calcTradeCushion({ strategy: formStrat }, stock, be) : null;
  var dte        = calcDTE(expRaw);
  var sector     = TICKER_SECTOR[ticker] || null;
  var analysisSnapshot = pendingAnalysisForLog ? JSON.parse(JSON.stringify(pendingAnalysisForLog)) : null;
  pendingAnalysisForLog = null;

  var newTrade = {
    id:             Date.now(),
    ticker:         ticker,
    strategy:       formStrat,
    legs:           formLegData.map(function(l) { return Object.assign({}, l); }),
    expDate:        expRaw,
    dteOpen:        dteInput || (dte != null ? dte.toString() : ''),
    creditReceived: credit.toString(),
    entryType:      entryType,
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
    sector:         sector,
    analysis:       analysisSnapshot
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
    if (t.currentPnlPct == null || t.currentPnlPct === '') {
      var entered = prompt('Enter realized P/L % before closing this trade.');
      if (entered === null) return;
      entered = entered.trim();
      if (entered === '' || !Number.isFinite(safeNum(entered, NaN))) {
        toast('Close canceled. Enter a valid P/L %.');
        return;
      }
      t.currentPnlPct = entered;
    }
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
      if (!isLocalTradeId(id) && _sbClient && currentUser && isSupabaseSyncAllowed()) await deleteTrade(id);
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
