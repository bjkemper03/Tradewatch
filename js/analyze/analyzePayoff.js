// =============================================================================
// js/analyze/analyzePayoff.js -- Analyze payoff chart rendering
// =============================================================================

var payoffShapeData = null;

function estimatePayoff(d, px) {
  var legs = analysisLegs(d);
  if (!legs.length) {
    if (d.payoff && d.payoff.points && d.payoff.points.length) {
      var pts = d.payoff.points;
      if (px <= pts[0].px) return pts[0].pnl;
      if (px >= pts[pts.length - 1].px) return pts[pts.length - 1].pnl;
      for (var j = 1; j < pts.length; j++) {
        if (px <= pts[j].px) {
          var a = pts[j - 1];
          var b = pts[j];
          var span = b.px - a.px;
          if (!span) return b.pnl;
          return a.pnl + (b.pnl - a.pnl) * ((px - a.px) / span);
        }
      }
    }
    return null;
  }
  var premium = safeNum(d.entryPremium ?? d.credit ?? d.prem ?? d.debit ?? 0);
  var entryType = d.entryType || (isDebitStrat(d.strategy) ? 'debit' : 'credit');
  var qtys = legs.map(function(l) { return Math.max(1, safeNum(l.n || l.qty || 1, 1)); });
  var premiumContracts = qtys.length && qtys.every(function(q) { return Math.abs(q - qtys[0]) < 0.0001; })
    ? qtys[0]
    : 1;
  var netPremium = entryType === 'debit' ? -premium : premium;
  var pnl = netPremium * 100 * premiumContracts;
  if (d.strategy === 'COVERED CALL') pnl += (px - d.price) * 100;
  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];
    var strike = safeNum(leg.s);
    if (!strike) return null;
    var qty = safeNum(leg.n || 1, 1);
    var intrinsic = leg.t === 'CALL' ? Math.max(0, px - strike) : Math.max(0, strike - px);
    pnl += (leg.a === 'BUY' ? 1 : -1) * intrinsic * qty * 100;
  }
  return pnl;
}

function payoffShapeMove(e, svg) {
  if (!payoffShapeData || !svg) return;
  var rect = svg.getBoundingClientRect();
  var clientX = e.clientX;
  if (e.touches && e.touches[0]) clientX = e.touches[0].clientX;
  var rel = (clientX - rect.left) / rect.width;
  rel = Math.max(0, Math.min(1, rel));

  var d = payoffShapeData;
  var stock = d.low + (d.high - d.low) * rel;
  var pnl = estimatePayoff(d.result, stock);
  if (pnl == null || !Number.isFinite(pnl)) return;

  var sx = d.pad + (stock - d.low) / (d.high - d.low) * (d.w - d.pad * 2);
  var sy = d.h - d.pad - (pnl - d.minY) / (d.maxY - d.minY) * (d.h - d.pad * 2);
  var line = $('payoff-cursor-line');
  var dot = $('payoff-cursor-dot');
  var tip = $('payoff-tip');
  if (line) {
    line.setAttribute('x1', sx.toFixed(1));
    line.setAttribute('x2', sx.toFixed(1));
    line.style.display = 'block';
  }
  if (dot) {
    dot.setAttribute('cx', sx.toFixed(1));
    dot.setAttribute('cy', sy.toFixed(1));
    dot.style.display = 'block';
  }
  if (tip) {
    tip.style.display = 'block';
    tip.style.left = Math.max(6, Math.min(rect.width - 138, sx / d.w * rect.width - 64)) + 'px';
    tip.style.top = '14px';
    tip.innerHTML = '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.4px">Stock price</div>' +
      '<div style="font-family:var(--mono);font-size:13px;color:var(--text)">$' + stock.toFixed(2) + '</div>' +
      '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-top:3px">Expiration P/L</div>' +
      '<div style="font-family:var(--mono);font-size:13px;color:' + (pnl >= 0 ? '#22c55e' : '#ef4444') + '">' + fmtMoney(pnl) + '</div>';
  }
}

function payoffShapeLeave() {
  ['payoff-cursor-line', 'payoff-cursor-dot', 'payoff-tip'].forEach(function(id) {
    var el = $(id);
    if (el) el.style.display = 'none';
  });
}

