// =============================================================================
// js/pages/analyze.js -- Analyze page: trade setup form + results display
// Depends on globals: azLegData, azStrat, azResult, prefs, API, DEF,
//   STRAT_GROUPS, safeNum(), calcCollateral(), cushC(), spinHtml(),
//   mc2(), g3html(), showPage(), logFromAnalysis() from trades.js
// =============================================================================

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
    '<div class="fg2">' +
      '<div class="fld"><label>Collateral $ (auto)</label>' +
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
  var col = calcCollateral(azStrat, azLegData, cr);
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
      collateral:    d.collateral || calcCollateral(azStrat, azLegData, credit),
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
  if (metrics.length % 2 === 1) {
    metrics.push(mc2('STRUCTURE', 'Defined', 'var(--text2)'));
  }
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 12px 10px">' + metrics.join('') + '</div>';
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(0);
}

function renderModelNotes(d) {
  var notes = d.modelNotes || [];
  if (!notes.length) return '';
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 12px 10px">' +
    notes.slice(0, 4).map(function(n) {
      var isWeak = n.level === 'weak';
      return '<span style="display:inline-flex;align-items:center;gap:6px;background:' + (isWeak ? 'var(--red-dim)' : 'var(--yellow-dim)') + ';border:1px solid ' + (isWeak ? 'rgba(239,68,68,.25)' : 'rgba(245,158,11,.25)') + ';border-radius:7px;padding:6px 8px;font-size:10px;line-height:1.35;color:' + (isWeak ? '#fca5a5' : 'var(--yellow)') + '">' +
        '<strong style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">' + (isWeak ? 'Weak estimate' : 'Model') + '</strong>' +
        '<span style="color:var(--text2)">' + n.msg + '</span>' +
      '</span>';
    }).join('') +
  '</div>';
}

