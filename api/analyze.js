// =============================================================================
// api/analyze.js -- Vercel serverless function
// Full pre-trade analysis: price, delta, IV, earnings, support/resistance
// Primary data: Polygon  |  Options chain + earnings: Tradier
// =============================================================================

const POLYGON_KEY = process.env.POLYGON_KEY;
const TRADIER_KEY = process.env.TRADIER_KEY;

// ---------------------------------------------------------------------------
// Black-Scholes helpers
// ---------------------------------------------------------------------------
function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x));
  return 0.5 * (1 + sgn * y);
}

function bsDelta(S, K, T, sig, type = 'put') {
  if (!S || !K || !T || !sig || T <= 0 || sig <= 0) return null;
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}

// ---------------------------------------------------------------------------
// Polygon -- daily OHLCV + technicals
// ---------------------------------------------------------------------------
async function getPolygonDaily(ticker) {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url  = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=200&apiKey=${POLYGON_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const d   = await res.json();
  if (!d.results || d.results.length === 0) return null;

  const closes = d.results.map(r => r.c);
  const highs  = d.results.map(r => r.h);
  const lows   = d.results.map(r => r.l);
  const price  = closes[0];

  const n20  = Math.min(20, closes.length);
  const n50  = Math.min(50, closes.length);
  const sma20 = closes.slice(0, n20).reduce((a, b) => a + b, 0) / n20;
  const sma50 = closes.slice(0, n50).reduce((a, b) => a + b, 0) / n50;

  // HV30
  const sl   = closes.slice(0, 31);
  const ret  = sl.slice(0, -1).map((c, i) => Math.log(c / sl[i + 1]));
  const m    = ret.reduce((a, b) => a + b, 0) / ret.length;
  const v    = ret.reduce((a, r) => a + Math.pow(r - m, 2), 0) / (ret.length - 1);
  const hv30 = Math.sqrt(v * 252);

  // Key levels
  const supports    = new Set([Math.round(sma20*4)/4, Math.round(sma50*4)/4]);
  const resistances = new Set();
  for (let i = 2; i < Math.min(25, lows.length - 2); i++) {
    if (lows[i] < lows[i-1] && lows[i] < lows[i+1] && lows[i] < lows[i-2])
      supports.add(Math.round(lows[i]*4)/4);
    if (highs[i] > highs[i-1] && highs[i] > highs[i+1])
      resistances.add(Math.round(highs[i]*4)/4);
  }

  return {
    price:       parseFloat(price.toFixed(2)),
    hv30,
    sma20:       parseFloat(sma20.toFixed(2)),
    sma50:       parseFloat(sma50.toFixed(2)),
    lastDate:    new Date(d.results[0].t).toISOString().slice(0, 10),
    supports:    [...supports].filter(s => s < price).sort((a, b) => b - a).slice(0, 3),
    resistances: [...resistances].filter(r => r > price).sort((a, b) => a - b).slice(0, 2),
  };
}

// ---------------------------------------------------------------------------
// Tradier -- options chain with greeks
// ---------------------------------------------------------------------------
async function getOptionsChain(ticker, expDate) {
  if (!TRADIER_KEY) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/options/chains?symbol=${ticker}&expiration=${expDate}&greeks=true`,
      {
        headers: {
          'Authorization': `Bearer ${TRADIER_KEY}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    const d = await res.json();
    return d?.options?.option || null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tradier -- earnings calendar
// ---------------------------------------------------------------------------
async function getEarningsTradier(ticker) {
  if (!TRADIER_KEY) return null;
  try {
    const res = await fetch(
      `https://api.tradier.com/v1/markets/fundamentals/calendars?symbols=${ticker}`,
      {
        headers: {
          'Authorization': `Bearer ${TRADIER_KEY}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    const d      = await res.json();
    const events = d?.fundamentals?.[0]?.corporate_calendars;
    if (!events) return null;
    const earnings = events
      .filter(e => e.type === 'Earnings' && new Date(e.start_date) >= new Date())
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    return earnings.length ? { date: earnings[0].start_date } : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ticker, legs, expDate, credit, strategy } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    // Normalize expiration to YYYY-MM-DD
    let expFormatted = expDate;
    if (expDate) {
      const parts = expDate.replace(/-/g, '/').split('/');
      if (parts.length === 3) {
        let [m, d, y] = parts;
        if (y.length === 2) y = '20' + y;
        expFormatted = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }
    }
    const expDateObj = expFormatted ? new Date(expFormatted + 'T16:00:00') : null;
    const dte = expDateObj ? Math.ceil((expDateObj - new Date()) / 86400000) : null;

    // Fetch in parallel
    const [stockData, earnings, optionsChain] = await Promise.all([
      getPolygonDaily(ticker),
      getEarningsTradier(ticker),
      expFormatted && TRADIER_KEY ? getOptionsChain(ticker, expFormatted) : Promise.resolve(null),
    ]);

    if (!stockData) return res.status(404).json({ ok: false, error: 'No price data for ' + ticker });

    const { price, hv30, sma20, sma50, lastDate, supports, resistances } = stockData;

    // Short leg identification
    const shortLeg    = legs?.find(l => l.a === 'SELL');
    const shortStrike = shortLeg ? parseFloat(shortLeg.s) : 0;
    const optType     = (shortLeg?.t || 'PUT').toLowerCase();

    // Delta -- real chain first, Black-Scholes fallback
    let absDelta = null, deltaSource = 'BS';
    if (optionsChain && shortStrike > 0) {
      const match = optionsChain.find(o =>
        o.option_type === optType[0].toUpperCase() &&
        Math.abs(parseFloat(o.strike) - shortStrike) < 0.26
      );
      if (match?.greeks?.delta != null) {
        absDelta    = Math.abs(match.greeks.delta);
        deltaSource = 'Tradier';
      }
      if (match?.greeks?.mid_iv) {
        stockData.iv = parseFloat((match.greeks.mid_iv * 100).toFixed(1));
      }
    }
    if (absDelta === null && shortStrike > 0 && price > 0 && dte) {
      const bd = bsDelta(price, shortStrike, dte / 365, hv30, optType);
      if (bd !== null) absDelta = Math.abs(bd);
    }

    // Earnings risk check
    let earningsRisk = false;
    if (earnings?.date && expDateObj) {
      const ed = new Date(earnings.date + 'T12:00:00');
      if (ed <= expDateObj) earningsRisk = true;
    }

    // Spread metrics
    const sells       = legs?.filter(l => l.a === 'SELL') || [];
    const buys        = legs?.filter(l => l.a === 'BUY')  || [];
    const spreadWidth = sells.length > 0 && buys.length > 0
      ? Math.abs(parseFloat(sells[0].s) - parseFloat(buys[0].s))
      : 0;
    const cr         = parseFloat(credit) || 0;
    const crWidthPct = spreadWidth > 0 && cr > 0
      ? parseFloat((cr / spreadWidth * 100).toFixed(1))
      : null;
    const cushionPct = price > 0 && shortStrike > 0
      ? parseFloat(((price - shortStrike) / price * 100).toFixed(1))
      : null;
    const breakeven  = shortStrike > 0 && cr > 0
      ? parseFloat((shortStrike - cr).toFixed(2))
      : null;
    const beCushion  = price > 0 && breakeven
      ? parseFloat(((price - breakeven) / price * 100).toFixed(1))
      : null;
    const em = price && hv30 && dte
      ? parseFloat((price * hv30 * Math.sqrt(dte / 365)).toFixed(2))
      : null;
    const strikeOutsideEM = em && shortStrike > 0 && price > 0
      ? (price - shortStrike) > em
      : null;
    const exitSignal = supports.length > 0 ? supports[0] : null;

    return res.status(200).json({
      ok: true,
      ticker,
      strategy,
      price,
      lastDate,
      hv30:            parseFloat((hv30 * 100).toFixed(1)),
      iv:              stockData.iv || null,
      sma20,
      sma50,
      supports,
      resistances,
      dte,
      absDelta:        absDelta ? parseFloat(absDelta.toFixed(4)) : null,
      deltaSource,
      cushionPct,
      beCushion,
      breakeven,
      crWidthPct,
      spreadWidth,
      em,
      strikeOutsideEM,
      earningsRisk,
      earningsDate:    earnings?.date || null,
      earningsClear:   !earningsRisk,
      exitSignal,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
