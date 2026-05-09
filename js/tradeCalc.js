// =============================================================================
// tradeCalc.js -- Options math, collateral, breakeven calculations
// =============================================================================

function safeNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Parse expiration: accepts 5/10/26, 6/1/2026, 05/10/2026
function parseExp(str) {
  if (!str) return null;
  const s = str.trim().replace(/-/g, '/');
  const p = s.split('/');
  if (p.length !== 3) return null;
  let [m, d, y] = p;
  if (y.length === 2) y = '20' + y;
  const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T16:00:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

function calcDTE(expStr) {
  const d = parseExp(expStr);
  if (!d) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

function isDebitStrategy(strat) {
  return (STRAT_GROUPS.DEBIT || []).includes(strat);
}

// ---------------------------------------------------------------------------
// BWB / Complex structure math
// ---------------------------------------------------------------------------
function calcBWBMaxLoss(legs, credit) {
  const cr    = safeNum(credit);
  const buys  = legs.filter(l => l.a === 'BUY').map(l => safeNum(l.s)).filter(s => s > 0).sort((a, b) => b - a);
  const sells = legs.filter(l => l.a === 'SELL').map(l => safeNum(l.s)).filter(s => s > 0);
  if (buys.length < 2 || sells.length < 1) return null;

  const topLong    = buys[0];
  const bottomLong = buys[buys.length - 1];
  const short      = sells[0];
  if (!(topLong > short && short > bottomLong)) return null;

  const contracts = legs.find(l => l.a === 'SELL')?.n || 1;
  const upper     = topLong - short;
  const lower     = short - bottomLong;
  if (upper <= 0 || lower <= 0) return null;

  const rawLoss = (lower - upper) * 100 * contracts - (cr * 100 * contracts);
  return { maxLoss: Math.max(0, rawLoss), upper, lower, topLong, short, bottomLong, contracts };
}

function calcBWBBreakeven(legs, credit) {
  const sells = legs.filter(l => l.a === 'SELL');
  if (!sells.length) return null;
  const s = safeNum(sells[0].s);
  const c = safeNum(credit);
  return s && c ? parseFloat((s - c).toFixed(2)) : null;
}

// ---------------------------------------------------------------------------
// Collateral calculation by strategy
// ---------------------------------------------------------------------------
function calcCollateral(strategy, legs, credit) {
  const cr        = safeNum(credit);
  const sells     = legs.filter(l => l.a === 'SELL');
  const buys      = legs.filter(l => l.a === 'BUY');
  const contracts = Math.max(...[...sells, ...buys].map(l => l.n || 1), 1);
  const allStrikes = [...sells, ...buys].map(l => safeNum(l.s));
  if (allStrikes.some(s => s <= 0)) return 0;

  if (strategy === 'CASH SECURED PUT') {
    return safeNum(sells[0]?.s) * 100;
  }
  if (strategy === 'COVERED CALL') {
    return 0;
  }
  if (['PUT BUTTERFLY', 'CALL BUTTERFLY', 'PUT RATIO SPREAD', 'CALL RATIO SPREAD'].includes(strategy)) {
    const b = calcBWBMaxLoss(legs, cr);
    return b && b.maxLoss > 0 ? b.maxLoss : 0;
  }
  if (strategy === 'IRON CONDOR' || strategy === 'IRON BUTTERFLY') {
    const puts  = legs.filter(l => l.t === 'PUT');
    const calls = legs.filter(l => l.t === 'CALL');
    const putW  = puts.filter(l => l.a === 'SELL')[0] && puts.filter(l => l.a === 'BUY')[0]
      ? Math.abs(safeNum(puts.find(l => l.a === 'SELL').s) - safeNum(puts.find(l => l.a === 'BUY').s))
      : 0;
    const callW = calls.filter(l => l.a === 'SELL')[0] && calls.filter(l => l.a === 'BUY')[0]
      ? Math.abs(safeNum(calls.find(l => l.a === 'SELL').s) - safeNum(calls.find(l => l.a === 'BUY').s))
      : 0;
    const maxW = Math.max(putW, callW);
    return maxW > 0 ? Math.max(0, (maxW - cr) * 100 * contracts) : 0;
  }
  if (['LONG PUT', 'LONG CALL'].includes(strategy)) {
    return cr * 100 * contracts;
  }
  if (sells.length > 0 && buys.length > 0) {
    const w = Math.abs(safeNum(sells[0]?.s) - safeNum(buys[0]?.s));
    if (w <= 0) return 0;
    return Math.max(0, (w - cr) * 100 * contracts);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Dynamic calendar events (algorithmically generated)
// ---------------------------------------------------------------------------
function buildCalendarEvents() {
  const today = new Date();
  const y     = today.getFullYear();
  const events = [];

  // FOMC -- 8 per year
  const fomcDates = [
    new Date(y,0,28), new Date(y,2,18), new Date(y,4,6),  new Date(y,5,17),
    new Date(y,6,29), new Date(y,8,16), new Date(y,10,4), new Date(y,11,16),
  ];
  fomcDates.forEach(d => {
    if (d >= new Date(today.getFullYear(), today.getMonth() - 1, 1))
      events.push({ d, name: 'FOMC Meeting', sector: 'ALL', impact: 'HIGH',
        note: 'Fed rate decision. Even if unchanged, press conference tone moves markets. VIX typically spikes. Avoid opening new positions within 48hrs of this.' });
  });

  // OPEX -- 3rd Friday of every month
  for (let m = 0; m < 12; m++) {
    const d = new Date(y, m, 1);
    let fridays = 0;
    while (fridays < 3) { if (d.getDay() === 5) fridays++; if (fridays < 3) d.setDate(d.getDate() + 1); }
    if (d >= today)
      events.push({ d: new Date(d), name: 'Monthly OPEX', sector: 'ALL', impact: 'MED',
        note: 'Options expiration. Unusual price action near popular strikes is common. Pin risk on short strikes close to the money.' });
  }

  // CPI -- approximately 2nd Wednesday of each month
  for (let m = 0; m < 12; m++) {
    const d = new Date(y, m, 1);
    let weds = 0;
    while (weds < 2) { if (d.getDay() === 3) weds++; if (weds < 2) d.setDate(d.getDate() + 1); }
    d.setDate(d.getDate() + 1);
    if (d >= today)
      events.push({ d: new Date(d), name: 'CPI Report', sector: 'ALL', impact: 'HIGH',
        note: 'Inflation data. Hot CPI = Fed stays hawkish = rate pressure = market selloff. Your biggest macro risk for open spreads on tech names.' });
  }

  // NFP -- 1st Friday of each month
  for (let m = 0; m < 12; m++) {
    const d = new Date(y, m, 1);
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
    if (d >= today)
      events.push({ d: new Date(d), name: 'Jobs Report (NFP)', sector: 'ALL', impact: 'HIGH',
        note: 'Non-farm payrolls. Strong jobs = Fed stays hawkish = potential market pressure. Watch the day before for positioning.' });
  }

  return events;
}
