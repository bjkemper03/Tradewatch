// =============================================================================
// js/pages/analyze.js -- Analyze page: trade setup form + results display
// Depends on globals: azLegData, azStrat, azResult, prefs, API, DEF,
//   STRAT_GROUPS, safeNum(), calcCollateral(), cushC(), spinHtml(),
//   mc2(), g3html(), showPage(), logFromAnalysis() from trades.js
// =============================================================================

var payoffShapeData = null;

// ---------------------------------------------------------------------------
// Render the analyze page form
// ---------------------------------------------------------------------------
function renderAnalyze() {
  var el = $('page-analyze');
  azLegData = DEF['PUT CREDIT SPREAD'].map(function(l) { return Object.assign({}, l); });
  azStrat   = 'PUT CREDIT SPREAD';

  el.innerHTML = '<div class="fadeup"><div style="padding:0 12px 10px">' +
    '<div class="fg2">' +
      '<div class="fld"><label>Ticker</label>' +
        '<input id="az-tk" placeholder="NVDA" oninput="this.value=this.value.toUpperCase()" style="font-size:15px;font-weight:600;font-family:var(--mono)">' +
      '</div>' +
      '<div class="fld"><label>Strategy</label>' +
        '<select id="az-strat" onchange="azChangeStrat(this.value)">' +
          Object.keys(STRAT_GROUPS).map(function(grp) {
            return '<optgroup label="' + grp + '">' +
              STRAT_GROUPS[grp].map(function(s) { return '<option>' + s + '</option>'; }).join('') +
            '</optgroup>';
          }).join('') +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div class="fld"><label>Option Legs &mdash; Enter Strike Prices</label></div>' +
    '<div id="az-lc"></div>' +
    '<button onclick="addAzLeg()" style="padding:5px 11px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:10px;cursor:pointer;margin-bottom:10px">+ Add Leg</button>' +
    '<div class="fg2">' +
      '<div class="fld"><label>Expiration (5/10/26)</label>' +
        '<input id="az-exp" placeholder="5/23/26" style="font-family:var(--mono)">' +
      '</div>' +
      '<div class="fld"><label>Credit / Debit ($/share)</label>' +
        '<input id="az-cr" placeholder="0.45" type="number" step="0.01" oninput="azUpdateCol()" style="font-family:var(--mono)">' +
      '</div>' +
    '</div>' +
    '<div class="fld"><label>Entry Type</label>' +
      '<select id="az-entry" onchange="azUpdateCol()">' +
        '<option value="credit">Credit to open</option>' +
        '<option value="debit">Debit to open</option>' +
      '</select>' +
    '</div>' +
    '<div class="fg2">' +
      '<div class="fld"><label>Collateral $ (estimate)</label>' +
        '<input id="az-col" placeholder="Auto" type="number" step="1" style="font-family:var(--mono)">' +
      '</div>' +
      '<div class="fld"><label>Notes</label>' +
        '<input id="az-ctx" placeholder="Context...">' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-primary btn-w" id="az-btn" onclick="runAnalysis()">&rarr; Analyze Trade</button>' +
  '</div><div id="az-result" style="margin-top:4px"></div></div>';

  buildAzLegs();
}

// ---------------------------------------------------------------------------
// Analyze form helpers
// ---------------------------------------------------------------------------
function azChangeStrat(s) {
  azStrat   = s;
  azLegData = (DEF[s] || [{ a:'BUY', t:'PUT', n:1, s:'' }]).map(function(l) { return Object.assign({}, l); });
  buildAzLegs();
  var entry = $('az-entry');
  if (entry) entry.value = isDebitStrat(s) ? 'debit' : 'credit';
  azUpdateCol();
}

function addAzLeg() {
  azLegData.push({ a:'BUY', t:'PUT', n:1, s:'' });
  buildAzLegs();
}

function buildAzLegs() {
  var c = $('az-lc');
  if (!c) return;
  c.innerHTML = azLegData.map(function(leg, i) {
    return '<div class="leg-row ' + (leg.a === 'SELL' ? 'sell' : 'buy-l') + '">' +
      '<select class="leg-action" style="color:' + (leg.a === 'SELL' ? '#ef4444' : '#22c55e') + '" ' +
        'onchange="azLegData[' + i + '].a=this.value;buildAzLegs();azUpdateCol()">' +
        '<option ' + (leg.a === 'SELL' ? 'selected' : '') + '>SELL</option>' +
        '<option ' + (leg.a === 'BUY'  ? 'selected' : '') + '>BUY</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.n || 1) + '" min="1" max="20" class="leg-ct" ' +
        'onblur="azLegData[' + i + '].n=parseInt(this.value)||1;azUpdateCol()">' +
      '<span style="color:var(--text3);font-size:10px">&times;</span>' +
      '<select class="leg-type" onchange="azLegData[' + i + '].t=this.value">' +
        '<option ' + (leg.t === 'PUT'  ? 'selected' : '') + '>PUT</option>' +
        '<option ' + (leg.t === 'CALL' ? 'selected' : '') + '>CALL</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.s || '') + '" placeholder="Strike" class="strike-input" style="flex:1" ' +
        'oninput="azLegData[' + i + '].s=this.value" onblur="azLegData[' + i + '].s=this.value;azUpdateCol()">' +
      (azLegData.length > 1
        ? '<button class="leg-x" onclick="azLegData.splice(' + i + ',1);buildAzLegs();azUpdateCol()">&times;</button>'
        : '') +
    '</div>';
  }).join('');
}

