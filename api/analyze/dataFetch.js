// =============================================================================
// api/analyze/dataFetch.js
// All external data fetching for the analysis engine.
// Primary: Tradier (real-time quote, options chain, earnings)
// Secondary: Polygon (historical OHLCV, HV30, SMAs, key levels)
// =============================================================================

const POLYGON_KEY = process.env.POLYGON_KEY;
const TRADIER_KEY = process.env.TRADIER_KEY;

const TRADIER_HEADERS = {
  'Authorization': `Bearer ${TRADIER_KEY}`,
  'Accept':        'application/json',
};

// ---------------------------------------------------------------------------
// TRADIER -- real-time quote (primary price source)
// Returns: { price, change, changePct, volume, date } or null
// ---------------------------------------------------------------------------
export async function getTradierQuote(ticker) {
  if (!TRADIER_KEY) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/quotes?symbols=${ticker}`,
      { headers: TRADIER_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const d = await res.json();
    const q = d?.quotes?.quote;
    if (!q || q.last == null) return null;
    return {
      price:     parseFloat(q.last),
      change:    parseFloat(q.change    || 0),
      changePct: parseFloat(q.change_percentage || 0),
      volume:    q.volume   || null,
      date:      q.trade_date || null,
      source:    'tradier',
    };
  } catch (e) {
    console.warn('[dataFetch] Tradier quote failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TRADIER -- options chain with full Greeks
// Returns array of option contracts or null
// ---------------------------------------------------------------------------
export async function getTradierChain(ticker, expDate) {
  if (!TRADIER_KEY || !expDate) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/options/chains?symbol=${ticker}&expiration=${expDate}&greeks=true`,
      { headers: TRADIER_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    const d = await res.json();
    const chain = d?.options?.option;
    if (!chain) return null;
    // Normalize to array
    return Array.isArray(chain) ? chain : [chain];
  } catch (e) {
    console.warn('[dataFetch] Tradier chain failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TRADIER -- earnings calendar
// Returns: { date: 'YYYY-MM-DD' } or null
// ---------------------------------------------------------------------------
export async function getTradierEarnings(ticker) {
  if (!TRADIER_KEY) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/fundamentals/calendars?symbols=${ticker}`,
      { headers: TRADIER_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const d      = await res.json();
    const events = d?.fundamentals?.[0]?.corporate_calendars;
    if (!events || !events.length) return null;
    const upcoming = events
      .filter(e => e.type === 'Earnings' && new Date(e.start_date) >= new Date())
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    return upcoming.length ? { date: upcoming[0].start_date } : null;
  } catch (e) {
    console.warn('[dataFetch] Tradier earnings failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TRADIER -- available expiration dates for a ticker
// Useful for validating user-entered expiration
// Returns: string[] of 'YYYY-MM-DD' or null
// ---------------------------------------------------------------------------
export async function getTradierExpirations(ticker) {
  if (!TRADIER_KEY) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/options/expirations?symbol=${ticker}&includeAllRoots=true`,
      { headers: TRADIER_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const d = await res.json();
    return d?.expirations?.date || null;
  } catch (e) {
    console.warn('[dataFetch] Tradier expirations failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// POLYGON -- historical daily OHLCV
// Used for: HV30, SMA20/50, support/resistance levels, price history
// Polygon is secondary -- used only for historical data Tradier doesn't provide
// Returns rich stock data object or null
// ---------------------------------------------------------------------------
export async function getPolygonHistory(ticker) {
  if (!POLYGON_KEY) return null;
  try {
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url  = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}` +
                 `?adjusted=true&sort=desc&limit=200&apiKey=${POLYGON_KEY}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const d   = await res.json();
    if (!d.results || d.results.length === 0) return null;

    const closes = d.results.map(r => r.c);
    const highs  = d.results.map(r => r.h);
    const lows   = d.results.map(r => r.l);
    const lastDate = new Date(d.results[0].t).toISOString().slice(0, 10);

    // SMAs
    const n20  = Math.min(20,  closes.length);
    const n50  = Math.min(50,  closes.length);
    const n200 = Math.min(200, closes.length);
    const sma20  = closes.slice(0, n20).reduce((a, b)  => a + b, 0) / n20;
    const sma50  = closes.slice(0, n50).reduce((a, b)  => a + b, 0) / n50;
    const sma200 = closes.slice(0, n200).reduce((a, b) => a + b, 0) / n200;

    // HV30 -- annualized 30-day historical volatility
    const sl  = closes.slice(0, 31);
    const ret = sl.slice(0, -1).map((c, i) => Math.log(c / sl[i + 1]));
    const m   = ret.reduce((a, b) => a + b, 0) / ret.length;
    const v   = ret.reduce((a, r) => a + Math.pow(r - m, 2), 0) / (ret.length - 1);
    const hv30 = Math.sqrt(v * 252);

    // 5-day performance
    const price5ago = closes.length > 5 ? closes[5] : closes[closes.length - 1];
    const perf5 = parseFloat(((closes[0] - price5ago) / price5ago * 100).toFixed(2));

    // Support and resistance via swing highs/lows + SMAs
    const rawPrice = closes[0];
    const supports    = new Set([
      Math.round(sma20 * 4) / 4,
      Math.round(sma50 * 4) / 4,
    ]);
    const resistances = new Set();

    for (let i = 2; i < Math.min(60, lows.length - 2); i++) {
      // Swing low = local support
      if (lows[i] < lows[i-1] && lows[i] < lows[i+1] &&
          lows[i] < lows[i-2] && lows[i] < lows[i+2]) {
        supports.add(Math.round(lows[i] * 4) / 4);
      }
      // Swing high = local resistance
      if (highs[i] > highs[i-1] && highs[i] > highs[i+1] &&
          highs[i] > highs[i-2]) {
        resistances.add(Math.round(highs[i] * 4) / 4);
      }
    }

    return {
      // Price (Polygon close -- may be slightly stale vs Tradier real-time)
      polygonPrice: parseFloat(rawPrice.toFixed(2)),
      lastDate,
      closes,   // full array for charting
      highs,
      lows,

      // Technicals
      sma20:    parseFloat(sma20.toFixed(2)),
      sma50:    parseFloat(sma50.toFixed(2)),
      sma200:   parseFloat(sma200.toFixed(2)),
      above50:  rawPrice > sma50,
      above200: rawPrice > sma200,
      hv30,     // raw decimal e.g. 0.32 = 32%
      perf5,

      // Key levels (filtered to relevant side of current price)
      supports:    [...supports]
                     .filter(s => s < rawPrice)
                     .sort((a, b) => b - a)
                     .slice(0, 4),
      resistances: [...resistances]
                     .filter(r => r > rawPrice)
                     .sort((a, b) => a - b)
                     .slice(0, 3),
    };
  } catch (e) {
    console.warn('[dataFetch] Polygon history failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// COMBINED -- fetch everything needed for analysis in parallel
// price comes from Tradier (real-time), history from Polygon
// ---------------------------------------------------------------------------
export async function fetchAllData(ticker, expFormatted) {
  const [quote, history, earnings, chain] = await Promise.all([
    getTradierQuote(ticker),
    getPolygonHistory(ticker),
    getTradierEarnings(ticker),
    expFormatted ? getTradierChain(ticker, expFormatted) : Promise.resolve(null),
  ]);

  // Merge price: Tradier real-time takes priority, Polygon close as fallback
  const price = quote?.price || history?.polygonPrice || null;
  const lastDate = quote?.date || history?.lastDate || null;

  if (!price) return null;

  return {
    price,
    lastDate,
    quote,    // full Tradier quote
    history,  // full Polygon history
    earnings,
    chain,    // options chain array or null

    // Convenience -- pulled up from history
    hv30:         history?.hv30         || null,
    sma20:        history?.sma20        || null,
    sma50:        history?.sma50        || null,
    sma200:       history?.sma200       || null,
    above50:      history?.above50      || false,
    above200:     history?.above200     || false,
    supports:     history?.supports     || [],
    resistances:  history?.resistances  || [],
    closes:       history?.closes       || [],
  };
}

// ---------------------------------------------------------------------------
// HELPERS -- extract Greeks from options chain for a specific strike/type
// ---------------------------------------------------------------------------
export function findChainContract(chain, strike, optionType) {
  if (!chain || !strike) return null;
  const typeChar = optionType.charAt(0).toUpperCase(); // 'P' or 'C'
  return chain.find(o =>
    o.option_type === typeChar &&
    Math.abs(parseFloat(o.strike) - parseFloat(strike)) < 0.26
  ) || null;
}

export function extractGreeks(contract) {
  if (!contract || !contract.greeks) return null;
  const g = contract.greeks;
  return {
    delta:  g.delta  != null ? parseFloat(g.delta.toFixed(4))  : null,
    gamma:  g.gamma  != null ? parseFloat(g.gamma.toFixed(4))  : null,
    theta:  g.theta  != null ? parseFloat(g.theta.toFixed(4))  : null,
    vega:   g.vega   != null ? parseFloat(g.vega.toFixed(4))   : null,
    iv:     g.mid_iv != null ? parseFloat((g.mid_iv * 100).toFixed(1)) : null,
    rho:    g.rho    != null ? parseFloat(g.rho.toFixed(4))    : null,
  };
}
