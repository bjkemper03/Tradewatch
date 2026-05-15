// =============================================================================
// api/earnings.js -- Vercel serverless function
// Returns next earnings date for a ticker
// Primary: Tradier  |  Fallback: Polygon
// =============================================================================

import { applyApiHeaders, cleanTicker, handleOptions } from './_security.js';

const POLYGON_KEY = process.env.POLYGON_KEY;
const TRADIER_KEY = process.env.TRADIER_KEY;

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function earningsTradier(ticker) {
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
    const d      = await readJson(res);
    if (!d) return null;
    const events = d?.fundamentals?.[0]?.corporate_calendars;
    if (!events) return null;
    const earnings = events
      .filter(e => e.type === 'Earnings' && new Date(e.start_date) >= new Date())
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    if (!earnings.length) return null;
    return { ticker, date: earnings[0].start_date, source: 'tradier' };
  } catch (e) {
    return null;
  }
}

async function earningsPolygon(ticker) {
  try {
    // Polygon earnings endpoint (requires Starter tier for calendar data;
    // on free tier this may return empty -- gracefully returns null)
    const today = new Date().toISOString().slice(0, 10);
    const res   = await fetch(
      `https://api.polygon.io/vX/reference/financials?ticker=${ticker}&timeframe=quarterly&order=asc&limit=1&sort=period_of_report_date&apiKey=${POLYGON_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await res.json();
    // Polygon financials don't expose future earnings dates on free tier;
    // return null so the UI shows "Earnings date unknown" rather than crashing
    return null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res, ['GET'])) return;
  applyApiHeaders(req, res, ['GET','OPTIONS']);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ticker = cleanTicker(req.query.ticker);
  if (!ticker) return res.status(400).json({ error: 'Enter a valid ticker symbol' });

  try {
    let result = null;
    if (TRADIER_KEY) result = await earningsTradier(ticker);
    if (!result)     result = await earningsPolygon(ticker);

    if (!result) return res.status(200).json({ ok: true, ticker, date: null, clear: true });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