function azUpdateCol() {
  var cr  = safeNum($('az-cr') ? $('az-cr').value : 0);
  var entryType = $('az-entry') ? $('az-entry').value : (isDebitStrat(azStrat) ? 'debit' : 'credit');
  var col = calcCollateral(azStrat, azLegData, cr, entryType);
  var el  = $('az-col');
  if (el) el.value = col > 0 ? col.toFixed(0) : '';
}

// ---------------------------------------------------------------------------
// Run analysis -- calls backend, stores result, renders output
// ---------------------------------------------------------------------------
async function runAnalysis() {
  var ticker = $('az-tk') ? $('az-tk').value.trim().toUpperCase() : '';
  var expRaw = $('az-exp') ? $('az-exp').value.trim() : '';
  var credit = safeNum($('az-cr') ? $('az-cr').value : 0);
  var entryType = $('az-entry') ? $('az-entry').value : (isDebitStrat(azStrat) ? 'debit' : 'credit');
  if (!ticker) { alert('Enter a ticker symbol'); return; }

  var btn = $('az-btn');
  btn.disabled    = true;
  btn.textContent = 'FETCHING DATA...';
  $('az-result').innerHTML = spinHtml('PULLING ' + ticker + '...');

  try {
    var res = await fetch(API.analyze, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker:   ticker,
        legs:     azLegData,
        expDate:  expRaw,
        credit:   credit,
        entryType: entryType,
        strategy: azStrat,
        prefs: {
          cushionMin:    prefs.cushionMin,
          dteLow:        prefs.dteLow,
          dteHigh:       prefs.dteHigh,
          deltaLow:      prefs.deltaLow,
          deltaHigh:     prefs.deltaHigh,
          creditWidthMin:prefs.creditWidthMin
        }
      }),
      signal: AbortSignal.timeout(25000)
    });

    var d = await res.json();

    if (!d.ok) {
      $('az-result').innerHTML = '<div style="padding:14px 16px;color:var(--red);font-size:12px;' +
        'background:var(--red-dim);border-radius:10px;margin:0 12px">' +
        '<strong>Analysis Error:</strong> ' + (d.error || 'Unknown error') + '</div>';
      return;
    }

    // Store for log-from-analysis
    azResult = {
      ticker:        d.ticker,
      strategy:      d.strategy,
      strategyGroup: d.strategyGroup,
      legs:          azLegData.map(function(l) { return Object.assign({}, l); }),
      exp:           expRaw,
      price:         d.price,
      lastDate:      d.lastDate,
      credit:        credit,
      entryType:     entryType,
      collateral:    d.collateral != null ? d.collateral : calcCollateral(azStrat, azLegData, credit, entryType),
      breakeven:     d.breakeven     || null,
      cushionPct:    d.cushionPct    || null,
      absDelta:      d.absDelta      || null,
      deltaSource:   d.deltaSource   || 'BS',
      hv30:          d.hv30          || null,
      dte:           d.dte           || null,
      supports:      d.supports      || [],
      exitSignal:    d.exitSignal    || null,
      earningsRisk:  d.earningsRisk  || false,
      earningsDate:  d.earningsDate  || null,
      signal:        d.signal        || 'GO',
      em:            d.em            || null,
      wheelScenarios:d.wheelScenarios|| null,
      probWorthless: d.probWorthless || null,
      profitTargets: d.profitTargets || null,
      modelNotes:    d.modelNotes    || [],
      notes:         $('az-ctx') ? $('az-ctx').value.trim() : '',
      issues:        d.issues        || []
    };

    renderAnalysisResult(d);

  } catch(e) {
    console.error('Analysis error:', e);
    $('az-result').innerHTML = '<div style="padding:14px;color:var(--red);font-size:11px">Fetch failed: ' + e.message + '</div>';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '&rarr; Analyze Trade';
  }
}

