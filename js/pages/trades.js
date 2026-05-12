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
  // Flush any strike values not yet committed by blur
  document.querySelectorAll('#az-lc .strike-input').forEach(function(inp, i) {
    if (azLegData[i]) azLegData[i].s = inp.value;
  });
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
      '<div style="font-weight:700;font-size:15px;color:' + sc + '">' + d.ticker + ' &mdash; ' + d.strategy + '</div>' +
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

  // ── Metrics grid ─────────────────────────────────────────────────────────
  var metrics = [];
  var sg = d.strategyGroup || '';

  metrics.push(mc2('LIVE PRICE', d.price ? '$' + d.price : 'N/A', 'var(--text)'));

  if (d.dte != null) {
    var dteCol = d.dte >= prefs.dteLow && d.dte <= prefs.dteHigh ? '#22c55e' : d.dte < prefs.dteLow ? '#f59e0b' : 'var(--text3)';
    metrics.push(mc2('DTE', d.dte + 'd', dteCol));
  }
  if (d.absDelta != null) {
    var deltaCol = d.absDelta <= prefs.deltaHigh ? '#22c55e' : d.absDelta <= prefs.deltaHigh + 0.05 ? '#f59e0b' : '#ef4444';
    metrics.push(mc2('DELTA', d.absDelta.toFixed(3) + (d.deltaSource === 'Tradier' ? ' \u2713' : ' ~'), deltaCol));
  }
  if (d.iv != null)        metrics.push(mc2('IV',   d.iv + '%',   'var(--text)'));
  else if (d.hv30 != null) metrics.push(mc2('HV30', d.hv30 + '%', 'var(--text3)'));

  if (sg === 'credit_spread' || sg === 'csp' || sg === 'covered_call') {
    if (d.cushionPct != null)   metrics.push(mc2('CUSHION',      d.cushionPct + '%',              cushC(d.cushionPct)));
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',    '$' + d.breakeven,               'var(--text)'));
    if (d.crWidthPct != null)   metrics.push(mc2('CR/WIDTH',     d.crWidthPct + '%',              d.crWidthPct >= prefs.creditWidthMin ? '#22c55e' : '#f59e0b'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',   '$' + d.maxProfit.toFixed(0),    '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',     '$' + d.maxLoss.toFixed(0),      '#ef4444'));
    if (d.probWorthless != null)metrics.push(mc2('PROB WORTHLESS', Math.round(d.probWorthless * 100) + '%', '#22c55e'));
  }
  if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (d.putCushionPct != null)  metrics.push(mc2('PUT CUSHION',     d.putCushionPct + '%',           cushC(d.putCushionPct)));
    if (d.callCushionPct != null) metrics.push(mc2('CALL CUSHION',    d.callCushionPct + '%',          cushC(d.callCushionPct)));
    if (d.putBreakeven != null)   metrics.push(mc2('PUT BE',          '$' + d.putBreakeven,            'var(--text)'));
    if (d.callBreakeven != null)  metrics.push(mc2('CALL BE',         '$' + d.callBreakeven,           'var(--text)'));
    if (d.maxProfit != null)      metrics.push(mc2('MAX PROFIT',      '$' + d.maxProfit.toFixed(0),    '#22c55e'));
    if (d.maxLoss != null)        metrics.push(mc2('MAX LOSS',        '$' + d.maxLoss.toFixed(0),      '#ef4444'));
    if (d.probMaxProfit != null)  metrics.push(mc2('PROB MAX PROFIT', Math.round(d.probMaxProfit * 100) + '%', '#f59e0b'));
  }
  if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.lowerBE != null)      metrics.push(mc2('LOWER BE',    '$' + d.lowerBE,              'var(--text)'));
    if (d.upperBE != null)      metrics.push(mc2('UPPER BE',    '$' + d.upperBE,              'var(--text)'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',  '$' + d.maxProfit.toFixed(0), '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',    '$' + d.maxLoss.toFixed(0),   '#ef4444'));
    if (d.crRatio != null)      metrics.push(mc2('CR/RISK',     d.crRatio + '%',              d.crRatio >= 20 ? '#22c55e' : d.crRatio >= 12 ? '#f59e0b' : '#ef4444'));
    if (d.probMaxProfit != null)metrics.push(mc2('PROB MAX',    Math.round(d.probMaxProfit * 100) + '%', '#f59e0b'));
    if (d.probAnyProfit != null)metrics.push(mc2('PROB PROFIT', Math.round(d.probAnyProfit * 100) + '%', '#22c55e'));
  }
  if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',   '$' + d.breakeven,            'var(--text)'));
    if (d.movePct != null)      metrics.push(mc2('MOVE NEEDED', d.movePct + '%',              d.movePct < 5 ? '#22c55e' : d.movePct < 10 ? '#f59e0b' : '#ef4444'));
    if (d.maxProfit != null)    metrics.push(mc2('MAX PROFIT',  '$' + d.maxProfit.toFixed(0), '#22c55e'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',    '$' + d.maxLoss.toFixed(0),   '#ef4444'));
    if (d.riskReward != null)   metrics.push(mc2('RISK/REWARD', d.riskReward + ':1',          d.riskReward < 1 ? '#22c55e' : d.riskReward < 2 ? '#f59e0b' : '#ef4444'));
    if (d.probAnyProfit != null)metrics.push(mc2('PROB PROFIT', Math.round(d.probAnyProfit * 100) + '%', '#22c55e'));
  }
  if (sg === 'long_call' || sg === 'long_put') {
    if (d.breakeven != null)    metrics.push(mc2('BREAKEVEN',     '$' + d.breakeven,                         'var(--text)'));
    if (d.maxLoss != null)      metrics.push(mc2('MAX LOSS',      '$' + d.maxLoss.toFixed(0),               '#ef4444'));
    if (d.probITM != null)      metrics.push(mc2('PROB ITM',      Math.round(d.probITM * 100) + '%',        '#22c55e'));
    if (d.probWorthless != null)metrics.push(mc2('PROB WORTHLESS',Math.round(d.probWorthless * 100) + '%',  '#ef4444'));
    if (d.dailyDecay != null)   metrics.push(mc2('DAILY DECAY',   '~$' + (d.dailyDecay * 100).toFixed(2),  '#f59e0b'));
  }

  if (d.em != null) metrics.push(mc2('EXP MOVE', '\u00b1$' + d.em, '#f59e0b'));

  var earnCol = d.earningsRisk ? '#ef4444' : '#22c55e';
  var earnVal = d.earningsRisk
    ? '\u26a0 ' + d.earningsDate
    : (d.earningsDate ? '\u2713 ' + d.earningsDate : '\u2713 CLEAR');
  metrics.push(mc2('EARNINGS', earnVal, earnCol));

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 12px 10px">' + metrics.join('') + '</div>';

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
          '<div style="font-size:12px;font-weight:700;color:#22c55e">+$' + t.profit.toFixed(0) + '</div>' +
          '<div style="font-size:10px;color:var(--text3)">' + probPct + '% chance</div>' +
        '</div>' +
      '</div>';
    });
    if (d.framingNote) {
      html += '<div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.5">' + d.framingNote + '</div>';
    }
    html += '</div>';
  }

  // ── Key levels ────────────────────────────────────────────────────────────
  if (d.supports && d.supports.length > 0) {
    html += '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Key Levels</div>' +
      '<div style="display:flex;gap:24px;margin-bottom:8px">' +
        '<div><div style="font-size:9px;color:#22c55e;letter-spacing:1px;margin-bottom:6px">SUPPORT</div>' +
          d.supports.map(function(p) { return '<div style="font-size:16px;font-weight:700;color:#22c55e;font-family:var(--mono)">$' + p + '</div>'; }).join('') +
        '</div>' +
        (d.resistances && d.resistances.length
          ? '<div><div style="font-size:9px;color:#ef4444;letter-spacing:1px;margin-bottom:6px">RESISTANCE</div>' +
              d.resistances.map(function(p) { return '<div style="font-size:16px;font-weight:700;color:#ef4444;font-family:var(--mono)">$' + p + '</div>'; }).join('') +
            '</div>'
          : '') +
      '</div>' +
      (d.exitSignal
        ? '<div style="padding:8px 11px;background:rgba(239,68,68,.06);border-radius:7px;font-size:10px;color:#fca5a5;border:1px solid rgba(239,68,68,.15)">&#9889; Exit signal -- Close if ' + d.ticker + ' breaks $' + d.exitSignal + '</div>'
        : '') +
      (d.sma20 ? '<div style="font-size:10px;color:var(--text3);margin-top:8px">SMA20: $' + d.sma20 + ' &bull; SMA50: $' + d.sma50 + '</div>' : '') +
    '</div>';
  }

  // ── Log trade button ──────────────────────────────────────────────────────
  html += '<div style="padding:0 12px"><button class="btn btn-success btn-w" onclick="logFromAnalysis()">&check; I TOOK THIS TRADE -- LOG IT</button></div>';

  $('az-result').innerHTML = html;
}
