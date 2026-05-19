// =============================================================================
// api/analyze/index.js
// Route entry point for /api/analyze
// Validates input, fetches data, routes to strategy module, returns response.
// =============================================================================

import { fetchAllData } from './dataFetch.js';
import { applyApiHeaders, checkRateLimit, cleanTicker, handleOptions } from '../_security.js';
import { buildAnalysisSummary } from './summaryModel.js';
import { legacyIssue, sortIssues } from './signalModel.js';
import {
  analyzeCreditSpread,
  analyzeIronCondor,
  analyzeCSP,
  analyzeCoveredCall,
  analyzeButterflyBWB,
  analyzeDebitSpread,
  analyzeLongOption,
  analyzeCustomPayoff,
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

  'CUSTOM':             'custom',
};

const VERTICAL_STRATEGIES = [
  'PUT CREDIT SPREAD',
  'PUT DEBIT SPREAD',
  'CALL CREDIT SPREAD',
  'CALL DEBIT SPREAD',
];

// ---------------------------------------------------------------------------
// Date normalization -- accepts M/D/YY, MM/DD/YYYY, YYYY-MM-DD
// ---------------------------------------------------------------------------
function normalizeDate(expDate) {
  if (!expDate) return null;
  const raw = expDate.trim();
  let y, m, d;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    y = iso[1]; m = iso[2]; d = iso[3];
  } else {
    const p = raw.replace(/-/g, '/').split('/');
    if (p.length !== 3) return null;
    [m, d, y] = p;
    if (y.length === 2) y = '20' + y;
  }

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

function legQty(leg) {
  return Math.max(1, Number.parseFloat(leg?.n || leg?.qty || 1) || 1);
}

function normalizedLegs(legs = []) {
  return legs.map(leg => ({
    a: String(leg.a || leg.action || '').toUpperCase(),
    t: String(leg.t || leg.type || '').toUpperCase(),
    n: legQty(leg),
    s: Number.parseFloat(leg.s || leg.strike),
  })).filter(leg =>
    (leg.a === 'BUY' || leg.a === 'SELL') &&
    (leg.t === 'PUT' || leg.t === 'CALL') &&
    Number.isFinite(leg.s)
  );
}

function detectStrategyFromLegs(legs = []) {
  const clean = normalizedLegs(legs);
  if (clean.length === 1) {
    const only = clean[0];
    if (only.a === 'BUY' && only.t === 'CALL') return { strategy: 'LONG CALL', confidence: 'high' };
    if (only.a === 'BUY' && only.t === 'PUT') return { strategy: 'LONG PUT', confidence: 'high' };
    if (only.a === 'SELL' && only.t === 'PUT') return { strategy: 'CASH SECURED PUT', confidence: 'medium' };
    if (only.a === 'SELL' && only.t === 'CALL') return { strategy: 'COVERED CALL', confidence: 'medium' };
  }

  if (clean.length === 2 && clean.every(l => l.n === clean[0].n)) {
    const types = [...new Set(clean.map(l => l.t))];
    const buy = clean.find(l => l.a === 'BUY');
    const sell = clean.find(l => l.a === 'SELL');
    if (types.length === 1 && buy && sell && buy.s !== sell.s) {
      if (types[0] === 'PUT') {
        return {
          strategy: sell.s > buy.s ? 'PUT CREDIT SPREAD' : 'PUT DEBIT SPREAD',
          confidence: 'high',
        };
      }
      if (types[0] === 'CALL') {
        return {
          strategy: sell.s < buy.s ? 'CALL CREDIT SPREAD' : 'CALL DEBIT SPREAD',
          confidence: 'high',
        };
      }
    }
  }

  if (clean.length === 4) {
    const puts = clean.filter(l => l.t === 'PUT');
    const calls = clean.filter(l => l.t === 'CALL');
    const buyPut = puts.find(l => l.a === 'BUY');
    const sellPut = puts.find(l => l.a === 'SELL');
    const sellCall = calls.find(l => l.a === 'SELL');
    const buyCall = calls.find(l => l.a === 'BUY');
    if (puts.length === 2 && calls.length === 2 && buyPut && sellPut && sellCall && buyCall) {
      if (buyPut.s < sellPut.s && sellPut.s < sellCall.s && sellCall.s < buyCall.s) {
        return { strategy: 'IRON CONDOR', confidence: 'high' };
      }
      return {
        error: 'Iron condor legs should be ordered: long put < short put < short call < long call.',
      };
    }
  }

  return { strategy: null, confidence: 'none' };
}