function renderGreekBox(d) {
  var g = d.greeks || {};
  var items = [];
  if (d.absDelta != null) items.push(['Delta', d.absDelta.toFixed(3) + (d.deltaSource === 'Tradier' ? '' : ' ~')]);
  if (g.gamma != null) items.push(['Gamma', safeNum(g.gamma).toFixed(3)]);
  if (g.theta != null) items.push(['Theta', safeNum(g.theta).toFixed(3)]);
  if (g.vega != null)  items.push(['Vega',  safeNum(g.vega).toFixed(3)]);
  if (g.rho != null)   items.push(['Rho',   safeNum(g.rho).toFixed(3)]);
  if (d.iv != null)    items.push(['IV',    d.iv + '%']);
  if (!items.length) return '';
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 12px 10px">' +
    items.map(function(item) {
      return '<span style="display:inline-flex;gap:5px;align-items:center;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:10px">' +
        '<span style="color:var(--text3);text-transform:uppercase;font-weight:600">' + item[0] + '</span>' +
        '<span style="font-family:var(--mono);color:var(--text)">' + item[1] + '</span>' +
      '</span>';
    }).join('') +
  '</div>';
}

function renderMetricGrid(metrics) {
  var items = metrics.slice();
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin:0 12px 10px">' + items.join('') + '</div>';
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(0);
}

function fmtRiskMoney(v, unlimited) {
  if (unlimited) return 'Unlimited';
  return fmtMoney(v);
}

function fmtAsOf(v) {
  if (!v) return '';
  var n = Number(v);
  var dt = Number.isFinite(n) && String(v).length >= 10 ? new Date(n) : new Date(v);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

function renderModelNotes(d) {
  var notes = d.modelNotes || [];
  if (!notes.length) return '';
  return '<details class="card" style="padding:10px 12px">' +
    '<summary style="cursor:pointer;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Model assumptions</summary>' +
    '<div style="display:grid;gap:6px;margin-top:9px">' +
    notes.slice(0, 5).map(function(n) {
      var isWeak = n.level === 'weak';
      return '<div style="display:flex;align-items:flex-start;gap:7px;font-size:10px;line-height:1.45;color:var(--text2)">' +
        '<strong style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">' + (isWeak ? 'Weak estimate' : 'Model') + '</strong>' +
        '<span>' + n.msg + '</span>' +
      '</div>';
    }).join('') +
    '</div>' +
  '</details>';
}

function estimatePayoff(d, px) {
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
  var legs = azLegData || [];
  if (!legs.length) return null;
  var premium = safeNum($('az-cr') ? $('az-cr').value : d.credit || d.prem || d.debit || 0);
  var entryType = $('az-entry') ? $('az-entry').value : (isDebitStrat(d.strategy) ? 'debit' : 'credit');
  var netPremium = entryType === 'debit' ? -premium : premium;
  var perShare = d.strategy === 'COVERED CALL' ? (px - d.price) + premium : netPremium;
  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];
    var strike = safeNum(leg.s);
    if (!strike) return null;
    var qty = safeNum(leg.n || 1, 1);
    var intrinsic = leg.t === 'CALL' ? Math.max(0, px - strike) : Math.max(0, strike - px);
    if (d.strategy === 'COVERED CALL' && leg.a === 'SELL' && leg.t === 'CALL') {
      perShare -= intrinsic * qty;
    } else {
      perShare += (leg.a === 'BUY' ? intrinsic : -intrinsic) * qty;
    }
  }
  return perShare * 100;
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
  if (d.payoff && d.payoff.checkpoints && d.payoff.checkpoints.length) {
    return d.payoff.checkpoints.map(function(m) {
      return {
        label: m.label,
        px: m.px,
        pnl: m.pnl,
        note: m.note || '',
        kind: m.kind || ''
      };
    });
  }
  var sg = d.strategyGroup || '';
  var rows = [];
  function row(label, px, note, kind) {
    var pnl = px != null ? payoffAt(px) : null;
    rows.push({ label: label, px: px, pnl: pnl, note: note || '', kind: kind || '' });
  }
  var sellPut = (azLegData || []).find(function(l) { return l.a === 'SELL' && l.t === 'PUT'; });
  var buyPut = (azLegData || []).find(function(l) { return l.a === 'BUY' && l.t === 'PUT'; });
  var sellCall = (azLegData || []).find(function(l) { return l.a === 'SELL' && l.t === 'CALL'; });
  var buyCall = (azLegData || []).find(function(l) { return l.a === 'BUY' && l.t === 'CALL'; });

  row('Now', safeNum(d.price), '', 'now');
  if (d.breakeven) row('Breakeven', safeNum(d.breakeven), 'P/L is about $0', 'be');
  if (d.lowerBE) row('Lower BE', safeNum(d.lowerBE), 'Lower profit boundary', 'be');
  if (d.upperBE) row('Upper BE', safeNum(d.upperBE), 'Upper profit boundary', 'be');
  if (d.putBreakeven) row('Put BE', safeNum(d.putBreakeven), 'Lower profit boundary', 'be');
  if (d.callBreakeven) row('Call BE', safeNum(d.callBreakeven), 'Upper profit boundary', 'be');

  if ((sg === 'csp' || sg === 'credit_spread') && sellPut) {
    row('Max profit starts', safeNum(sellPut.s), 'Short put expires worthless above here', 'profit');
    if (sg === 'credit_spread' && buyPut) row('Max loss starts', safeNum(buyPut.s), 'Spread is fully ITM below here', 'loss');
    if (sg === 'csp') rows.push({ label:'Max loss endpoint', px: 0, pnl: d.maxLoss != null ? -safeNum(d.maxLoss) : payoffAt(0.01), note:'Theoretical if stock goes to $0', kind:'loss' });
  } else if (sg === 'covered_call' && sellCall) {
    row('Max profit starts', safeNum(sellCall.s), 'Called away above here', 'profit');
  } else if (sg === 'call_debit_spread' && sellCall) {
    row('Max profit starts', safeNum(sellCall.s), 'Spread reaches full width above here', 'profit');
  } else if (sg === 'put_debit_spread' && sellPut) {
    row('Max profit starts', safeNum(sellPut.s), 'Spread reaches full width below here', 'profit');
  } else if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (sellPut) row('Put short', safeNum(sellPut.s), 'Max-profit tent starts above here', 'short');
    if (sellCall) row('Call short', safeNum(sellCall.s), 'Max-profit tent ends below here', 'short');
    if (buyPut) row('Put max loss', safeNum(buyPut.s), 'Lower wing fully breached', 'loss');
    if (buyCall) row('Call max loss', safeNum(buyCall.s), 'Upper wing fully breached', 'loss');
  }

  return rows.filter(function(r, idx, arr) {
    return arr.findIndex(function(o) { return o.label === r.label && Math.abs(safeNum(o.px) - safeNum(r.px)) < 0.01; }) === idx;
  });
}

