// =============================================================================
// js/marketData.js -- Market data fetching and calendar events
// Loaded by index.html as a plain script -- all functions are global.
// Depends on: API, CK, TTL constants from index.html
// =============================================================================

// ---------------------------------------------------------------------------
// Cache helpers -- localStorage with TTL
// ---------------------------------------------------------------------------
function gc(key, ttl) {
  try {
    var c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.ts < ttl) return c.data;
  } catch(e) {}
  return null;
}

function sc2(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data: data, ts: Date.now() }));
  } catch(e) {
    console.warn('[marketData] Cache write failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Market data -- fetches from /api/market (Supabase shared cache on backend)
// ---------------------------------------------------------------------------
async function fetchMarketData(force) {
  if (force === undefined) force = false;
  if (!force) {
    var c = gc(CK.mkt, TTL.mkt);
    if (c) return c;
  }
  try {
    var r = await fetch(API.market + (force ? '?force=true' : ''), {
      signal: AbortSignal.timeout(30000)
    });
    var d = await r.json();
    if (d.ok && d.data) {
      sc2(CK.mkt, d.data);
      return d.data;
    }
  } catch(e) {
    console.error('[marketData] Market fetch error:', e);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Earnings data -- fetches from /api/earnings
// ---------------------------------------------------------------------------
async function fetchEarningsData(ticker) {
  var ck = CK.earn + ticker;
  var c = gc(ck, TTL.earn);
  if (c !== null) return c;
  try {
    var r = await fetch(API.earnings + '?ticker=' + ticker, {
      signal: AbortSignal.timeout(10000)
    });
    var d = await r.json();
    if (d.ok) {
      var res = d.date ? { ticker: ticker, date: d.date } : null;
      sc2(ck, res);
      return res;
    }
  } catch(e) {}
  return null;
}

// ---------------------------------------------------------------------------
// Quote -- fetches from /api/quote (Tradier primary, Polygon fallback)
// ---------------------------------------------------------------------------
async function fetchQuote(ticker) {
  var ck = CK.lp + ticker;
  var c = gc(ck, TTL.lp);
  if (c) return c;
  try {
    var r = await fetch(API.quote + '?ticker=' + ticker, {
      signal: AbortSignal.timeout(10000)
    });
    var d = await r.json();
    if (d.ok) {
      var result = { price: d.price, date: d.date };
      sc2(ck, result);
      return result;
    }
  } catch(e) {}
  return null;
}

// ---------------------------------------------------------------------------
// Calendar events -- FOMC, OPEX, CPI, NFP
// Pure date math, no API calls needed
// ---------------------------------------------------------------------------
function buildCalendarEvents() {
  var today  = new Date();
  var y      = today.getFullYear();
  var events = [];

  // FOMC meetings -- 8 per year
  var fomcDates = [
    new Date(y, 0, 28), new Date(y, 2, 18), new Date(y, 4, 6),  new Date(y, 5, 17),
    new Date(y, 6, 29), new Date(y, 8, 16), new Date(y, 10, 4), new Date(y, 11, 16)
  ];
  fomcDates.forEach(function(d) {
    if (d >= new Date(today.getFullYear(), today.getMonth() - 1, 1)) {
      events.push({
        d: d, name: 'FOMC Meeting', sector: 'ALL', impact: 'HIGH',
        note: 'Fed rate decision. VIX typically spikes. Avoid opening new positions within 48hrs.'
      });
    }
  });

  // Monthly OPEX -- 3rd Friday of every month
  for (var m = 0; m < 12; m++) {
    var d = new Date(y, m, 1);
    var fri = 0;
    while (fri < 3) {
      if (d.getDay() === 5) fri++;
      if (fri < 3) d.setDate(d.getDate() + 1);
    }
    if (d >= today) {
      events.push({
        d: new Date(d), name: 'Monthly OPEX', sector: 'ALL', impact: 'MED',
        note: 'Options expiration. Unusual price action near popular strikes. Pin risk on short strikes.'
      });
    }
  }

  // CPI -- day after 2nd Wednesday of each month
  for (var m2 = 0; m2 < 12; m2++) {
    var d2 = new Date(y, m2, 1);
    var wed = 0;
    while (wed < 2) {
      if (d2.getDay() === 3) wed++;
      if (wed < 2) d2.setDate(d2.getDate() + 1);
    }
    d2.setDate(d2.getDate() + 1);
    if (d2 >= today) {
      events.push({
        d: new Date(d2), name: 'CPI Report', sector: 'ALL', impact: 'HIGH',
        note: 'Inflation data. Hot CPI = Fed stays hawkish = market pressure.'
      });
    }
  }

  // NFP -- 1st Friday of each month
  for (var m3 = 0; m3 < 12; m3++) {
    var d3 = new Date(y, m3, 1);
    while (d3.getDay() !== 5) d3.setDate(d3.getDate() + 1);
    if (d3 >= today) {
      events.push({
        d: new Date(d3), name: 'Jobs Report (NFP)', sector: 'ALL', impact: 'HIGH',
        note: 'Non-farm payrolls. Strong jobs = Fed stays hawkish.'
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Sectors metadata -- used by renderSectors()
// Defined here so it's alongside the fetch logic
// ---------------------------------------------------------------------------
var SEC_META = [
  { sym:'XLK',  name:'Technology',     top3:'AAPL, MSFT, NVDA', note:'High IV -- best premium environment. Rate and earnings sensitive.' },
  { sym:'SOXX', name:'Semiconductors', top3:'NVDA, AVGO, AMD',  note:'Highest vol in your universe. Best premium but most gap risk.' },
  { sym:'XLC',  name:'Comm. Services', top3:'META, GOOGL, NFLX',note:'META in portfolio. High IV around earnings.' },
  { sym:'XLF',  name:'Financials',     top3:'JPM, BAC, GS',     note:'Rate-sensitive -- avoid within 5 days of FOMC.' },
  { sym:'XLE',  name:'Energy',         top3:'XOM, CVX, COP',    note:'Moves with oil. Cleaner trends, lower IV.' },
  { sym:'XLV',  name:'Healthcare',     top3:'UNH, JNJ, LLY',    note:'Biotech can gap 20%+ on trial data.' },
  { sym:'XLY',  name:'Consumer Disc.', top3:'AMZN, TSLA, HD',   note:'Watches consumer spending and tariff news.' },
  { sym:'XLI',  name:'Industrials',    top3:'GE, CAT, HON',     note:'Steady mover. Lower IV -- good for conservative CSPs.' },
];

// ---------------------------------------------------------------------------
// Sector performance fetch
// ---------------------------------------------------------------------------
async function fetchSectorPerf() {
  var cached = gc(CK.sec, TTL.sec);
  if (cached) return cached;

  var perf = {};
  var mktCache = gc(CK.mkt, TTL.mkt);
  perf['SPY'] = (mktCache && mktCache.spy && mktCache.spy.perf5) ? mktCache.spy.perf5 : null;

  for (var i = 0; i < SEC_META.length; i++) {
    var sym = SEC_META[i].sym;
    try {
      var r = await fetch(API.quote + '?ticker=' + sym, {
        signal: AbortSignal.timeout(8000)
      });
      var d = await r.json();
      perf[sym] = d.ok ? (d.changePct || null) : null;
    } catch(e) {
      perf[sym] = null;
    }
    await new Promise(function(res) { setTimeout(res, 300); });
  }

  sc2(CK.sec, perf);
  return perf;
}
