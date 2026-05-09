// =============================================================================
// api/market.js -- Vercel serverless function
// Fetches SPY, QQQ, HYG, RSP, VIX, Fear & Greed
// Primary: Polygon.io  |  VIX: Yahoo Finance  |  F&G: CNN
// API keys live in Vercel environment variables -- never in frontend code
// =============================================================================

const POLYGON_KEY = process.env.POLYGON_KEY;

async function fetchPolygonDaily(sym) {
  // Get last 200 trading days of OHLCV
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url  = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=200&apiKey=${POLYGON_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const d   = await res.json();

  if (!d.results || d.results.length === 0) return null;

  const closes = d.results.map(r => r.c);
  const highs  = d.results.map(r => r.h);
  const lows   = d.results.map(r => r.l);
  const price  = closes[0];
  const lastDate = new Date(d.results[0].t).toISOString().slice(0, 10);

  const n20  = Math.min(20,  closes.length);
  const n50  = Math.min(50,  closes.length);
  const n200 = Math.min(200, closes.length);
  const sma20  = closes.slice(0, n20).reduce((a, b)  => a + b, 0) / n20;
  const sma50  = closes.slice(0, n50).reduce((a, b)  => a + b, 0) / n50;
  const sma200 = closes.slice(0, n200).reduce((a, b) => a + b, 0) / n200;
  const perf5  = closes.length > 5
    ? parseFloat(((price - closes[5]) / closes[5] * 100).toFixed(2))
    : 0;

  // HV30
  const sl  = closes.slice(0, 31);
  const ret = sl.slice(0, -1).map((c, i) => Math.log(c / sl[i + 1]));
  const m   = ret.reduce((a, b) => a + b, 0) / ret.length;
  const v   = ret.reduce((a, r) => a + Math.pow(r - m, 2), 0) / (ret.length - 1);
  const hv30 = Math.sqrt(v * 252);

  // Support / resistance
  const supports    = new Set([Math.round(sma20 * 4) / 4, Math.round(sma50 * 4) / 4]);
  const resistances = new Set();
  for (let i = 2; i < Math.min(25, lows.length - 2); i++) {
    if (lows[i] < lows[i-1] && lows[i] < lows[i+1] && lows[i] < lows[i-2])
      supports.add(Math.round(lows[i] * 4) / 4);
    if (highs[i] > highs[i-1] && highs[i] > highs[i+1])
      resistances.add(Math.round(highs[i] * 4) / 4);
  }

  return {
    price:    parseFloat(price.toFixed(2)),
    closes,
    sma20:    parseFloat(sma20.toFixed(2)),
    sma50:    parseFloat(sma50.toFixed(2)),
    sma200:   parseFloat(sma200.toFixed(2)),
    above50:  price > sma50,
    above200: price > sma200,
    perf5,
    hv30,
    lastDate,
    supports:    [...supports].filter(s => s < price).sort((a, b) => b - a).slice(0, 3),
    resistances: [...resistances].filter(r => r > price).sort((a, b) => a - b).slice(0, 2),
  };
}

async function fetchVIX() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=15d';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const d  = await res.json();
    const pr = d.chart.result[0].indicators.quote[0].close.filter(Boolean);
    const ts = d.chart.result[0].timestamp;
    const cur    = pr[pr.length - 1];
    const prev5  = pr[Math.max(0, pr.length - 6)];
    const date   = new Date(ts[ts.length - 1] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { level: parseFloat(cur.toFixed(2)), chg: parseFloat(((cur - prev5) / prev5 * 100).toFixed(1)), date, ok: true };
  } catch (e) {
    return { level: null, chg: 0, date: 'N/A', ok: false };
  }
}

async function fetchFearGreed() {
  try {
    const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.cnn.com/' },
    });
    const d = await res.json();
    const score = d.fear_and_greed?.score;
    if (score === undefined) return null;
    return { score: Math.round(score), rating: d.fear_and_greed?.rating || 'N/A' };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [vix, fg, spy, qqq, hyg, rsp] = await Promise.all([
      fetchVIX(),
      fetchFearGreed(),
      fetchPolygonDaily('SPY'),
      fetchPolygonDaily('QQQ'),
      fetchPolygonDaily('HYG'),
      fetchPolygonDaily('RSP'),
    ]);

    return res.status(200).json({
      ok: true,
      data: { vix, fg, spy, qqq, hyg, rsp },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Market fetch error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