function payoffExactRows(d, payoffAt) {
  var sg = d.strategyGroup || '';
  var rows = [];
  function row(label, px, note, kind, pnlOverride) {
    var pnl = px != null ? payoffAt(px) : null;
    if (pnlOverride != null) pnl = pnlOverride;
    rows.push({ label: label, px: px, pnl: pnl, note: note || '', kind: kind || '' });
  }

  var checkpoints = d.payoff && d.payoff.checkpoints ? d.payoff.checkpoints : [];
  var profitMarkers = checkpoints.filter(function(m) { return m.kind === 'profit'; });
  var lossMarkers = checkpoints.filter(function(m) { return m.kind === 'loss'; });
  var legs = analysisLegs(d);
  var sellPut = legs.find(function(l) { return l.a === 'SELL' && l.t === 'PUT'; });
  var buyPut = legs.find(function(l) { return l.a === 'BUY' && l.t === 'PUT'; });
  var sellCall = legs.find(function(l) { return l.a === 'SELL' && l.t === 'CALL'; });
  var buyCall = legs.find(function(l) { return l.a === 'BUY' && l.t === 'CALL'; });
  var beVals = [];
  if (d.payoff && d.payoff.breakevens) beVals = beVals.concat(d.payoff.breakevens);
  ['breakeven', 'lowerBE', 'upperBE', 'putBreakeven', 'callBreakeven'].forEach(function(k) {
    if (d[k] != null) beVals.push(d[k]);
  });
  beVals = beVals.filter(function(v, idx, arr) {
    return v != null && Number.isFinite(safeNum(v)) &&
      arr.findIndex(function(o) { return Math.abs(safeNum(o) - safeNum(v)) < 0.01; }) === idx;
  });

  if (sg === 'credit_spread') {
    var isPutCredit = !!sellPut && !!buyPut;
    var shortLeg = isPutCredit ? sellPut : sellCall;
    var longLeg = isPutCredit ? buyPut : buyCall;
    if (shortLeg) row('Max profit', safeNum(shortLeg.s), isPutCredit ? 'At or above short strike' : 'At or below short strike', 'profit', d.maxProfit != null ? safeNum(d.maxProfit) : payoffAt(safeNum(shortLeg.s)));
    beVals.slice(0, 2).forEach(function(v, i) { row(i ? 'Breakeven 2' : 'Breakeven', v, 'P/L is about $0', 'be', 0); });
    if (longLeg) row('Max loss', safeNum(longLeg.s), isPutCredit ? 'At or below long strike' : 'At or above long strike', 'loss', d.maxLoss != null ? -safeNum(d.maxLoss) : payoffAt(safeNum(longLeg.s)));
    else if (d.maxLoss != null && !d.maxLossUnlimited) rows.push({ label:'Max loss', px:null, pnl:-safeNum(d.maxLoss), note:'Maximum risk', kind:'loss' });
  } else if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.openingCredit != null) rows.push({ label:'Opening credit', px:null, pnl:safeNum(d.openingCredit), note:'Collected at entry', kind:'credit' });
    if (d.openingDebit != null) rows.push({ label:'Opening debit', px:null, pnl:-safeNum(d.openingDebit), note:'Paid at entry', kind:'debit' });
    if (profitMarkers[0]) row('Max at body', profitMarkers[0].px, 'Best expiration area', 'profit', profitMarkers[0].pnl);
    beVals.slice(0, 2).forEach(function(v, i) { row(i ? 'Upper breakeven' : 'Lower breakeven', v, 'P/L is about $0', 'be', 0); });
    if (lossMarkers[0]) row('Max loss', lossMarkers[0].px, 'Worst expiration area', 'loss', lossMarkers[0].pnl);
  } else {
    if (profitMarkers[0]) row('Max profit', profitMarkers[0].px, 'Best expiration area', 'profit', profitMarkers[0].pnl);
    else if (d.maxProfitUnlimited) rows.push({ label:'Max profit', px:null, pnl:null, valueText:'Unlimited', note:'Theoretical upside is uncapped', kind:'profit' });
    else if (d.maxProfit != null && !d.maxProfitUnlimited) rows.push({ label:'Max profit', px:null, pnl:safeNum(d.maxProfit), note:'Maximum gain', kind:'profit' });

    beVals.slice(0, 2).forEach(function(v, i) { row(i ? 'Breakeven 2' : 'Breakeven', v, 'P/L is about $0', 'be', 0); });

    if (lossMarkers[0]) row('Max loss', lossMarkers[0].px, 'Worst expiration area', 'loss', lossMarkers[0].pnl);
    else if (d.maxLoss != null && !d.maxLossUnlimited) rows.push({ label:'Max loss', px:null, pnl:-safeNum(d.maxLoss), note:'Maximum risk', kind:'loss' });
  }

  return rows.filter(function(r, idx, arr) {
    return arr.findIndex(function(o) {
      return o.label === r.label && (o.px == null || r.px == null || Math.abs(safeNum(o.px) - safeNum(r.px)) < 0.01);
    }) === idx;
  });
}

