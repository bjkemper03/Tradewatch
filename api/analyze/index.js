// =============================================================================
// api/analyze/index.js
// Route entry point for /api/analyze
// Validates input, fetches data, routes to strategy module, returns response.
// =============================================================================

import { fetchAllData } from './dataFetch.js';
import {
  analyzeCreditSpread,
  analyzeIronCondor,
  analyzeCSP,
  analyzeCoveredCall,
  analyzeButterflyBWB,
  analyzeDebitSpread,
  analyzeLongOption,
} from './strategies.js';

// ---------------------------------------------------------------------------
// Strategy routing map
// ---------------------------------------------------------------------------
const STRATEGY_GROUPS = {
  // Credit spreads
  'PUT CREDIT SPREAD':  'credit_spread',
  'CALL CREDIT SPREAD': 'credit_spread',

  // Iron structures
  'IRON CONDOR':        'iron_condor',
  'IRON BUTTERFLY':     'iron_condor',   // same logic, flagged internally

  // Wheel strategies
  'CASH SECURED PUT':   'csp',
  'COVERED CALL':       'covered_call',

  // Butterfly family
  'PUT BUTTERFLY':      'butterfly_bwb',
  'CALL BUTTERFLY':     'butterfly_bwb',
  'PUT RATIO SPREAD':   'butterfly_bwb',
  'CALL RATIO SPREAD':  'butterfly_bwb',

  // Debit spreads
  'PUT DEBIT SPREAD':   'debit_spread',
  'CALL DEBIT SPREAD':  'debit_spread',

  // Long options
  'LONG PUT':           'long_option',
  'LONG CALL':          'long_option',

  // Custom -- attempt generic credit spread logic
  'CUSTOM':             'credit_spread',
};

// ---------------------------------------------------------------------------
// Date normalization -- accepts M/D/YY, MM/DD/YYYY, YYYY-MM-DD
// ---------------------------------------------------------------------------
function normalizeDate(expDate) {
  if (!expDate) return null;
  const s = expDate.trim().replace(/-/g, '/');
  const p = s.split('/');
  if (p.length !== 3) return null;
  let [m, d, y] = p;
  if (y.length === 2) y = '20' + y;
  const formatted = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const dt = new Date(formatted + 'T16:00:00');
  return isNaN(dt.getTime()) ? null : { formatted, obj: dt };
}

// ---------------------------------------------------------------------------
// Is this a credit or debit strategy?
// ---------------------------------------------------------------------------
function isCreditStrategy(strategy) {
  return [
    'PUT CREDIT SPREAD', 'CALL CREDIT SPREAD',
    'IRON CONDOR', 'IRON BUTTERFLY',
    'CASH SECURED PUT', 'COVERED CALL',
    'PUT RATIO SPREAD', 'CALL RATIO SPREAD',
  ].includes(strategy);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Input validation ────────────────────────────────────────────────────
  const { ticker, legs, expDate, credit, strategy, prefs } = req.body || {};

  if (!ticker) {
    return res.status(400).json({ ok: false, error: 'Missing ticker' });
  }
  if (!strategy) {
    return res.status(400).json({ ok: false, error: 'Missing strategy' });
  }
  if (!legs || legs.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing legs' });
  }

  const tickerUpper = ticker.toUpperCase().trim();
  const group = STRATEGY_GROUPS[strategy];

  if (!group) {
    return res.status(400).json({ ok: false, error: `Unknown strategy: ${strategy}` });
  }

  // ── Date parsing ────────────────────────────────────────────────────────
  const dateResult = normalizeDate(expDate);
  const expFormatted = dateResult?.formatted || null;
  const expDateObj   = dateResult?.obj       || null;
  const dte = expDateObj
    ? Math.ceil((expDateObj - new Date()) / 86400000)
    : null;

  if (expDate && !expFormatted) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid expiration date. Use format: 5/23/26 or 2026-05-23',
    });
  }

  // ── Fetch all data ──────────────────────────────────────────────────────
  let data;
  try {
    data = await fetchAllData(tickerUpper, expFormatted);
  } catch (err) {
    console.error('[analyze] Data fetch error:', err);
    return res.status(502).json({ ok: false, error: 'Failed to fetch market data. Try again.' });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: `No price data found for ${tickerUpper}. Check the ticker symbol.`,
    });
  }

  // ── Route to strategy module ────────────────────────────────────────────
  let result;
  try {
    switch (group) {
      case 'credit_spread':
        result = analyzeCreditSpread(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'iron_condor':
        result = analyzeIronCondor(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'csp':
        result = analyzeCSP(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'covered_call':
        result = analyzeCoveredCall(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'butterfly_bwb':
        result = analyzeButterflyBWB(
          data, legs, expDateObj, dte, credit, prefs,
          isCreditStrategy(strategy)
        );
        break;

      case 'debit_spread':
        result = analyzeDebitSpread(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'long_option':
        result = analyzeLongOption(data, legs, expDateObj, dte, credit, prefs);
        break;

      default:
        return res.status(400).json({ ok: false, error: 'Unhandled strategy group' });
    }
  } catch (err) {
    console.error('[analyze] Strategy error:', err);
    return res.status(500).json({ ok: false, error: 'Analysis error: ' + err.message });
  }

  // ── Handle strategy-level errors ────────────────────────────────────────
  if (result.error) {
    return res.status(400).json({ ok: false, error: result.error });
  }

  // ── Build final response ─────────────────────────────────────────────────
  return res.status(200).json({
    ok: true,
    ticker:      tickerUpper,
    strategy,
    strategyGroup: result.strategyGroup,
    dte,
    expDate:     expFormatted,
    lastDate:    data.lastDate,

    // Common fields always present
    price:       data.price,
    hv30:        data.hv30 ? parseFloat((data.hv30 * 100).toFixed(1)) : null,
    sma20:       data.sma20,
    sma50:       data.sma50,
    sma200:      data.sma200,
    above50:     data.above50,
    above200:    data.above200,
    supports:    data.supports,
    resistances: data.resistances,
    supportDetails:    data.supportDetails,
    resistanceDetails: data.resistanceDetails,

    // Strategy-specific results (spread onto response)
    ...result,

    // Clean up -- remove raw data arrays from response to keep it lean
    closes:  undefined,
    history: undefined,
    chain:   undefined,
    quote:   undefined,

    fetchedAt: new Date().toISOString(),
  });
}