function estimatePayoff(d, px) {
  var legs = azLegData || [];
  if (!legs.length) return null;
  var premium = safeNum($('az-cr') ? $('az-cr').value : d.credit || d.prem || d.debit || 0);
  var netPremium = isDebitStrat(d.strategy) ? -premium : premium;
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

function renderPayoffShape(d) {
  if (!d.price) return '';
  var strikes = (azLegData || []).map(function(l) { return safeNum(l.s); }).filter(function(s) { return s > 0; });
  var beVals = [d.breakeven, d.lowerBE, d.upperBE, d.putBreakeven, d.callBreakeven]
    .map(function(v) { return safeNum(v); })
    .filter(function(v) { return v > 0; });
  var anchorVals = strikes.concat(beVals).concat([d.price]);
  var minAnchor = Math.min.apply(null, anchorVals);
  var maxAnchor = Math.max.apply(null, anchorVals);
  var span = Math.max(d.price * 0.18, maxAnchor - minAnchor, 1);
  var low = Math.max(0.01, Math.min(d.price * 0.75, minAnchor - span * 0.35));
  var high = Math.max(d.price * 1.25, maxAnchor + span * 0.35);
  var points = [];
  for (var i = 0; i <= 48; i++) {
    var px = low + (high - low) * i / 48;
    var pnl = estimatePayoff(d, px);
    if (pnl == null || !Number.isFinite(pnl)) return '';
    points.push({ px: px, pnl: pnl });
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
  function pointLabel(label, px, kind) {
    if (!px || px < low || px > high) return null;
    return { label: label, px: px, pnl: payoffAt(px), kind: kind || 'marker' };
  }
  var markers = [];
  markers.push(pointLabel('Now', d.price, 'now'));
  if (d.breakeven) markers.push(pointLabel('BE', safeNum(d.breakeven), 'be'));
  if (d.lowerBE) markers.push(pointLabel('Lower BE', safeNum(d.lowerBE), 'be'));
  if (d.upperBE) markers.push(pointLabel('Upper BE', safeNum(d.upperBE), 'be'));
  if (d.putBreakeven) markers.push(pointLabel('Put BE', safeNum(d.putBreakeven), 'be'));
  if (d.callBreakeven) markers.push(pointLabel('Call BE', safeNum(d.callBreakeven), 'be'));
  (azLegData || []).forEach(function(leg) {
    var label = (leg.a === 'SELL' ? 'Short ' : 'Long ') + (leg.t || '').slice(0, 1) + ' ' + leg.s;
    markers.push(pointLabel(label, safeNum(leg.s), leg.a === 'SELL' ? 'short' : 'long'));
  });
  markers = markers.filter(Boolean).filter(function(m, idx, arr) {
    return arr.findIndex(function(o) { return o.label === m.label && Math.abs(o.px - m.px) < 0.01; }) === idx;
  });
  var maxPoint = points.reduce(function(best, p) { return p.pnl > best.pnl ? p : best; }, points[0]);
  var minPoint = points.reduce(function(best, p) { return p.pnl < best.pnl ? p : best; }, points[0]);
  var checkpointRows = markers.slice(0, 8);
  checkpointRows.push({ label:'Max profit zone', px:maxPoint.px, pnl:maxPoint.pnl, kind:'profit' });
  checkpointRows.push({ label:'Max loss zone', px:minPoint.px, pnl:minPoint.pnl, kind:'loss' });
  var markerSvg = markers.slice(0, 8).map(function(m, idx) {
    var col = m.kind === 'now' ? 'var(--blue2)' : m.kind === 'be' ? 'var(--yellow)' : m.kind === 'short' ? '#fca5a5' : '#86efac';
    var mx = x({ px: m.px });
    var ty = idx % 2 ? h - 5 : 10;
    return '<line x1="' + mx.toFixed(1) + '" y1="' + pad + '" x2="' + mx.toFixed(1) + '" y2="' + (h - pad) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".75"/>' +
      '<text x="' + mx.toFixed(1) + '" y="' + ty + '" text-anchor="middle" fill="' + col + '" font-size="6" font-family="monospace">' + m.label.replace(/ /g, '') + '</text>';
  }).join('');
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">P/L Shape at Expiration</div>' +
      '<div style="font-size:9px;color:var(--text3);font-family:var(--mono)">per contract</div>' +
    '</div>' +
    '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:140px;display:block;background:var(--surface2);border:1px solid var(--border);border-radius:8px">' +
      '<line x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border2)" stroke-width="1"/>' +
      markerSvg +
      '<polyline points="' + line + '" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:5px;font-family:var(--mono)"><span>$' + low.toFixed(0) + '</span><span>Now $' + d.price + '</span><span>$' + high.toFixed(0) + '</span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin-top:10px">' +
      checkpointRows.map(function(m) {
        var col = m.pnl >= 0 ? '#22c55e' : '#ef4444';
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:7px 8px;min-width:0">' +
          '<div style="font-size:9px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-top:3px;font-family:var(--mono)">' +
            '<span style="font-size:11px;color:var(--text2)">$' + safeNum(m.px).toFixed(2) + '</span>' +
            '<span style="font-size:12px;font-weight:800;color:' + col + '">' + fmtMoney(m.pnl) + '</span>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
  '</div>';
}

function renderCompactLevels(d) {
  var supports = d.supports || [];
  var resistances = d.resistances || [];
  if (!supports.length && !resistances.length && !d.exitSignal && !d.sma20) return '';
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
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
      '<div style="flex:1">' +
        '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Key Levels</div>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap">' +
          (supports.length ? '<div><div style="font-size:9px;color:var(--green);letter-spacing:1px;margin-bottom:4px">SUPPORT</div><div>' + levelHtml(supports, 'support') + '</div></div>' : '') +
          (resistances.length ? '<div><div style="font-size:9px;color:var(--red);letter-spacing:1px;margin-bottom:4px">RESISTANCE</div><div>' + levelHtml(resistances, 'resistance') + '</div></div>' : '') +
        '</div>' +
      '</div>' +
      (d.exitSignal ? '<div style="font-size:10px;color:#fca5a5;border:1px solid rgba(239,68,68,.2);background:var(--red-dim);border-radius:7px;padding:7px 9px;white-space:nowrap">Exit below $' + d.exitSignal + '</div>' : '') +
    '</div>' +
    (d.sma20 ? '<div style="font-size:10px;color:var(--text3);margin-top:8px">SMA20 $' + d.sma20 + ' / SMA50 $' + d.sma50 + '</div>' : '') +
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
      (d.lastDate ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">Price as of ' + d.lastDate + '</div>' : '') +
    '</div>' +
  '</div>';
  html += renderGreekBox(d);
  html += renderModelNotes(d);

  // ── Metrics grid ─────────────────────────────────────────────────────────
  var metrics = [];
  var sg = d.strategyGroup || '';

  metrics.push(mc2('LIVE PRICE', d.price ? '$' + d.price : 'N/A', 'var(--text)'));

  if (sg === 'credit_spread' || sg === 'csp' || sg === 'covered_call') {
    if (d.cushionPct != null)   metrics.push(mc2('CUSHION',      d.cushionPct + '%',              cushC(d.cushionPct)));
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',    '$' + d.breakeven,               'var(--text)'));
    if (d.crWidthPct != null)   metrics.push(mc2('CR/WIDTH',     d.crWidthPct + '%',              d.crWidthPct >= prefs.creditWidthMin ? '#22c55e' : '#f59e0b'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',   '$' + d.maxProfit.toFixed(0),    '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',     '$' + d.maxLoss.toFixed(0),      '#ef4444'));
    if (d.probWorthless != null)metrics.push(mc2('EXP WORTHLESS', Math.round(d.probWorthless * 100) + '%', '#22c55e'));
    if (d.probTouchShort != null)metrics.push(mc2('TOUCH SHORT', Math.round(d.probTouchShort * 100) + '%', '#f59e0b'));
  }
  if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (d.putCushionPct != null)  metrics.push(mc2('PUT CUSHION',     d.putCushionPct + '%',           cushC(d.putCushionPct)));
    if (d.callCushionPct != null) metrics.push(mc2('CALL CUSHION',    d.callCushionPct + '%',          cushC(d.callCushionPct)));
    if (d.putBreakeven != null)   metrics.push(mc2('PUT BE',          '$' + d.putBreakeven,            'var(--text)'));
    if (d.callBreakeven != null)  metrics.push(mc2('CALL BE',         '$' + d.callBreakeven,           'var(--text)'));
    if (d.maxProfit != null)      metrics.push(mc2('MAX PROFIT',      '$' + d.maxProfit.toFixed(0),    '#22c55e'));
    if (d.maxLoss != null)        metrics.push(mc2('MAX LOSS',        '$' + d.maxLoss.toFixed(0),      '#ef4444'));
    if (d.probMaxProfit != null)  metrics.push(mc2('EXP MAX PROFIT', Math.round(d.probMaxProfit * 100) + '%', '#f59e0b'));
    if (d.probAnyProfit != null)  metrics.push(mc2('EXP PROFIT',     Math.round(d.probAnyProfit * 100) + '%', '#22c55e'));
  }
  if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.lowerBE != null)      metrics.push(mc2('LOWER BE',    '$' + d.lowerBE,              'var(--text)'));
    if (d.upperBE != null)      metrics.push(mc2('UPPER BE',    '$' + d.upperBE,              'var(--text)'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',  '$' + d.maxProfit.toFixed(0), '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',    '$' + d.maxLoss.toFixed(0),   '#ef4444'));
    if (d.crRatio != null)      metrics.push(mc2('CR/RISK',     d.crRatio + '%',              d.crRatio >= 20 ? '#22c55e' : d.crRatio >= 12 ? '#f59e0b' : '#ef4444'));
    if (d.probMaxProfit != null)metrics.push(mc2('EXP MAX',    Math.round(d.probMaxProfit * 100) + '%', '#f59e0b'));
    if (d.probAnyProfit != null)metrics.push(mc2('EXP PROFIT', Math.round(d.probAnyProfit * 100) + '%', '#22c55e'));
  }
  if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',   '$' + d.breakeven,            'var(--text)'));
    if (d.movePct != null)      metrics.push(mc2('MOVE NEEDED', d.movePct + '%',              d.movePct < 5 ? '#22c55e' : d.movePct < 10 ? '#f59e0b' : '#ef4444'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',  '$' + d.maxProfit.toFixed(0), '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',    '$' + d.maxLoss.toFixed(0),   '#ef4444'));
    if (d.riskReward != null)   metrics.push(mc2('RISK/REWARD', d.riskReward + ':1',          d.riskReward < 1 ? '#22c55e' : d.riskReward < 2 ? '#f59e0b' : '#ef4444'));
    if (d.probAnyProfit != null)metrics.push(mc2('EXP PROFIT', Math.round(d.probAnyProfit * 100) + '%', '#22c55e'));
  }
  if (sg === 'long_call' || sg === 'long_put') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',     '$' + d.breakeven,                         'var(--text)'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',      '$' + d.maxLoss.toFixed(0),               '#ef4444'));
    if (d.probWorthless != null)metrics.push(mc2('EXP WORTHLESS',Math.round(d.probWorthless * 100) + '%',  '#ef4444'));
    if (d.dailyDecay != null)   metrics.push(mc2('DAILY DECAY',   '~$' + (d.dailyDecay * 100).toFixed(2),  '#f59e0b'));
  }

  if (d.em != null) metrics.push(mc2('EXP MOVE', '\u00b1$' + d.em, '#f59e0b'));

  var earnCol = d.earningsRisk ? '#ef4444' : '#22c55e';
  var earnVal = d.earningsRisk
    ? '\u26a0 ' + d.earningsDate
    : (d.earningsDate ? '\u2713 ' + d.earningsDate : '\u2713 CLEAR');
  metrics.push(mc2('EARNINGS', earnVal, earnCol));

  html += renderMetricGrid(metrics);

  // ── Wheel scenarios ───────────────────────────────────────────────────────
  if (d.wheelScenarios) {
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
  html += renderCompactLevels(d);
  html += renderPayoffShape(d);

  // ── Log trade button ──────────────────────────────────────────────────────
  html += '<div style="padding:0 12px"><button class="btn btn-success btn-w" onclick="logFromAnalysis()">&check; I TOOK THIS TRADE -- LOG IT</button></div>';

  $('az-result').innerHTML = html;
}