function payoffRange(d, rows) {
  var legs = analysisLegs(d);
  var anchors = legs.map(function(l) { return safeNum(l.s); }).filter(function(v) { return v > 0; });
  rows.forEach(function(r) { if (r.px != null && safeNum(r.px) > 0) anchors.push(safeNum(r.px)); });
  ['price', 'breakeven', 'lowerBE', 'upperBE', 'putBreakeven', 'callBreakeven', 'shortStrike', 'longStrike', 'shortPut', 'shortCall', 'longPut', 'longCall'].forEach(function(k) {
    if (d[k] != null && safeNum(d[k]) > 0) anchors.push(safeNum(d[k]));
  });
  if (!anchors.length && d.price) anchors.push(safeNum(d.price));
  var minAnchor = Math.min.apply(null, anchors);
  var maxAnchor = Math.max.apply(null, anchors);
  var em = safeNum(d.em || (d.summary && d.summary.expectedMove), 0);
  var structuralSpan = Math.max(maxAnchor - minAnchor, 0);
  var span = Math.max(structuralSpan, em ? em * 2 : 0, safeNum(d.price) * 0.08, 1);
  var pad = Math.max(span * 0.22, safeNum(d.price) * 0.012, 0.5);
  return {
    low: Math.max(0.01, minAnchor - pad),
    high: maxAnchor + pad
  };
}

function payoffSamplePoints(d, low, high) {
  var points = [];
  for (var i = 0; i <= 120; i++) {
    var px = low + (high - low) * i / 120;
    var pnl = estimatePayoff(d, px);
    if (pnl == null || !Number.isFinite(pnl)) return null;
    points.push({ px: px, pnl: pnl });
  }
  return points;
}

function payoffPath(points, x, y, keepFn) {
  var path = '';
  var active = false;
  function addPoint(px, pnl) {
    path += (active ? ' L ' : ' M ') + x({ px: px }).toFixed(1) + ' ' + y(pnl).toFixed(1);
    active = true;
  }
  for (var i = 1; i < points.length; i++) {
    var a = points[i - 1];
    var b = points[i];
    var keepA = keepFn(a.pnl);
    var keepB = keepFn(b.pnl);
    if (!keepA && !keepB) {
      active = false;
      continue;
    }
    if (keepA && !active) addPoint(a.px, a.pnl);
    if (keepA && keepB) {
      addPoint(b.px, b.pnl);
      continue;
    }
    if (a.pnl !== b.pnl) {
      var t = (0 - a.pnl) / (b.pnl - a.pnl);
      var crossPx = a.px + (b.px - a.px) * t;
      addPoint(crossPx, 0);
    }
    if (!keepA && keepB) addPoint(b.px, b.pnl);
    if (!keepB) active = false;
  }
  return path;
}

function payoffZoneRects(points, x, pad, h) {
  var html = '';
  for (var i = 1; i < points.length; i++) {
    var a = points[i - 1];
    var b = points[i];
    var mid = (a.pnl + b.pnl) / 2;
    var x1 = x(a);
    var x2 = x(b);
    var col = mid >= 0 ? '#22c55e' : '#ef4444';
    html += '<rect x="' + x1.toFixed(1) + '" y="' + pad + '" width="' + Math.max(0, x2 - x1).toFixed(1) + '" height="' + (h - pad * 2) + '" fill="' + col + '" opacity=".045"/>';
  }
  return html;
}

function payoffLevelRows(rows) {
  return rows.map(function(m) {
    var pnlText = m.valueText || fmtMoney(m.pnl);
    var col = m.valueText === 'Unlimited' ? '#22c55e' : safeNum(m.pnl) >= 0 ? '#22c55e' : '#ef4444';
    return '<div class="payoff-level-row">' +
      '<div class="payoff-level-name">' + m.label + '</div>' +
      '<div class="payoff-level-price">' + (m.px != null ? '$' + safeNum(m.px).toFixed(2) : (m.valueText === 'Unlimited' ? 'Beyond chart' : 'N/A')) + '</div>' +
      '<div class="payoff-level-pnl" style="color:' + col + '">' + pnlText + '</div>' +
    '</div>';
  }).join('');
}