function renderPayoffShape(d) {
  if (!d.price) return '';
  var points = d.payoff && d.payoff.points && d.payoff.points.length ? d.payoff.points : null;
  var low = d.payoff && d.payoff.low ? safeNum(d.payoff.low) : null;
  var high = d.payoff && d.payoff.high ? safeNum(d.payoff.high) : null;
  if (!points) {
    var strikes = (azLegData || []).map(function(l) { return safeNum(l.s); }).filter(function(s) { return s > 0; });
    var beVals = [d.breakeven, d.lowerBE, d.upperBE, d.putBreakeven, d.callBreakeven]
      .map(function(v) { return safeNum(v); })
      .filter(function(v) { return v > 0; });
    var anchorVals = strikes.concat(beVals).concat([d.price]);
    var minAnchor = Math.min.apply(null, anchorVals);
    var maxAnchor = Math.max.apply(null, anchorVals);
    var span = Math.max(d.price * 0.18, maxAnchor - minAnchor, 1);
    low = Math.max(0.01, Math.min(d.price * 0.75, minAnchor - span * 0.35));
    high = Math.max(d.price * 1.25, maxAnchor + span * 0.35);
    points = [];
    for (var i = 0; i <= 96; i++) {
      var px = low + (high - low) * i / 96;
      var pnl = estimatePayoff(d, px);
      if (pnl == null || !Number.isFinite(pnl)) return '';
      points.push({ px: px, pnl: pnl });
    }
  }
  var minY = Math.min.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  var maxY = Math.max.apply(null, points.map(function(p) { return p.pnl; }).concat([0]));
  if (minY === maxY) { minY -= 100; maxY += 100; }
  var w = 360, h = 120, pad = 14;
  function x(p) { return pad + (p.px - low) / (high - low) * (w - pad * 2); }
  function y(v) { return h - pad - (v - minY) / (maxY - minY) * (h - pad * 2); }
  var zeroY = y(0);
  var line = points.map(function(p) { return x(p).toFixed(1) + ',' + y(p.pnl).toFixed(1); }).join(' ');
  function payoffAt(px) {
    var v = estimatePayoff(d, px);
    return v == null || !Number.isFinite(v) ? null : v;
  }
  var checkpointRows = payoffExactRows(d, payoffAt);
  var markers = checkpointRows.filter(function(m) {
    return m.px > 0 && m.px >= low && m.px <= high && m.kind !== 'loss';
  });
  var markerSvg = markers.slice(0, 8).map(function(m, idx) {
    var col = m.kind === 'now' ? 'var(--blue2)' : m.kind === 'be' ? 'var(--yellow)' : m.kind === 'short' ? '#fca5a5' : m.kind === 'profit' ? '#22c55e' : '#86efac';
    var mx = x({ px: m.px });
    var ty = idx % 2 ? h - 5 : 10;
    return '<line x1="' + mx.toFixed(1) + '" y1="' + pad + '" x2="' + mx.toFixed(1) + '" y2="' + (h - pad) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".75"/>' +
      '<text x="' + mx.toFixed(1) + '" y="' + ty + '" text-anchor="middle" fill="' + col + '" font-size="6" font-family="monospace">' + m.label.replace(/Max profit starts/g, 'MaxProfit').replace(/Breakeven/g, 'BE').replace(/ /g, '') + '</text>';
  }).join('');
  payoffShapeData = { low: low, high: high, minY: minY, maxY: maxY, w: w, h: h, pad: pad, result: d };
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">P/L Shape at Expiration</div>' +
      '<div style="font-size:9px;color:var(--text3);font-family:var(--mono)">drag across curve</div>' +
    '</div>' +
    '<div style="position:relative">' +
    '<svg viewBox="0 0 ' + w + ' ' + h + '" onpointermove="payoffShapeMove(event,this)" onpointerleave="payoffShapeLeave()" style="width:100%;height:150px;display:block;background:var(--surface2);border:1px solid var(--border);border-radius:8px;touch-action:none;cursor:crosshair">' +
      '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
      markerSvg +
      '<polyline points="' + line + '" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line id="payoff-cursor-line" x1="0" y1="' + pad + '" x2="0" y2="' + (h - pad) + '" stroke="var(--blue2)" stroke-width="1" stroke-dasharray="4 4" style="display:none"/>' +
      '<circle id="payoff-cursor-dot" cx="0" cy="0" r="3" fill="var(--blue2)" stroke="#0b0e17" stroke-width="1.5" style="display:none"/>' +
    '</svg>' +
    '<div id="payoff-tip" style="display:none;position:absolute;width:128px;background:var(--surface3);border:1px solid var(--border2);border-radius:8px;padding:7px 8px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;z-index:3"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:5px;font-family:var(--mono)"><span>$' + low.toFixed(0) + '</span><span>Now $' + d.price + '</span><span>$' + high.toFixed(0) + '</span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin-top:10px">' +
      checkpointRows.map(function(m) {
        var col = m.pnl >= 0 ? '#22c55e' : '#ef4444';
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:7px 8px;min-width:0">' +
          '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-top:3px;font-family:var(--mono)">' +
            '<span style="font-size:11px;color:var(--text2)">' + (m.px != null ? '$' + safeNum(m.px).toFixed(2) : 'N/A') + '</span>' +
            '<span style="font-size:12px;font-weight:800;color:' + col + '">' + fmtMoney(m.pnl) + '</span>' +
          '</div>' +
          (m.note ? '<div style="font-size:9px;color:var(--text3);line-height:1.35;margin-top:3px">' + m.note + '</div>' : '') +
        '</div>';
      }).join('') +
    '</div>' +
  '</div>';
}

