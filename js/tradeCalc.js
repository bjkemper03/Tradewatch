// =============================================================================
// js/tradeCalc.js -- Trade math: parsing, collateral, breakeven, BWB
// Loaded as a plain script -- all functions are global.
// No imports/exports. Depends on: STRAT_GROUPS and prefs from js/config.js.
// =============================================================================

// ---------------------------------------------------------------------------
// Date and number utilities
// ---------------------------------------------------------------------------
function safeNum(v, fb) {
  if (fb === undefined) fb = 0;
  var n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}

function parseExp(str) {
  if (!str) return null;
  var raw = str.trim();
  var m, d, y;
  var iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    y = iso[1]; m = iso[2]; d = iso[3];
  } else {
    var p = raw.replace(/-/g, '/').split('/');
    if (p.length !== 3) return null;
    m = p[0]; d = p[1]; y = p[2];
    if (y.length === 2) y = '20' + y;
  }
  if (m.length < 2) m = m.padStart(2, '0');
  if (d.length < 2) d = d.padStart(2, '0');
  var dt = new Date(y + '-' + m + '-' + d + 'T16:00:00');
  return isNaN(dt.getTime()) ? null : dt;
}

function calcDTE(expStr) {
  var d = parseExp(expStr);
  if (!d) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

function isDebitStrat(s) {
  // Falls back gracefully if STRAT_GROUPS not yet defined
  if (typeof STRAT_GROUPS !== 'undefined' && STRAT_GROUPS.DEBIT) {
    return STRAT_GROUPS.DEBIT.includes(s);
  }
  return ['PUT DEBIT SPREAD','CALL DEBIT SPREAD','LONG PUT','LONG CALL',
          'PUT BUTTERFLY','CALL BUTTERFLY','IRON BUTTERFLY'].includes(s);
}

// ---------------------------------------------------------------------------
// Black-Scholes helpers (frontend fallback when Tradier Greeks unavailable)
// ---------------------------------------------------------------------------
function ncdf(x) {
  var a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  var p = 0.3275911;
  var sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  var t2 = 1 / (1 + p * x);
  var y = 1 - (((((a[4]*t2+a[3])*t2+a[2])*t2+a[1])*t2+a[0])*t2*Math.exp(-x*x));
  return 0.5 * (1 + sgn * y);
}

function bsDelta(S, K, T, sig, type) {
  if (type === undefined) type = 'put';
  if (!S || !K || !T || !sig || T <= 0 || sig <= 0) return null;
  var d1 = (Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}

// ---------------------------------------------------------------------------
// Collateral calculation -- strategy-aware
// ---------------------------------------------------------------------------
function payoffAtExpiry(legs, px, netPremium, includeShares, shareBasis) {
  var pnl = safeNum(netPremium) * 100;
  if (includeShares) pnl += (px - safeNum(shareBasis)) * 100;
  legs.forEach(function(leg) {
    var strike = safeNum(leg.s);
    if (!strike) return;
    var qty = Math.max(1, safeNum(leg.n || 1, 1));
    var intrinsic = leg.t === 'CALL' ? Math.max(0, px - strike) : Math.max(0, strike - px);
    pnl += (leg.a === 'BUY' ? 1 : -1) * intrinsic * qty * 100;
  });
  return pnl;
}

function estimatePayoffRisk(strat, legs, cr, entryType) {
  var valid = legs.filter(function(l) { return safeNum(l.s) > 0; });
  if (!valid.length || valid.length !== legs.length) return null;
  var netPremium = entryType === 'debit' ? -safeNum(cr) : safeNum(cr);
  var includeShares = strat === 'COVERED CALL';
  var shareBasis = 0;
  var strikes = valid.map(function(l) { return safeNum(l.s); }).concat([0]);
  var highSlope = includeShares ? 100 : 0;
  valid.forEach(function(l) {
    if (l.t === 'CALL') highSlope += (l.a === 'BUY' ? 1 : -1) * Math.max(1, safeNum(l.n || 1, 1)) * 100;
  });
  var points = strikes.map(function(px) {
    return payoffAtExpiry(valid, px, netPremium, includeShares, shareBasis);
  });
  if (highSlope < 0) return { maxLoss: null, unlimited: true };
  var minPnl = Math.min.apply(null, points);
  return { maxLoss: Math.max(0, -minPnl), unlimited: false };
}

function calcCollateral(strat, legs, cr, entryType) {
  if (!entryType) entryType = isDebitStrat(strat) ? 'debit' : 'credit';
  var engineRisk = estimatePayoffRisk(strat, legs, cr, entryType);
  if (engineRisk && !engineRisk.unlimited) return engineRisk.maxLoss;

  var sells  = legs.filter(function(l) { return l.a === 'SELL'; });
  var buys   = legs.filter(function(l) { return l.a === 'BUY'; });
  var allLegs = sells.concat(buys);
  var contracts = allLegs.length
    ? Math.max.apply(null, allLegs.map(function(l) { return l.n || 1; }).concat([1]))
    : 1;
  var credit = safeNum(cr);
  var allStrikes = sells.concat(buys).map(function(l) { return safeNum(l.s); });

  if (allStrikes.some(function(s) { return s <= 0; })) return 0;

  if (strat === 'CASH SECURED PUT') {
    return safeNum(sells[0] && sells[0].s) * 100;
  }
  if (strat === 'COVERED CALL') {
    return 0; // collateral is shares already owned
  }
  if (['PUT BUTTERFLY','CALL BUTTERFLY','PUT RATIO SPREAD','CALL RATIO SPREAD'].includes(strat)) {
    return 0; // Unlimited or incomplete estimate; backend gives final risk after analysis.
  }
  if (strat === 'IRON CONDOR' || strat === 'IRON BUTTERFLY') {
    var puts      = legs.filter(function(l) { return l.t === 'PUT'; });
    var calls     = legs.filter(function(l) { return l.t === 'CALL'; });
    var putSell   = puts.find(function(l)  { return l.a === 'SELL'; });
    var putBuy    = puts.find(function(l)  { return l.a === 'BUY'; });
    var callSell  = calls.find(function(l) { return l.a === 'SELL'; });
    var callBuy   = calls.find(function(l) { return l.a === 'BUY'; });
    var putW  = (putSell  && putBuy)  ? Math.abs(safeNum(putSell.s)  - safeNum(putBuy.s))  : 0;
    var callW = (callSell && callBuy) ? Math.abs(safeNum(callSell.s) - safeNum(callBuy.s)) : 0;
    var maxW  = Math.max(putW, callW);
    return maxW > 0 ? Math.max(0, (maxW - credit) * 100 * contracts) : 0;
  }
  if (strat === 'LONG PUT' || strat === 'LONG CALL') {
    return credit * 100 * contracts;
  }
  // Default: vertical spread
  if (sells.length > 0 && buys.length > 0) {
    var w = Math.abs(safeNum(sells[0] && sells[0].s) - safeNum(buys[0] && buys[0].s));
    if (w <= 0) return 0;
    return Math.max(0, (w - credit) * 100 * contracts);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Cushion color helper
// ---------------------------------------------------------------------------
function cushC(p) {
  var min = (typeof prefs !== 'undefined') ? prefs.cushionMin : 5;
  if (p >= min + 2) return '#22c55e';
  if (p >= min)     return '#f59e0b';
  return '#ef4444';
}