function renderPayoffShape(d) {
  if (!d.price) return '';
  function payoffAt(px) {
    var v = estimatePayoff(d, px);
    return v == null || !Number.isFinite(v) ? null : v;
  }
  var checkpointRows = payoffExactRows(d, payoffAt);
  var range = payoffRange(d, checkpointRows);
  var low = range.low;
  var high = range.high;
  var points = payoffSamplePoints(d, low, high);
  if (!points) return '';
  var minY = Math.min.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  var maxY = Math.max.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  if (minY === maxY) { minY -= 100; maxY += 100; }
  var yPad = Math.max(18, (maxY - minY) * 0.08);
  minY -= yPad;
  maxY += yPad;
  var w = 420, h = 150, pad = 18;
  function x(p) { return pad + (p.px - low) / (high - low) * (w - pad * 2); }
  function y(v) { return h - pad - (v - minY) / (maxY - minY) * (h - pad * 2); }
  var zeroY = y(0);
  var profitPath = payoffPath(points, x, y, function(v) { return v >= 0; });
  var lossPath = payoffPath(points, x, y, function(v) { return v < 0; });
  var currentX = d.price >= low && d.price <= high ? x({ px: safeNum(d.price) }) : null;
  var markers = checkpointRows.filter(function(m) {
    return m.px > 0 && m.px >= low && m.px <= high;
  });
  var markerSvg = markers.slice(0, 8).map(function(m) {
    var col = m.kind === 'be' ? 'var(--yellow)' : m.kind === 'profit' ? '#22c55e' : m.kind === 'loss' ? '#ef4444' : 'var(--text2)';
    var mx = x({ px: m.px });
    return '<line x1="' + mx.toFixed(1) + '" y1="' + pad + '" x2="' + mx.toFixed(1) + '" y2="' + (h - pad) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 5" opacity=".7"/>' +
      '<circle cx="' + mx.toFixed(1) + '" cy="' + y(m.pnl).toFixed(1) + '" r="3" fill="' + col + '" stroke="#0b0e17" stroke-width="1.3"><title>' + m.label + ' ' + (m.px != null ? '$' + safeNum(m.px).toFixed(2) : '') + '</title></circle>';
  }).join('');
  payoffShapeData = { low: low, high: high, minY: minY, maxY: maxY, w: w, h: h, pad: pad, result: d };
  return '<div class="card payoff-card">' +
    '<div class="payoff-head">' +
      '<div><div class="analysis-panel-label">Expiration P/L map</div><div class="payoff-range">Focused on current price, strikes, and breakeven</div></div>' +
      '<div class="payoff-range">$' + low.toFixed(0) + ' to $' + high.toFixed(0) + '</div>' +
    '</div>' +
    '<div class="payoff-chart-wrap">' +
    '<svg viewBox="0 0 ' + w + ' ' + h + '" onpointermove="payoffShapeMove(event,this)" onpointerleave="payoffShapeLeave()" class="payoff-svg">' +
      payoffZoneRects(points, x, pad, h) +
      '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
      (currentX != null ? '<line x1="' + currentX.toFixed(1) + '" y1="' + pad + '" x2="' + currentX.toFixed(1) + '" y2="' + (h - pad) + '" stroke="var(--blue2)" stroke-width="1.2" opacity=".85"/>' : '') +
      markerSvg +
      (lossPath ? '<path d="' + lossPath + '" fill="none" stroke="#ef4444" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
      (profitPath ? '<path d="' + profitPath + '" fill="none" stroke="#22c55e" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
      '<line id="payoff-cursor-line" x1="0" y1="' + pad + '" x2="0" y2="' + (h - pad) + '" stroke="var(--blue2)" stroke-width="1" stroke-dasharray="4 4" style="display:none"/>' +
      '<circle id="payoff-cursor-dot" cx="0" cy="0" r="3" fill="var(--blue2)" stroke="#0b0e17" stroke-width="1.5" style="display:none"/>' +
    '</svg>' +
    '<div id="payoff-tip" style="display:none;position:absolute;width:128px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;padding:7px 8px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;z-index:3"></div>' +
    '</div>' +
    '<div class="payoff-axis"><span>$' + low.toFixed(0) + '</span><span>Current $' + safeNum(d.price).toFixed(2) + '</span><span>$' + high.toFixed(0) + '</span></div>' +
    '<div class="payoff-levels">' +
      payoffLevelRows(checkpointRows) +
    '</div>' +
  '</div>';
}
