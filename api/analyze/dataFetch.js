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
    const volumes = d.results.map(r => r.v || 0);
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

    // Support and resistance via swing highs/lows + SMAs, scored for recency and confirmation.
    const rawPrice = closes[0];
    const avgVol20 = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, volumes.length));
    const levelTol = Math.max(rawPrice * 0.0075, 0.25);
    const candidates = [];

    function roundedLevel(v) {
      return Math.round(v * 4) / 4;
    }

    function addLevel(kind, price, source, idx) {
      if (!price || price <= 0) return;
      const level = roundedLevel(price);
      const isSma = source.startsWith('sma');
      const touches = closes
        .slice(0, Math.min(90, closes.length))
        .filter((_, j) => kind === 'support'
          ? Math.abs(lows[j] - level) <= levelTol || Math.abs(closes[j] - level) <= levelTol
          : Math.abs(highs[j] - level) <= levelTol || Math.abs(closes[j] - level) <= levelTol
        ).length;
      const newerCloses = closes.slice(0, Math.max(0, idx));
      const broken = isSma
        ? false
        : kind === 'support'
          ? newerCloses.some(c => c < level - levelTol)
          : newerCloses.some(c => c > level + levelTol);
      const retested = !isSma && touches >= 2 && !broken;
      const freshDays = idx == null ? null : idx;
      const volAtLevel = idx == null ? null : volumes[idx];
      const volumeConfirmed = volAtLevel != null && avgVol20 > 0 ? volAtLevel >= avgVol20 * 1.15 : false;
      const distancePct = parseFloat(((level - rawPrice) / rawPrice * 100).toFixed(1));
      const recencyScore = freshDays == null ? 8 : Math.max(0, 30 - freshDays);
      const score =
        Math.max(0, 30 - Math.abs(distancePct) * 3) +
        recencyScore +
        Math.min(touches, 5) * 4 +
        (retested ? 8 : 0) +
        (volumeConfirmed ? 6 : 0) -
        (broken ? 18 : 0) +
        (isSma ? 4 : 0);

      candidates.push({
        kind,
        price: level,
        source,
        freshDays,
        touches,
        broken,
        retested,
        volumeConfirmed,
        distancePct,
        score: parseFloat(score.toFixed(1)),
      });
    }

    addLevel(sma20 < rawPrice ? 'support' : 'resistance', sma20, 'sma20', null);
    addLevel(sma50 < rawPrice ? 'support' : 'resistance', sma50, 'sma50', null);

    for (let i = 2; i < Math.min(60, lows.length - 2); i++) {
      // Swing low = local support
      if (lows[i] < lows[i-1] && lows[i] < lows[i+1] &&
          lows[i] < lows[i-2] && lows[i] < lows[i+2]) {
        addLevel('support', lows[i], 'swing', i);
      }
      // Swing high = local resistance
      if (highs[i] > highs[i-1] && highs[i] > highs[i+1] &&
          highs[i] > highs[i-2]) {
        addLevel('resistance', highs[i], 'swing', i);
      }
    }

    function mergeLevels(kind) {
      const sorted = candidates
        .filter(l => l.kind === kind)
        .filter(l => kind === 'support' ? l.price < rawPrice : l.price > rawPrice)
        .sort((a, b) => b.score - a.score);
      const merged = [];
      for (const level of sorted) {
        const existing = merged.find(l => Math.abs(l.price - level.price) <= levelTol);
        if (!existing) merged.push(level);
        else if (level.score > existing.score) Object.assign(existing, level);
      }
      return merged
        .sort((a, b) => kind === 'support' ? b.price - a.price : a.price - b.price)
        .slice(0, kind === 'support' ? 4 : 3);
    }

    const supportDetails = mergeLevels('support');
    const resistanceDetails = mergeLevels('resistance');

    return {
      // Price (Polygon close -- may be slightly stale vs Tradier real-time)
      polygonPrice: parseFloat(rawPrice.toFixed(2)),
      lastDate,
      closes,   // full array for charting
      highs,
      lows,
      volumes,

      // Technicals
      sma20:    parseFloat(sma20.toFixed(2)),
      sma50:    parseFloat(sma50.toFixed(2)),
      sma200:   parseFloat(sma200.toFixed(2)),
      above50:  rawPrice > sma50,
      above200: rawPrice > sma200,
      hv30,     // raw decimal e.g. 0.32 = 32%
      perf5,

      // Key levels (filtered to relevant side of current price)
      supports:    supportDetails.map(l => l.price),
      resistances: resistanceDetails.map(l => l.price),
      supportDetails,
      resistanceDetails,
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
    supportDetails:    history?.supportDetails    || [],
    resistanceDetails: history?.resistanceDetails || [],
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
