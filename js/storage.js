// =============================================================================
// js/storage.js -- LocalStorage and Supabase persistence helpers.
// Trade, preference, baseline, journal, and cache data access lives here.
// =============================================================================

// ---------------------------------------------------------------------------
// Supabase client -- reuses _sbClient initialized in index.html
// ---------------------------------------------------------------------------
function sb() {
  return _sbClient;
}

// ---------------------------------------------------------------------------
// Cache helpers (market data only -- never trade/user data)
// ---------------------------------------------------------------------------
function cacheGet(key, ttl) {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.ts < ttl) return c.data;
  } catch (e) {}
  return null;
}
function cacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {}
}
function cacheClear(prefix) {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Local app persistence
// ---------------------------------------------------------------------------
function saveTrades() {
  localStorage.setItem(TK, JSON.stringify(trades));
}

function saveHist() {
  localStorage.setItem(HK, JSON.stringify(hist));
  if (_sbClient && currentUser) {
    saveBaseline(hist).catch(e => console.warn('[OP] saveHist Supabase sync failed:', e));
  }
}

function savePrefs() {
  localStorage.setItem(CK.prefs, JSON.stringify(prefs));
  if (_sbClient && currentUser) {
    saveUserSettings(prefs).catch(e => console.warn('[OP] savePrefs Supabase sync failed:', e));
  }
}

function normalizeHist(raw) {
  raw = raw || {};
  return {
    ...DEFAULT_HIST,
    totalTrades:  raw.totalTrades  ?? raw.total_trades  ?? DEFAULT_HIST.totalTrades,
    wins:         raw.wins         ?? DEFAULT_HIST.wins,
    losses:       raw.losses       ?? DEFAULT_HIST.losses,
    breakeven:    raw.breakeven    ?? DEFAULT_HIST.breakeven,
    realizedPnl:  raw.realizedPnl  ?? raw.realized_pnl  ?? DEFAULT_HIST.realizedPnl,
    winPct:       raw.winPct       ?? raw.win_pct       ?? DEFAULT_HIST.winPct,
    avgWinPct:    raw.avgWinPct    ?? raw.avg_win_pct   ?? DEFAULT_HIST.avgWinPct,
    avgLossPct:   raw.avgLossPct   ?? raw.avg_loss_pct  ?? DEFAULT_HIST.avgLossPct,
    profitFactor: raw.profitFactor ?? raw.profit_factor ?? DEFAULT_HIST.profitFactor,
    baselinePeriodValue: raw.baselinePeriodValue ?? raw.baseline_period_value ?? DEFAULT_HIST.baselinePeriodValue,
    baselinePeriodUnit:  raw.baselinePeriodUnit  ?? raw.baseline_period_unit  ?? DEFAULT_HIST.baselinePeriodUnit
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
async function getSession() {
  const { data } = await sb().auth.getSession();
  return data?.session || null;
}

async function getCurrentUser() {
  const { data } = await sb().auth.getUser();
  return data?.user || null;
}

async function sendMagicLink(email) {
  const { error } = await sb().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

async function signOut() {
  cacheClear('op_');   // clear all app cache on logout
  const { error } = await sb().auth.signOut();
  if (error) throw error;
}

function onAuthStateChange(callback) {
  return sb().auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------
async function getUserSettings() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('user_settings')
    .select('settings')
    .eq('user_id', user.id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;  // PGRST116 = no rows
  return data?.settings ? { ...DEFAULT_PREFS, ...data.settings } : { ...DEFAULT_PREFS };
}

async function saveUserSettings(settings) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb()
    .from('user_settings')
    .upsert({ user_id: user.id, settings }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
async function getTrades(statusFilter = null) {
  const user = await getCurrentUser();
  let query = sb()
    .from('trades')
    .select('*')
    .order('opened_at', { ascending: false });
  if (user) query = query.eq('user_id', user.id);
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeTrade);
}

async function getOpenTrades() {
  return getTrades('OPEN');
}

async function getTradeById(id) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('trades')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (error) throw error;
  return data;
}

async function saveTrade(trade) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const payload = buildTradePayload(trade, user.id);

  if (trade.id && !isLocalTradeId(trade.id)) {
    const { data, error } = await sb()
      .from('trades')
      .update(payload)
      .eq('id', trade.id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw error;
    return normalizeTrade(data);
  }

  const { data, error } = await sb()
    .from('trades')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return normalizeTrade(data);
}

function isLocalTradeId(id) {
  return typeof id === 'number' || /^\d{10,}$/.test(String(id || ''));
}

function appTradeFields(trade) {
  return {
    dteOpen:        trade.dteOpen ?? trade.dte ?? '',
    creditReceived:trade.creditReceived ?? trade.credit ?? '',
    maxRisk:       trade.maxRisk ?? trade.maxLoss ?? '',
    stockAtOpen:   trade.stockAtOpen ?? trade.openPrice ?? '',
    exitSignal:    trade.exitSignal || '',
    breakeven:     trade.breakeven ?? null,
    cushionPct:    trade.cushionPct ?? null,
    currentPnlPct: trade.currentPnlPct ?? '',
    closeReason:   trade.closeReason || trade.exit_reason || '',
    closeDate:     trade.closeDate || '',
    sector:        trade.sector || null
  };
}

function buildTradePayload(trade, userId) {
  const app = appTradeFields(trade);
  const analysis = {
    ...(trade.analysis || {}),
    app
  };
  const payload = {
    user_id:      userId,
    ticker:       trade.ticker,
    strategy:     trade.strategy,
    status:       trade.status || 'OPEN',
    legs:         trade.legs || [],
    exp_date:     trade.expDate || null,
    dte_entry:    safeNum(app.dteOpen, null),
    credit:       safeNum(app.creditReceived, null),
    debit:        trade.debit || null,
    contracts:    trade.contracts || 1,
    spread_width: trade.spreadWidth || null,
    max_profit:   trade.maxProfit || null,
    max_loss:     safeNum(app.maxRisk, null),
    open_price:   safeNum(app.stockAtOpen, null),
    tags:         trade.tags || [],
    notes:        trade.notes || null,
    analysis:     analysis,
  };
  if ((trade.status || '').toUpperCase() === 'CLOSED') {
    payload.realized_pnl = safeNum(trade.realizedPnl, null);
    payload.exit_reason = app.closeReason || null;
    payload.closed_at = trade.closed_at || (app.closeDate ? app.closeDate + 'T12:00:00' : new Date().toISOString());
  }
  return payload;
}

function normalizeTrade(raw) {
  if (!raw) return raw;
  const app = (raw.analysis && raw.analysis.app) || {};
  const closedDate = raw.closeDate || app.closeDate || (raw.closed_at ? String(raw.closed_at).slice(0, 10) : '');
  return {
    id:             raw.id,
    ticker:         raw.ticker,
    strategy:       raw.strategy,
    legs:           raw.legs || [],
    expDate:        raw.expDate ?? raw.exp_date ?? '',
    dteOpen:        raw.dteOpen ?? app.dteOpen ?? (raw.dte_entry != null ? String(raw.dte_entry) : ''),
    creditReceived: raw.creditReceived ?? app.creditReceived ?? (raw.credit != null ? String(raw.credit) : ''),
    maxRisk:        raw.maxRisk ?? app.maxRisk ?? (raw.max_loss != null ? String(raw.max_loss) : ''),
    stockAtOpen:    raw.stockAtOpen ?? app.stockAtOpen ?? (raw.open_price != null ? String(raw.open_price) : ''),
    exitSignal:     raw.exitSignal ?? app.exitSignal ?? '',
    notes:          raw.notes || '',
    openDate:       raw.openDate || (raw.opened_at ? String(raw.opened_at).slice(0, 10) : ''),
    breakeven:      raw.breakeven ?? app.breakeven ?? null,
    cushionPct:     raw.cushionPct ?? app.cushionPct ?? null,
    status:         raw.status || 'OPEN',
    currentPnlPct:  raw.currentPnlPct ?? app.currentPnlPct ?? '',
    closeReason:    raw.closeReason ?? app.closeReason ?? raw.exit_reason ?? '',
    closeDate:      closedDate,
    realizedPnl:    raw.realizedPnl ?? raw.realized_pnl ?? null,
    tags:           raw.tags || [],
    sector:         raw.sector ?? app.sector ?? null,
    analysis:       raw.analysis || {}
  };
}

async function persistTrade(trade) {
  saveTrades();
  if (!_sbClient || !currentUser) return trade;
  const saved = await saveTrade(trade);
  const idx = trades.findIndex(t => t.id === trade.id);
  if (idx >= 0) trades[idx] = saved;
  else trades.unshift(saved);
  saveTrades();
  return saved;
}

async function closeTrade(id, { closePrice, realizedPnl, exitReason }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('trades')
    .update({
      status:       'CLOSED',
      close_price:  closePrice,
      realized_pnl: realizedPnl,
      exit_reason:  exitReason || null,
      closed_at:    new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) throw error;
  return normalizeTrade(data);
}

async function deleteTrade(id) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb()
    .from('trades')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Historical baseline
// ---------------------------------------------------------------------------
async function getBaseline() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('historical_baseline')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { ...DEFAULT_HIST };
}

async function saveBaseline(baseline) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb()
    .from('historical_baseline')
    .upsert({
      user_id:      user.id,
      total_trades: baseline.totalTrades,
      wins:         baseline.wins,
      losses:       baseline.losses,
      breakeven:    baseline.breakeven,
      realized_pnl: baseline.realizedPnl,
    }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
async function getJournalNote(date) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('journal')
    .select('*')
    .eq('user_id', user.id)
    .eq('note_date', date)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function saveJournalNote(date, content, marketScore = null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb()
    .from('journal')
    .upsert({
      user_id:      user.id,
      note_date:    date,
      content,
      market_score: marketScore,
    }, { onConflict: 'user_id, note_date' });
  if (error) throw error;
}

async function getRecentJournal(limit = 30) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb()
    .from('journal')
    .select('*')
    .eq('user_id', user.id)
    .order('note_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Stats helpers (computed from trades table)
// ---------------------------------------------------------------------------
async function computeStats() {
  const trades = await getTrades();
  const closed = trades.filter(t => t.status === 'CLOSED');
  const open   = trades.filter(t => t.status === 'OPEN');

  const wins     = closed.filter(t => (t.realized_pnl || 0) > 0);
  const losses   = closed.filter(t => (t.realized_pnl || 0) < 0);
  const be       = closed.filter(t => (t.realized_pnl || 0) === 0);
  const totalPnl = closed.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
  const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.realized_pnl, 0) / wins.length   : 0;
  const avgLoss  = losses.length ? losses.reduce((s, t) => s + t.realized_pnl, 0) / losses.length : 0;
  const pf       = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : null;

  return {
    totalTrades:  closed.length,
    openTrades:   open.length,
    wins:         wins.length,
    losses:       losses.length,
    breakeven:    be.length,
    winPct:       closed.length ? parseFloat((wins.length / closed.length * 100).toFixed(1)) : 0,
    totalPnl:     parseFloat(totalPnl.toFixed(2)),
    avgWin:       parseFloat(avgWin.toFixed(2)),
    avgLoss:      parseFloat(avgLoss.toFixed(2)),
    profitFactor: pf ? parseFloat(pf.toFixed(2)) : null,
  };
}