function resolveStrategy(selectedStrategy, legs) {
  const detected = detectStrategyFromLegs(legs);
  if (detected.error && selectedStrategy === 'IRON CONDOR') return detected;
  if (!detected.strategy) return { strategy: selectedStrategy, detected };

  const selectedIsVertical = VERTICAL_STRATEGIES.includes(selectedStrategy);
  const detectedIsVertical = VERTICAL_STRATEGIES.includes(detected.strategy);
  if (selectedIsVertical && detectedIsVertical && selectedStrategy !== detected.strategy) {
    return {
      strategy: detected.strategy,
      detected,
      warning: `You selected ${selectedStrategy}, but these legs look like ${detected.strategy}. Analysis has been adjusted.`,
    };
  }

  if (selectedStrategy === 'CUSTOM') return { strategy: selectedStrategy, detected };
  return { strategy: selectedStrategy, detected };
}

function applySummaryRisk(result, summary) {
  const issues = Array.isArray(result.issues) ? [...result.issues] : [];
  const liq = summary?.liquidity;
  if (liq?.grade === 'Poor') {
    issues.push(legacyIssue({
      id: 'liquidity_poor_note',
      level: 'info',
      category: 'liquidity',
      scope: 'context',
      affectsSignal: false,
      message: 'Liquidity looks poor from quotes -- confirm bid/ask and fills before entry',
    }));
  } else if (liq?.grade === 'Thin') {
    issues.push(legacyIssue({
      id: 'liquidity_thin_note',
      level: 'info',
      category: 'liquidity',
      scope: 'context',
      affectsSignal: false,
      message: 'Thin option liquidity -- use limit orders and confirm fills',
    }));
  } else if (liq?.grade === 'Unknown') {
    issues.push(legacyIssue({
      id: 'liquidity_unknown_note',
      level: 'info',
      category: 'liquidity',
      scope: 'context',
      affectsSignal: false,
      message: 'Liquidity data unavailable -- confirm bid/ask before entry',
    }));
  }

  result.issues = sortIssues(issues).map(legacyIssue);
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (handleOptions(req, res, ['POST'])) return;
  applyApiHeaders(req, res, ['POST','OPTIONS']);
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRateLimit(req, res, { key: 'analyze', limit: 30 })) return;

  // ── Input validation ────────────────────────────────────────────────────
  const { ticker, legs, expDate, credit, entryType, strategy, prefs } = req.body || {};

  if (!ticker) {
    return res.status(400).json({ ok: false, error: 'Missing ticker' });
  }
  if (!strategy) {
    return res.status(400).json({ ok: false, error: 'Missing strategy' });
  }
  if (!legs || legs.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing legs' });
  }

  const tickerUpper = cleanTicker(ticker);
  if (!tickerUpper) {
    return res.status(400).json({ ok: false, error: 'Enter a valid ticker symbol' });
  }
  const strategyResolution = resolveStrategy(strategy, legs);
  if (strategyResolution.error) {
    return res.status(400).json({ ok: false, error: strategyResolution.error });
  }
  const effectiveStrategy = strategyResolution.strategy;
  const group = STRATEGY_GROUPS[effectiveStrategy];

  if (!group) {
    return res.status(400).json({ ok: false, error: `Unknown strategy: ${effectiveStrategy}` });
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
  if (expDateObj && dte < 0) {
    return res.status(400).json({
      ok: false,
      error: 'Expiration date is already past. Choose a current or future expiration.',
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
          entryType ? entryType === 'credit' : isCreditStrategy(effectiveStrategy)
        );
        break;

      case 'debit_spread':
        result = analyzeDebitSpread(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'long_option':
        result = analyzeLongOption(data, legs, expDateObj, dte, credit, prefs);
        break;

      case 'custom':
        result = analyzeCustomPayoff(data, legs, expDateObj, dte, credit, prefs, entryType !== 'debit');
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
  const summary = buildAnalysisSummary({ data, result, legs, dte, prefs });
  result = applySummaryRisk(result, summary);

  // ── Build final response ─────────────────────────────────────────────────
  return res.status(200).json({
    ok: true,
    ticker:      tickerUpper,
    strategy: effectiveStrategy,
    entryType: result.entryType || (group === 'debit_spread' || group === 'long_option' ? 'debit' : group === 'custom' ? entryType || 'credit' : 'credit'),
    selectedStrategy: strategy,
    strategyAdjusted: effectiveStrategy !== strategy,
    structureWarning: strategyResolution.warning || null,
    detectedStrategy: strategyResolution.detected?.strategy || null,
    strategyGroup: result.strategyGroup,
    summary,
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