function renderTradeContext(d) {
  var supports = d.supports || [];
  var resistances = d.resistances || [];
  var hasWheel = !!d.wheelScenarios;
  var hasProb = d.probWorthless != null || d.probAnyProfit != null || d.probTouchShort != null || d.probTouchPutShort != null || d.probTouchCallShort != null;
  if (!supports.length && !resistances.length && !d.exitSignal && !d.sma20 && !d.em && !hasWheel && !hasProb && d.dailyDecay == null) return '';
  function levelTags(level, kind) {
    var list = kind === 'support' ? (d.supportDetails || []) : (d.resistanceDetails || []);
    var detail = list.find(function(x) { return Math.abs(safeNum(x.price) - safeNum(level)) < 0.01; });
    if (!detail) return '';
    var tags = [];
    if (detail.freshDays != null) tags.push(detail.freshDays + 'd');
    if (detail.touches) tags.push(detail.touches + 'x');
    if (detail.retested) tags.push('retest');
    if (detail.volumeConfirmed) tags.push('vol');
    if (detail.broken) tags.push('broken');
    return tags.length ? '<div style="font-size:8px;color:var(--text3);font-family:var(--mono);margin-top:2px">' + tags.slice(0,3).join(' ') + '</div>' : '';
  }
  function levelHtml(list, kind) {
    var col = kind === 'support' ? 'var(--green)' : 'var(--red)';
    return list.slice(0, 3).map(function(p) {
      return '<span style="display:inline-block;margin-right:12px;margin-bottom:4px">' +
        '<span style="font-family:var(--mono);font-size:14px;color:' + col + ';font-weight:700">$' + p + '</span>' +
        levelTags(p, kind) +
      '</span>';
    }).join('');
  }
  function mini(label, val, color, sub) {
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 10px;min-width:0">' +
      '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">' + label + '</div>' +
      '<div style="font-family:var(--mono);font-size:15px;font-weight:800;color:' + (color || 'var(--text)') + ';margin-top:3px">' + val + '</div>' +
      (sub ? '<div style="font-size:9px;color:var(--text3);line-height:1.35;margin-top:3px">' + sub + '</div>' : '') +
    '</div>';
  }
  var sg = d.strategyGroup || '';
  var probTiles = '';
  if (d.probWorthless != null) probTiles += mini(sg === 'long_call' || sg === 'long_put' ? 'Exp worthless' : 'Exp worthless', Math.round(d.probWorthless * 100) + '%', sg === 'long_call' || sg === 'long_put' ? '#ef4444' : '#22c55e', 'At expiration');
  if (d.probAnyProfit != null) probTiles += mini('Exp profit', Math.round(d.probAnyProfit * 100) + '%', '#22c55e', 'At expiration');
  if (d.probTouchShort != null) probTiles += mini('Touch short', Math.round(d.probTouchShort * 100) + '%', '#f59e0b', 'Before expiration');
  if (d.probTouchPutShort != null || d.probTouchCallShort != null) {
    probTiles += mini('Touch shorts', (d.probTouchPutShort != null ? 'P ' + Math.round(d.probTouchPutShort * 100) + '%' : '') + (d.probTouchCallShort != null ? ' C ' + Math.round(d.probTouchCallShort * 100) + '%' : ''), '#f59e0b', 'Before expiration');
  }
  var wheelHtml = '';
  if (hasWheel) {
    var ws = d.wheelScenarios;
    var yd = ws.ifNotAssigned?.yieldData || ws.ifNotCalled?.yieldData || null;
    wheelHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">' +
      (ws.ifAssigned ? mini('If assigned', '$' + ws.ifAssigned.effectiveCostBasis, '#22c55e', ws.ifAssigned.note) : '') +
      (ws.ifCalledAway ? mini('If called away', '$' + ws.ifCalledAway.totalPerShare, '#22c55e', ws.ifCalledAway.note) : '') +
      (yd ? mini('Trade return', yd.tradeReturnPct + '%', '#22c55e', 'Monthly ' + yd.monthlyPct + '% / Annualized ' + yd.annualizedPct + '%') : '') +
    '</div>';
  }
  return '<div class="card">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Trade Context</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:10px">' +
      (d.em != null ? mini('Expected move', '&plusmn;$' + d.em, '#f59e0b', 'One-volatility move by expiration') : '') +
      (d.dailyDecay != null || d.dailyThetaDollars != null ? mini('Est daily decay', '~$' + (d.dailyThetaDollars != null ? safeNum(d.dailyThetaDollars).toFixed(2) : (d.dailyDecay * 100).toFixed(2)), '#f59e0b', 'Approx option value decay per day') : '') +
      probTiles +
      (d.exitSignal ? mini('Exit trigger', '$' + d.exitSignal, '#fca5a5', 'Stock price break level') : '') +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap">' +
          (supports.length ? '<div><div style="font-size:9px;color:var(--green);letter-spacing:1px;margin-bottom:4px">SUPPORT</div><div>' + levelHtml(supports, 'support') + '</div></div>' : '') +
          (resistances.length ? '<div><div style="font-size:9px;color:var(--red);letter-spacing:1px;margin-bottom:4px">RESISTANCE</div><div>' + levelHtml(resistances, 'resistance') + '</div></div>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    (d.sma20 ? '<div style="font-size:10px;color:var(--text3);margin-top:8px">SMA20 $' + d.sma20 + ' / SMA50 $' + d.sma50 + '</div>' : '') +
    wheelHtml +
  '</div>';
}

// ---------------------------------------------------------------------------
// Render analysis results
// ---------------------------------------------------------------------------
function renderAnalysisResult(d) {
  var sig      = d.signal || 'GO';
  var sc       = sig === 'GO' ? '#22c55e' : sig === 'NO-GO' ? '#ef4444' : '#f59e0b';
  var sigLabel = sig === 'GO' ? 'GO' : sig === 'NO-GO' ? 'NO-GO' : 'CAUTION';
  var issues   = d.issues || [];
  var reasons  = issues.length ? issues.map(function(i) { return i.msg; }) : ['All checks passed -- structure looks solid'];

  // ── Signal hero ──────────────────────────────────────────────────────────
  var html = '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:' + sc + '08;border:1px solid ' + sc + '25;border-radius:10px;margin:0 12px 10px">' +
    '<div style="width:48px;height:48px;border-radius:50%;background:' + sc + ';color:#080c18;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:9px;letter-spacing:1px;flex-shrink:0">' + sigLabel + '</div>' +
    '<div style="flex:1">' +
      '<div style="font-weight:700;font-size:15px;color:' + sc + '">' + d.ticker + ' &mdash; ' + d.strategy +
        (d.dte != null ? ' <span style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-left:6px">' + d.dte + 'DTE</span>' : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text2);margin-top:4px;line-height:1.6">' +
        reasons.map(function(r) {
          var ic  = issues.find(function(i) { return i.msg === r; });
          var col = ic ? (ic.level === 'critical' ? '#ef4444' : '#f59e0b') : '#22c55e';
          return '<span style="color:' + col + '">' + r + '</span>';
        }).join('<br>') +
      '</div>' +
      (fmtAsOf(d.lastDate) ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">Quote as of ' + fmtAsOf(d.lastDate) + '</div>' : '') +
    '</div>' +
  '</div>';
  html += renderGreekBox(d);

  // ── Metrics grid ─────────────────────────────────────────────────────────
  var metrics = [];
  var sg = d.strategyGroup || '';

  metrics.push(mc2('LIVE PRICE', d.price ? '$' + safeNum(d.price).toFixed(2) : 'N/A', 'var(--text)'));

  if (sg === 'credit_spread' || sg === 'csp' || sg === 'covered_call') {
    if (d.cushionPct != null)   metrics.push(mc2('CUSHION',      d.cushionPct + '%',              cushC(d.cushionPct)));
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',    '$' + d.breakeven,               'var(--text)'));
    if (d.crWidthPct != null)   metrics.push(mc2('CR/WIDTH',     d.crWidthPct + '%',              d.crWidthPct >= prefs.creditWidthMin ? '#22c55e' : '#f59e0b'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
    if (d.dailyDecay != null || d.dailyThetaDollars != null) {
      var thetaDollars = d.dailyThetaDollars != null ? safeNum(d.dailyThetaDollars) : safeNum(d.dailyDecay) * 100;
      metrics.push(mc2('DAILY THETA', '$' + thetaDollars.toFixed(2), thetaDollars >= 0 ? '#22c55e' : '#ef4444'));
    }
  }
  if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (d.putCushionPct != null)  metrics.push(mc2('PUT CUSHION',     d.putCushionPct + '%',           cushC(d.putCushionPct)));
    if (d.callCushionPct != null) metrics.push(mc2('CALL CUSHION',    d.callCushionPct + '%',          cushC(d.callCushionPct)));
    if (d.putBreakeven != null)   metrics.push(mc2('PUT BE',          '$' + d.putBreakeven,            'var(--text)'));
    if (d.callBreakeven != null)  metrics.push(mc2('CALL BE',         '$' + d.callBreakeven,           'var(--text)'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
  }
  if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.lowerBE != null)      metrics.push(mc2('LOWER BE',    '$' + d.lowerBE,              'var(--text)'));
    if (d.upperBE != null)      metrics.push(mc2('UPPER BE',    '$' + d.upperBE,              'var(--text)'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
    if (d.openingCredit != null) metrics.push(mc2('OPEN CREDIT', '$' + d.openingCredit.toFixed(0), '#22c55e'));
    if (d.profitWindowUpside != null) metrics.push(mc2('WINDOW UPSIDE', '$' + d.profitWindowUpside.toFixed(0), d.profitWindowUpside >= 0 ? '#22c55e' : '#ef4444'));
    if (d.crRatio != null)      metrics.push(mc2('CR/RISK',     d.crRatio + '%',              d.crRatio >= 20 ? '#22c55e' : d.crRatio >= 12 ? '#f59e0b' : '#ef4444'));
    if (d.creditCapturePct != null) metrics.push(mc2('CREDIT CAPTURE', d.creditCapturePct + '%', d.creditCapturePct >= 60 ? '#22c55e' : d.creditCapturePct >= 35 ? '#f59e0b' : '#ef4444'));
  }
  if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',   '$' + d.breakeven,            'var(--text)'));
    if (d.movePct != null)      metrics.push(mc2('MOVE NEEDED', d.movePct + '%',              d.movePct < 5 ? '#22c55e' : d.movePct < 10 ? '#f59e0b' : '#ef4444'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
    if (d.riskReward != null)   metrics.push(mc2('RISK/REWARD', d.riskReward + ':1',          d.riskReward < 1 ? '#22c55e' : d.riskReward < 2 ? '#f59e0b' : '#ef4444'));
  }
  if (sg === 'long_call' || sg === 'long_put') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',     '$' + d.breakeven,                         'var(--text)'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
  }

  var earnCol = d.earningsRisk ? '#ef4444' : '#22c55e';
  var earnVal = d.earningsRisk
    ? '\u26a0 ' + d.earningsDate
    : (d.earningsDate ? '\u2713 ' + d.earningsDate : '\u2713 CLEAR');
  metrics.push(mc2('EARNINGS', earnVal, earnCol));

  html += renderMetricGrid(metrics);
  html += renderTradeContext(d);

  // ── Wheel scenarios ───────────────────────────────────────────────────────
  if (false && d.wheelScenarios) {
    var ws = d.wheelScenarios;
    html += '<div class="card"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Wheel Scenarios</div>';
    if (ws.ifAssigned) {
      html += '<div style="margin-bottom:10px;padding:10px;background:var(--surface2);border-radius:8px">' +
        '<div style="font-size:10px;color:var(--text2);font-weight:600;margin-bottom:4px">IF ASSIGNED</div>' +
        '<div style="font-size:12px;color:var(--text);line-height:1.7">' + ws.ifAssigned.note + '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:4px">Effective cost basis: <strong style="color:var(--green)">$' + ws.ifAssigned.effectiveCostBasis + '</strong></div>' +
      '</div>';
    }
    if (ws.ifCalledAway) {
      html += '<div style="margin-bottom:10px;padding:10px;background:var(--surface2);border-radius:8px">' +
        '<div style="font-size:10px;color:var(--text2);font-weight:600;margin-bottom:4px">IF CALLED AWAY</div>' +
        '<div style="font-size:12px;color:var(--text);line-height:1.7">' + ws.ifCalledAway.note + '</div>' +
      '</div>';
    }
    if (ws.ifNotAssigned && ws.ifNotAssigned.yieldData) {
      var yd = ws.ifNotAssigned.yieldData;
      html += '<div style="padding:10px;background:var(--surface2);border-radius:8px">' +
        '<div style="font-size:10px;color:var(--text2);font-weight:600;margin-bottom:4px">IF NOT ASSIGNED / NOT CALLED</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">' +
          mc2('TRADE RETURN', yd.tradeReturnPct + '%', '#22c55e') +
          mc2('MONTHLY',      yd.monthlyPct + '%',     '#22c55e') +
          mc2('ANNUALIZED',   yd.annualizedPct + '%',  '#22c55e') +
        '</div>' +
      '</div>';
    }
    if (ws.ifNotCalled && ws.ifNotCalled.yieldData) {
      var yd2 = ws.ifNotCalled.yieldData;
      html += '<div style="padding:10px;background:var(--surface2);border-radius:8px">' +
        '<div style="font-size:10px;color:var(--text2);font-weight:600;margin-bottom:4px">IF NOT CALLED</div>' +
        '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + ws.ifNotCalled.note + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">' +
          mc2('TRADE RETURN', yd2.tradeReturnPct + '%', '#22c55e') +
          mc2('MONTHLY',      yd2.monthlyPct + '%',     '#22c55e') +
          mc2('ANNUALIZED',   yd2.annualizedPct + '%',  '#22c55e') +
        '</div>' +
      '</div>';
    }
    html += '</div>';
  }

  // ── Profit tiers ──────────────────────────────────────────────────────────
  if (d.profitTiers && d.profitTiers.length > 0) {
    html += '<div class="card"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Profit Probability Tiers</div>';
    d.profitTiers.forEach(function(tier) {
      var pct2 = tier.prob != null ? Math.round(tier.prob * 100) : 0;
      var barW = Math.max(4, pct2);
      html += '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">' +
          '<span style="color:var(--text2)">' + (tier.pct * 100).toFixed(0) + '% of max ($' + tier.dollars + ')</span>' +
          '<span style="color:#22c55e;font-family:var(--mono)">' + pct2 + '% chance</span>' +
        '</div>' +
        '<div style="height:4px;background:var(--surface3);border-radius:2px">' +
          '<div style="height:100%;width:' + barW + '%;background:#22c55e;border-radius:2px"></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  // ── Long option targets ───────────────────────────────────────────────────
  if ((sg === 'long_call' || sg === 'long_put') && d.profitTargets && d.profitTargets.length > 0) {
    html += '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Realistic Profit Targets</div>' +
      '<div style="font-size:10px;color:var(--yellow);margin-bottom:10px">&#9888; Theoretical max profit is misleading. Here is what is actually realistic:</div>';
    d.profitTargets.forEach(function(t) {
      var probPct = t.prob != null ? Math.round(t.prob * 100) : 0;
      var moveDir = sg === 'long_call' ? '+' : '-';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">' +
        '<div>' +
          '<span style="font-size:12px;font-weight:600;color:var(--text)">' + moveDir + (t.movePct * 100).toFixed(0) + '% move</span>' +
          '<span style="font-size:10px;color:var(--text3);margin-left:8px">stock at $' + t.targetPrice + '</span>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:12px;font-weight:700;color:#22c55e">+$' + safeNum(t.profitDollars != null ? t.profitDollars : t.profit * 100).toFixed(0) + '</div>' +
          '<div style="font-size:10px;color:var(--text3)">Exp ' + probPct + '%</div>' +
          (t.probTouch != null ? '<div style="font-size:10px;color:var(--yellow)">Touch ' + Math.round(t.probTouch * 100) + '%</div>' : '') +
        '</div>' +
      '</div>';
    });
    if (d.framingNote) {
      html += '<div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.5">' + d.framingNote + '</div>';
    }
    html += '</div>';
  }

  // ── Key levels ────────────────────────────────────────────────────────────
  html += renderPayoffShape(d);
  html += renderModelNotes(d);

  // ── Log trade button ──────────────────────────────────────────────────────
  html += '<div style="padding:0 12px"><button class="btn btn-success btn-w" onclick="logFromAnalysis()">&check; I TOOK THIS TRADE -- LOG IT</button></div>';

  $('az-result').innerHTML = html;
}
