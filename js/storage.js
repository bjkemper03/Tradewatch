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
  if (_sbClient && currentUser) {
    saveUserSettings({ ...prefs }).catch(e => console.warn('[OP] saveTrades settings sync failed:', e));
  }
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
  const { data, error } = await sb()
    .from('user_settings')
    .select('settings')
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
  let query = sb()
    .from('trades')
    .select('*')
    .order('opened_at', { ascending: false });
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getOpenTrades() {
  return getTrades('OPEN');
}

async function getTradeById(id) {
  const { data, error } = await sb()
    .from('trades')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function saveTrade(trade) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const payload = {
    user_id:      user.id,
    ticker:       trade.ticker,
    strategy:     trade.strategy,
    status:       trade.status || 'OPEN',
    legs:         trade.legs || [],
    exp_date:     trade.expDate || null,
    dte_entry:    trade.dte || null,
    credit:       trade.credit || null,
    debit:        trade.debit || null,
    contracts:    trade.contracts || 1,
    spread_width: trade.spreadWidth || null,
    max_profit:   trade.maxProfit || null,
    max_loss:     trade.maxLoss || null,
    open_price:   trade.openPrice || null,
    tags:         trade.tags || [],
    notes:        trade.notes || null,
    analysis:     trade.analysis || {},
  };

  if (trade.id) {
    // Update existing
    const { data, error } = await sb()
      .from('trades')
      .update(payload)
      .eq('id', trade.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    // Insert new
    const { data, error } = await sb()
      .from('trades')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function closeTrade(id, { closePrice, realizedPnl, exitReason }) {
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
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTrade(id) {
  const { error } = await sb()
    .from('trades')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Historical baseline
// ---------------------------------------------------------------------------
async function getBaseline() {
  const { data, error } = await sb()
    .from('historical_baseline')
    .select('*')
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
  const { data, error } = await sb()
    .from('journal')
    .select('*')
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
  const { data, error } = await sb()
    .from('journal')
    .select('*')
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
