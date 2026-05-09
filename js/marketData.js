// =============================================================================
// marketData.js -- Frontend market data layer
// All calls go to /api/* routes -- no API keys in this file
// =============================================================================

async function fetchMarketData(force = false) {
  if (!force) {
    const cached = cacheGet(CONFIG.CK.market, CONFIG.TTL.market);
    if (cached) return cached;
  }
  const res  = await fetch(CONFIG.API.market, { signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  if (data.ok) {
    cacheSet(CONFIG.CK.market, data.data);
    return data.data;
  }
  throw new Error(data.error || 'Market fetch failed');
}

async function fetchQuote(ticker) {
  const ck = CONFIG.CK.quote + ticker;
  const cached = cacheGet(ck, CONFIG.TTL.quote);
  if (cached) return cached;

  const res  = await fetch(`${CONFIG.API.quote}?ticker=${ticker}`, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (data.ok) {
    cacheSet(ck, data);
    return data;
  }
  return null;
}

async function fetchEarnings(ticker) {
  const ck = CONFIG.CK.earnings + ticker;
  const cached = cacheGet(ck, CONFIG.TTL.earnings);
  if (cached !== null) return cached;

  const res  = await fetch(`${CONFIG.API.earnings}?ticker=${ticker}`, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  const result = data.ok ? { date: data.date, clear: data.clear } : null;
  cacheSet(ck, result);
  return result;
}

async function fetchAnalysis(ticker, legs, expDate, credit, strategy) {
  const res = await fetch(CONFIG.API.analyze, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, legs, expDate, credit, strategy }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Analysis failed');
  return data;
}

async function fetchLivePricesForOpenTrades(trades) {
  const tickers = [...new Set(trades.filter(t => t.status === 'OPEN').map(t => t.ticker))];
  const results = {};
  for (const ticker of tickers) {
    const q = await fetchQuote(ticker);
    if (q) results[ticker] = q;
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}
