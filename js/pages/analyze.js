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
      entryType:     d.entryType || entryType,
      collateral:    d.collateral != null ? d.collateral : d.maxLoss,
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
      structureWarning: d.structureWarning || null,
      selectedStrategy: d.selectedStrategy || azStrat,
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
  var g = (d.summary && d.summary.greeks) || d.greeks || {};
  var items = [
    ['Delta', d.absDelta != null ? d.absDelta : g.delta],
    ['Gamma', g.gamma],
    ['Theta', g.theta],
    ['Vega',  g.vega],
    ['Rho',   g.rho]
  ];
  return '<div class="greeks-strip">' + items.map(function(item) {
    var val = item[1];
    return '<div class="greek-cell">' +
      '<div class="greek-label">' + item[0] + '</div>' +
      '<div class="greek-value">' + (val != null ? safeNum(val).toFixed(3) : 'N/A') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function toneColor(tone) {
  if (tone === 'good') return 'var(--green)';
  if (tone === 'bad') return 'var(--red)';
  if (tone === 'warn') return 'var(--yellow)';
  return 'var(--text)';
}

function isSpreadGroup(sg) {
  return ['credit_spread','put_debit_spread','call_debit_spread','iron_condor','iron_butterfly'].indexOf(sg) !== -1;
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

function fmtMoneyCents(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
}

function fmtBe(values) {
  if (!values) return 'N/A';
  var arr = Array.isArray(values) ? values : [values];
  arr = arr.filter(function(v) { return v != null && Number.isFinite(safeNum(v)); });
  if (!arr.length) return 'N/A';
  return arr.slice(0, 2).map(function(v) { return '$' + safeNum(v).toFixed(2); }).join(' / ');
}

function spreadWidthFromLegs() {
  var strikes = (azLegData || []).map(function(l) { return safeNum(l.s); }).filter(function(v) { return v > 0; });
  if (strikes.length < 2) return null;
  return Math.max.apply(null, strikes) - Math.min.apply(null, strikes);
}

function formatSignedMoney(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var n = safeNum(v);
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

function renderTopPanels(d) {
  var s = d.summary || {};
  var dte = s.dte || { label: d.dte != null ? d.dte + ' DTE' : 'Unknown', tone: 'neutral', detail: 'No expiration date' };
  var earn = s.earnings || { label: d.earningsRisk ? 'Earnings risk' : 'No earnings risk', tone: d.earningsRisk ? 'bad' : 'good', detail: d.earningsDate || 'Unknown' };
  var liq = s.liquidity || { label: 'Unknown', tone: 'neutral', detail: 'Liquidity unavailable' };
  var liqTone = liq.grade === 'Good' ? 'good' : liq.grade === 'Okay' ? 'warn' : liq.grade === 'Thin' || liq.grade === 'Poor' ? 'bad' : 'neutral';

  function panel(label, value, detail, tone) {
    return '<div class="analysis-panel">' +
      '<div class="analysis-panel-label">' + label + '</div>' +
      '<div class="analysis-panel-value" style="color:' + toneColor(tone) + '">' + value + '</div>' +
      '<div class="analysis-panel-detail">' + (detail || '&nbsp;') + '</div>' +
    '</div>';
  }

  var liqDetail = liq.detail || '';
  if (liq.minOpenInterest != null) liqDetail += (liqDetail ? '<br>' : '') + 'Min OI: ' + liq.minOpenInterest;
  if (liq.totalVolume != null) liqDetail += (liqDetail ? ' / ' : '') + 'Vol: ' + liq.totalVolume;

  return '<div class="analysis-meta-grid">' +
    panel('DTE', dte.label, dte.detail, dte.tone) +
    panel('Earnings', earn.label, earn.detail, earn.tone) +
    panel('Liquidity', liq.label || liq.grade || 'Unknown', liqDetail || 'Check bid/ask before entry', liqTone) +
  '</div>';
}

function renderUniversalMetrics(d) {
  var u = (d.summary && d.summary.universal) || {};
  var cushion = u.cushionPct ?? d.cushionPct ?? d.minCushionPct ?? d.beCushionPct;
  var prob = u.probWorthless ?? (d.probWorthless != null ? Math.round(d.probWorthless * 100) : d.probMaxProfit != null ? Math.round(d.probMaxProfit * 100) : null);
  var theta = u.dailyTheta ?? (d.dailyThetaDollars != null ? d.dailyThetaDollars : d.dailyDecay != null ? d.dailyDecay * 100 : null);
  var be = u.breakevens || d.breakeven || d.lowerBE || d.putBreakeven || null;
  var sg = d.strategyGroup || '';
  var maxProfitText = fmtRiskMoney(u.maxProfit ?? d.maxProfit, u.maxProfitUnlimited || d.maxProfitUnlimited);
  var maxLossText = fmtRiskMoney(u.maxLoss ?? d.maxLoss ?? d.collateral, u.maxLossUnlimited || d.maxLossUnlimited);
  var probAgainst = sg === 'long_call' || sg === 'long_put';

  function cell(label, value, color, sub) {
    return '<div class="universal-metric">' +
      '<div class="universal-label">' + label + '</div>' +
      '<div class="universal-value" style="color:' + (color || 'var(--text)') + '">' + value + '</div>' +
      '<div class="universal-sub">' + (sub || '&nbsp;') + '</div>' +
    '</div>';
  }

  return '<div class="universal-metrics">' +
    cell('Cushion', cushion != null ? cushion + '%' : 'N/A', cushion != null ? cushC(cushion) : 'var(--text)', 'Distance from key risk level') +
    cell('Max Profit', maxProfitText, 'var(--green)', d.entryType === 'debit' ? 'Maximum gain' : 'Credit / income potential') +
    cell('Max Loss / Risk', maxLossText, 'var(--red)', (u.maxLossUnlimited || d.maxLossUnlimited) ? 'Undefined risk' : 'Defined risk') +
    cell('Breakeven', fmtBe(be), 'var(--text)', 'At expiration') +
    cell('Prob. Worthless', prob != null ? prob + '%' : 'N/A', probAgainst ? 'var(--red)' : 'var(--green)', probAgainst ? 'Works against long options' : 'Works in your favor') +
    cell('Est. Daily Theta', theta != null ? formatSignedMoney(theta) : 'N/A', theta == null ? 'var(--text)' : theta >= 0 ? 'var(--green)' : 'var(--red)', theta == null ? 'Estimate unavailable' : theta >= 0 ? 'Time decay in your favor' : 'Time decay against you') +
  '</div>';
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
  var beVals = [];
  if (d.payoff && d.payoff.breakevens) beVals = beVals.concat(d.payoff.breakevens);
  ['breakeven', 'lowerBE', 'upperBE', 'putBreakeven', 'callBreakeven'].forEach(function(k) {
    if (d[k] != null) beVals.push(d[k]);
  });
  beVals = beVals.filter(function(v, idx, arr) {
    return v != null && Number.isFinite(safeNum(v)) &&
      arr.findIndex(function(o) { return Math.abs(safeNum(o) - safeNum(v)) < 0.01; }) === idx;
  });

  if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.openingCredit != null) rows.push({ label:'Opening credit', px:null, pnl:safeNum(d.openingCredit), note:'Collected at entry', kind:'credit' });
    if (d.openingDebit != null) rows.push({ label:'Opening debit', px:null, pnl:-safeNum(d.openingDebit), note:'Paid at entry', kind:'debit' });
    if (profitMarkers[0]) row('Max at body', profitMarkers[0].px, 'Best expiration area', 'profit', profitMarkers[0].pnl);
    beVals.slice(0, 2).forEach(function(v, i) { row(i ? 'Upper breakeven' : 'Lower breakeven', v, 'P/L is about $0', 'be', 0); });
    if (lossMarkers[0]) row('Max loss', lossMarkers[0].px, 'Worst expiration area', 'loss', lossMarkers[0].pnl);
  } else {
    if (profitMarkers[0]) row('Max profit', profitMarkers[0].px, 'Best expiration area', 'profit', profitMarkers[0].pnl);
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
    return m.px > 0 && m.px >= low && m.px <= high;
  });
  var markerSvg = markers.slice(0, 8).map(function(m, idx) {
    var col = m.kind === 'be' ? 'var(--yellow)' : m.kind === 'profit' ? '#22c55e' : m.kind === 'loss' ? '#ef4444' : 'var(--text2)';
    var mx = x({ px: m.px });
    var ty = idx % 2 ? h - 5 : 10;
    var label = m.label.replace(/Max profit/g, 'Max Profit').replace(/Max loss/g, 'Max Loss').replace(/Breakeven/g, 'BE');
    return '<line x1="' + mx.toFixed(1) + '" y1="' + pad + '" x2="' + mx.toFixed(1) + '" y2="' + (h - pad) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".65"/>' +
      (label ? '<text x="' + mx.toFixed(1) + '" y="' + ty + '" text-anchor="middle" fill="' + col + '" font-size="6" font-family="monospace">' + label + '</text>' : '');
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
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:5px;font-family:var(--mono)"><span>$' + low.toFixed(0) + '</span><span>Current $' + d.price + '</span><span>$' + high.toFixed(0) + '</span></div>' +
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
  var sg = d.strategyGroup || '';
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
      return '<span style="display:inline-block;margin-right:14px;margin-bottom:6px">' +
        '<span style="font-family:var(--mono);font-size:13px;color:' + col + ';font-weight:700">$' + p + '</span>' +
        levelTags(p, kind) +
      '</span>';
    }).join('');
  }
  function mini(label, val, color, sub) {
    return '<div class="context-card">' +
      '<div class="analysis-panel-label">' + label + '</div>' +
      '<div class="context-value" style="color:' + (color || 'var(--text)') + '">' + val + '</div>' +
      (sub ? '<div class="analysis-panel-detail">' + sub + '</div>' : '') +
    '</div>';
  }

  var primary = [];
  var width = spreadWidthFromLegs();
  if (sg === 'credit_spread') {
    if (width != null) primary.push(mini('Spread width', fmtMoneyCents(width), 'var(--text)', d.crWidthPct != null ? d.crWidthPct + '% of width collected' : 'Defined-risk spread'));
    if (d.crWidthPct != null) primary.push(mini('% of width', d.crWidthPct + '%', d.crWidthPct >= prefs.creditWidthMin ? 'var(--green)' : 'var(--yellow)', 'Credit quality check'));
    if (d.riskReward != null) primary.push(mini('Risk / reward', d.riskReward + ':1', d.riskReward <= 4 ? 'var(--green)' : 'var(--yellow)', 'Risk per $1 reward'));
    if (d.exitSignal) primary.push(mini('Exit trigger', '$' + d.exitSignal, 'var(--yellow)', 'Suggested risk line'));
  } else if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
    if (width != null) primary.push(mini('Spread width', fmtMoneyCents(width), 'var(--text)', 'Max value at expiration'));
    if (d.movePct != null) primary.push(mini('Move needed', d.movePct + '%', d.movePct < 5 ? 'var(--green)' : d.movePct < 10 ? 'var(--yellow)' : 'var(--red)', 'To breakeven'));
    if (d.riskReward != null) primary.push(mini('Risk / reward', d.riskReward + ':1', d.riskReward < 1 ? 'var(--green)' : 'var(--yellow)', 'Debit paid vs reward'));
  } else if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.openingCredit != null) primary.push(mini('Opening credit', fmtMoney(d.openingCredit), 'var(--green)', 'Collected at entry'));
    if (d.openingDebit != null) primary.push(mini('Opening debit', fmtMoney(d.openingDebit), 'var(--red)', 'Paid at entry'));
    if (d.creditCapturePct != null) primary.push(mini('Credit capture', d.creditCapturePct + '%', d.creditCapturePct >= 60 ? 'var(--green)' : 'var(--yellow)', 'If it moves away from body'));
    if (d.wingRatioLabel) primary.push(mini('Wing ratio', d.wingRatioLabel, 'var(--text)', 'Structure balance'));
  } else if (sg === 'long_call' || sg === 'long_put') {
    if (d.profitTargets && d.profitTargets[0]) primary.push(mini('First target', '$' + d.profitTargets[0].targetPrice, 'var(--green)', d.profitTargets[0].label || 'Realistic target'));
    if (d.probTouchBreakeven != null) primary.push(mini('Touch breakeven', Math.round(d.probTouchBreakeven * 100) + '%', 'var(--yellow)', 'Before expiration'));
  } else if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (width != null) primary.push(mini('Wing width', fmtMoneyCents(width), 'var(--text)', 'Outer defined risk'));
    if (d.probTouchPutShort != null || d.probTouchCallShort != null) {
      primary.push(mini('Touch shorts', (d.probTouchPutShort != null ? 'P ' + Math.round(d.probTouchPutShort * 100) + '%' : '') + (d.probTouchCallShort != null ? ' C ' + Math.round(d.probTouchCallShort * 100) + '%' : ''), 'var(--yellow)', 'Before expiration'));
    }
  }

  if (!primary.length && d.exitSignal) primary.push(mini('Exit trigger', '$' + d.exitSignal, 'var(--yellow)', 'Suggested risk line'));
  if (d.em != null) primary.push(mini('Expected move', '&plusmn;$' + d.em, 'var(--yellow)', 'One-volatility move'));

  var secondary = '';
  if (supports.length || resistances.length || d.sma20) {
    secondary = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
      '<div style="display:flex;gap:22px;flex-wrap:wrap">' +
        (supports.length ? '<div><div class="analysis-panel-label" style="color:var(--green)">Support</div><div>' + levelHtml(supports, 'support') + '</div></div>' : '') +
        (resistances.length ? '<div><div class="analysis-panel-label" style="color:var(--red)">Resistance</div><div>' + levelHtml(resistances, 'resistance') + '</div></div>' : '') +
      '</div>' +
      (d.sma20 ? '<div style="font-size:10px;color:var(--text3);margin-top:6px">SMA20 $' + d.sma20 + ' / SMA50 $' + d.sma50 + '</div>' : '') +
    '</div>';
  }

  if (!primary.length && !secondary) return '';
  return '<div class="card">' +
    '<div class="analysis-panel-label" style="margin-bottom:10px">Trade Context</div>' +
    '<div class="context-grid">' + primary.join('') + '</div>' +
    secondary +
  '</div>';
}

