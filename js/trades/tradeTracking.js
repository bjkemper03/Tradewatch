// =============================================================================
// js/trades/tradeTracking.js -- Trade tracking/risk helpers
// =============================================================================
function tradeAnalysis(t) {
  return (t && t.analysis) || {};
}

function fmtSignedPct(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtTradeMoney(v, cents) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(cents ? 2 : 0);
}

function trackingLineLabel(line) {
  if (!line) return 'RISK LINE';
  if (line.price != null) return line.label.toUpperCase() + ' $' + safeNum(line.price).toFixed(2);
  if (line.put != null && line.call != null) {
    return 'SHORTS $' + safeNum(line.put).toFixed(2) + ' / $' + safeNum(line.call).toFixed(2);
  }
  return line.label.toUpperCase();
}

function trackingMetricLabel(strat, line, isDebit) {
  if (line && line.put != null && line.call != null) return 'Distance to tested side';
  if (line && line.label === 'short strike') {
    if (strat === 'CALL CREDIT SPREAD' || strat === 'COVERED CALL') return 'Distance to short call';
    return 'Cushion to short put';
  }
  if (isDebit || (line && line.label === 'breakeven')) return 'Distance to breakeven';
  return 'Distance to risk line';
}

function primaryLegType(t) {
  var legs = t.legs || [];
  var put = legs.find(function(l) { return l.t === 'PUT'; });
  var call = legs.find(function(l) { return l.t === 'CALL'; });
  return put ? 'PUT' : call ? 'CALL' : '';
}

function trackingLine(t) {
  var a = tradeAnalysis(t);
  var legs = t.legs || [];
  var strat = t.strategy || '';
  var isDebit = t.entryType === 'debit' || isDebitStrat(strat);
  var sellPut = legs.find(function(l) { return l.a === 'SELL' && l.t === 'PUT'; });
  var sellCall = legs.find(function(l) { return l.a === 'SELL' && l.t === 'CALL'; });
  var sell = legs.find(function(l) { return l.a === 'SELL'; });
  var buy = legs.find(function(l) { return l.a === 'BUY'; });
  if (isDebit && a.breakeven != null) return { price: safeNum(a.breakeven), label: 'breakeven' };
  if (isDebit && t.breakeven != null) return { price: safeNum(t.breakeven), label: 'breakeven' };
  if (a.shortStrike != null) return { price: safeNum(a.shortStrike), label: 'short strike' };
  if (a.shortPut != null && a.shortCall != null) {
    return { price: null, label: 'short strikes', put: safeNum(a.shortPut), call: safeNum(a.shortCall) };
  }
  if (!isDebit && sellPut && sellCall) {
    return { price: null, label: 'short strikes', put: safeNum(sellPut.s), call: safeNum(sellCall.s) };
  }
  if (!isDebit && sell && sell.s) return { price: safeNum(sell.s), label: 'short strike' };
  if (a.breakeven != null) return { price: safeNum(a.breakeven), label: 'breakeven' };
  if (t.breakeven != null) return { price: safeNum(t.breakeven), label: 'breakeven' };
  if ((strat === 'LONG PUT' || strat === 'LONG CALL') && buy && buy.s) return { price: safeNum(buy.s), label: 'strike' };
  return { price: null, label: 'risk line' };
}

function tradeTracking(t, curPx, hasLive) {
  var line = trackingLine(t);
  var strat = t.strategy || '';
  var type = primaryLegType(t);
  var isPut = type === 'PUT';
  var isDebit = t.entryType === 'debit' || isDebitStrat(strat);
  var val = null;
  var context = 'Tracking unavailable until a risk line is known.';
  var label = trackingMetricLabel(strat, line, isDebit);

  if (line.put != null && line.call != null && curPx > 0) {
    var putGap = (curPx - line.put) / curPx * 100;
    var callGap = (line.call - curPx) / curPx * 100;
    val = parseFloat(Math.min(putGap, callGap).toFixed(1));
    context = val >= 0
      ? 'Inside the short-strike range; closest side is the tested side.'
      : 'Outside the short-strike range; trade needs price back inside.';
  } else if (line.price != null && curPx > 0) {
    var direction;
    if (strat === 'CALL CREDIT SPREAD' || strat === 'COVERED CALL') direction = -1;
    else if (strat === 'LONG CALL' || strat === 'CALL DEBIT SPREAD') direction = 1;
    else if (strat === 'LONG PUT' || strat === 'PUT DEBIT SPREAD') direction = -1;
    else direction = isPut ? 1 : -1;

    val = direction > 0
      ? parseFloat(((curPx - line.price) / curPx * 100).toFixed(1))
      : parseFloat(((line.price - curPx) / curPx * 100).toFixed(1));

    if (isDebit) {
      context = val >= 0
        ? 'Currently beyond ' + line.label + '; has room before the trade falls back under breakeven.'
        : 'Needs about ' + Math.abs(val).toFixed(1) + '% move to reach ' + line.label + '; until then, debit trades still carry full-premium loss risk.';
    } else {
      context = val >= 0
        ? 'Price is on the favorable side of the tested line.'
        : 'Price is through the tested line; needs to move back out or loss risk grows.';
    }
  }

  var dte = t.currentDTE;
  var status;
  if (val == null) status = { label:'TRACK', color:'var(--text3)', cls:'warn' };
  else if (dte != null && dte <= 5 && val < 2) status = { label:'TIME RISK', color:'#ef4444', cls:'risk' };
  else if (val >= prefs.cushionMin + 2) status = { label:'ON TRACK', color:'#22c55e', cls:'safe' };
  else if (val >= 0) status = { label:'MONITOR', color:'#f59e0b', cls:'warn' };
  else status = { label: isDebit ? 'NEEDS MOVE' : 'AT RISK', color:'#ef4444', cls:'risk' };

  return { value: val, label: label, context: context, line: line, status: status, hasLive: hasLive };
}


function calcTradeCushion(t, price, breakeven) {
  if (!price || !breakeven) return null;
  if (t.strategy === 'LONG PUT' || t.strategy === 'PUT DEBIT SPREAD') return parseFloat(((breakeven - price) / price * 100).toFixed(1));
  if (t.strategy === 'LONG CALL' || t.strategy === 'CALL DEBIT SPREAD' || t.strategy === 'CALL CREDIT SPREAD' || t.strategy === 'COVERED CALL') {
    return parseFloat(((breakeven - price) / price * 100).toFixed(1));
  }
  return parseFloat(((price - breakeven) / price * 100).toFixed(1));
}
