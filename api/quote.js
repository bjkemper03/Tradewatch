// =============================================================================
// api/quote.js -- Vercel serverless function
// Returns real-time stock quote for a single ticker
// Primary: Tradier (real-time)  |  Fallback: Polygon (15-min delayed on free tier)
// =============================================================================

const POLYGON_KEY = process.env.POLYGON_KEY;
const TRADIER_KEY = process.env.TRADIER_KEY;

async function quoteTradier(ticker) {
  const res = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${ticker}`,
    {
      headers: {
        'Authorization': `Bearer ${TRADIER_KEY}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    }
  );
  const d = await res.json();
  const q = d?.quotes?.quote;
  if (!q || q.last == null) return null;
  return {
    price:     parseFloat(q.last),
    change:    parseFloat(q.change || 0),
    changePct: parseFloat(q.change_percentage || 0),
    volume:    q.volume,
    date:      q.trade_date,
    source:    'tradier',
  };
}

async function quotePolygon(ticker) {
  // Snapshot endpoint -- prev close + last trade
  const res = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const d = await res.json();
  const t = d?.ticker;
  if (!t || t.lastTrade?.p == null) return null;
  const price  = parseFloat(t.lastTrade.p);
  const prev   = parseFloat(t.prevDay?.c || price);
  const change = parseFloat((price - prev).toFixed(2));
  return {
    price,
    change,
    changePct: prev > 0 ? parseFloat((change / prev * 100).toFixed(2)) : 0,
    volume:    t.day?.v || null,
    date:      new Date().toISOString().slice(0, 10),
    source:    'polygon',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  try {
    let quote = null;
    if (TRADIER_KEY) quote = await quoteTradier(ticker.toUpperCase());
    if (!quote)      quote = await quotePolygon(ticker.toUpperCase());
    if (!quote)      return res.status(404).json({ ok: false, error: 'Quote not found' });

    return res.status(200).json({ ok: true, ticker: ticker.toUpperCase(), ...quote });
  } catch (err) {
    console.error('Quote error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