function renderLongTargets(d) {
  if (!((d.strategyGroup || '') === 'long_call' || (d.strategyGroup || '') === 'long_put') || !d.profitTargets || !d.profitTargets.length) return '';
  return '<div class="card">' +
    '<div class="analysis-panel-label" style="margin-bottom:10px">Realistic Targets</div>' +
    '<div style="display:grid;gap:6px">' +
      d.profitTargets.map(function(t) {
        var probPct = t.prob != null ? Math.round(t.prob * 100) : null;
        var touchPct = t.probTouch != null ? Math.round(t.probTouch * 100) : null;
        var profitDollars = safeNum(t.profitDollars != null ? t.profitDollars : t.profit * 100);
        return '<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">' +
          '<div><strong style="font-size:12px;color:var(--text)">' + (t.label || ('+$' + profitDollars.toFixed(0))) + '</strong><span style="font-size:10px;color:var(--text3);margin-left:8px">$' + t.targetPrice + '</span></div>' +
          '<div style="font-family:var(--mono);font-size:12px;color:' + (profitDollars > 0 ? 'var(--green)' : 'var(--text2)') + '">' + (profitDollars > 0 ? '+$' : '$') + profitDollars.toFixed(0) + '</div>' +
          '<div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-align:right">' + (probPct != null ? 'Exp ' + probPct + '%' : '') + (touchPct != null ? ' / Touch ' + touchPct + '%' : '') + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    (d.framingNote ? '<div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.5">' + d.framingNote + '</div>' : '') +
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

  var heroTone = sig === 'GO' ? 'good' : sig === 'NO-GO' ? 'bad' : 'warn';
  var cleanHtml = '<div class="analysis-shell">' +
    '<div class="analysis-hero ' + heroTone + '">' +
      '<div class="signal-dot" style="background:' + sc + '">' + sigLabel + '</div>' +
      '<div>' +
        '<div class="analysis-title">' + d.ticker + ' &mdash; ' + d.strategy + '</div>' +
        '<div class="analysis-sub">' +
          reasons.map(function(r) {
            var ic = issues.find(function(i) { return i.msg === r; });
            var col = ic ? (ic.level === 'critical' ? 'var(--red)' : ic.level === 'note' ? 'var(--text2)' : 'var(--yellow)') : 'var(--green)';
            return '<span style="color:' + col + '">' + r + '</span>';
          }).join('<br>') +
        '</div>' +
        (fmtAsOf(d.lastDate) ? '<div style="font-size:10px;color:var(--text3);margin-top:6px">Quote as of ' + fmtAsOf(d.lastDate) + '</div>' : '') +
      '</div>' +
    '</div>' +
    (d.structureWarning ? '<div class="structure-warning">' + esc(d.structureWarning) + '</div>' : '') +
    renderTopPanels(d) +
    renderGreekBox(d) +
    renderUniversalMetrics(d) +
    renderTradeContext(d) +
    renderLongTargets(d) +
    renderPayoffShape(d) +
    renderModelNotes(d) +
    '<div><button class="btn btn-success btn-w" onclick="logFromAnalysis()">&check; I TOOK THIS TRADE -- LOG IT</button></div>' +
  '</div>';
  $('az-result').innerHTML = cleanHtml;
  return;

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
          var col = ic ? (ic.level === 'critical' ? '#ef4444' : ic.level === 'note' ? 'var(--text2)' : '#f59e0b') : '#22c55e';
          return '<span style="color:' + col + '">' + r + '</span>';
        }).join('<br>') +
      '</div>' +
      (fmtAsOf(d.lastDate) ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">Quote as of ' + fmtAsOf(d.lastDate) + '</div>' : '') +
    '</div>' +
  '</div>';

  if (d.structureWarning) {
    html += '<div style="margin:0 12px 10px;padding:10px 12px;background:var(--yellow-dim);border:1px solid rgba(245,158,11,.28);border-radius:9px;color:var(--yellow);font-size:11px;line-height:1.5">' +
      esc(d.structureWarning) +
    '</div>';
  }
  html += renderGreekBox(d);

  // ── Metrics grid ─────────────────────────────────────────────────────────
  var metrics = [];
  var sg = d.strategyGroup || '';

  if (!isSpreadGroup(sg)) {
    metrics.push(mc2('LIVE PRICE', d.price ? '$' + safeNum(d.price).toFixed(2) : 'N/A', 'var(--text)'));
  }

  if (sg === 'credit_spread' || sg === 'csp' || sg === 'covered_call') {
    if (d.cushionPct != null)   metrics.push(mc2('CUSHION',      d.cushionPct + '%',              cushC(d.cushionPct)));
    if (sg !== 'credit_spread' && d.breakeven != null) metrics.push(mc2('BREAKEVEN', '$' + d.breakeven, 'var(--text)'));
    if (d.crWidthPct != null)   metrics.push(mc2('CR/WIDTH',     d.crWidthPct + '%',              d.crWidthPct >= prefs.creditWidthMin ? '#22c55e' : '#f59e0b'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
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
    if (d.wingRatioLabel != null) metrics.push(mc2('WING RATIO', d.wingRatioLabel, 'var(--text)'));
    if (d.crRatio != null)      metrics.push(mc2('CR/RISK',     d.crRatio + '%',              d.crRatio >= 20 ? '#22c55e' : d.crRatio >= 12 ? '#f59e0b' : '#ef4444'));
    if (d.creditCapturePct != null) metrics.push(mc2('CREDIT CAPTURE', d.creditCapturePct + '%', d.creditCapturePct >= 60 ? '#22c55e' : d.creditCapturePct >= 35 ? '#f59e0b' : '#ef4444'));
  }
  if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
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
  if (sg === 'custom') {
    if (d.breakeven != null) metrics.push(mc2('BREAKEVEN', '$' + d.breakeven, 'var(--text)'));
    if (d.maxProfit != null || d.maxProfitUnlimited) metrics.push(mc2('MAX PROFIT', fmtRiskMoney(d.maxProfit, d.maxProfitUnlimited), '#22c55e'));
    if (d.maxLoss != null || d.maxLossUnlimited)     metrics.push(mc2('MAX LOSS',   fmtRiskMoney(d.maxLoss, d.maxLossUnlimited),     '#ef4444'));
    if (d.collateral != null) metrics.push(mc2('RISK', '$' + safeNum(d.collateral).toFixed(0), '#ef4444'));
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
      '<div style="font-size:10px;color:var(--yellow);margin-bottom:8px">Small odds are normal for long options; touch odds and expiration odds answer different questions.</div>' +
      '<div style="display:grid;gap:4px">';
    d.profitTargets.forEach(function(t) {
      var probPct = t.prob != null ? Math.round(t.prob * 100) : 0;
      var touchPct = t.probTouch != null ? Math.round(t.probTouch * 100) : null;
      var profitDollars = safeNum(t.profitDollars != null ? t.profitDollars : t.profit * 100);
      html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:7px 9px;background:var(--surface2);border:1px solid var(--border);border-radius:7px">' +
        '<div style="min-width:0">' +
          '<span style="font-size:11px;font-weight:700;color:var(--text)">' + (t.label || ('+$' + profitDollars.toFixed(0))) + '</span>' +
          '<span style="font-size:10px;color:var(--text3);margin-left:8px">$' + t.targetPrice + '</span>' +
        '</div>' +
        '<div style="font-size:11px;font-family:var(--mono);color:' + (profitDollars > 0 ? '#22c55e' : 'var(--text2)') + '">' + (profitDollars > 0 ? '+$' : '$') + profitDollars.toFixed(0) + '</div>' +
        '<div style="font-size:10px;font-family:var(--mono);color:var(--text3);text-align:right">Exp ' + probPct + '%' + (touchPct != null ? ' / Touch ' + touchPct + '%' : '') + '</div>' +
      '</div>';
    });
    html += '</div>';
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
