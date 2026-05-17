// =============================================================================
// js/analyze/analyzeResult.js -- Analyze result rendering and metrics
// =============================================================================

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

function fmtProbPct(v) {
  if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
  var p = safeNum(v) * 100;
  return p < 1 && p > 0 ? '<1%' : Math.round(p) + '%';
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

function analysisLegs(d) {
  return (d && d.legs && d.legs.length) ? d.legs : ((azLegData && azLegData.length) ? azLegData : []);
}

function findLeg(d, action, type) {
  return analysisLegs(d).find(function(l) { return l.a === action && l.t === type; }) || null;
}

function isDebitAnalysis(d) {
  var sg = d.strategyGroup || '';
  return d.entryType === 'debit' || sg === 'long_call' || sg === 'long_put' ||
    sg === 'call_debit_spread' || sg === 'put_debit_spread';
}

function cushionSubtext(d) {
  if (!d.price) return 'Distance from key risk level';
  var sg = d.strategyGroup || '';
  var sellPut = findLeg(d, 'SELL', 'PUT');
  var sellCall = findLeg(d, 'SELL', 'CALL');
  var ref = null;
  var detail = 'distance from key risk level';

  if (sg === 'credit_spread' && sellPut) {
    ref = sellPut.s;
    detail = 'to short put; above this can expire worthless';
  } else if (sg === 'credit_spread' && sellCall) {
    ref = sellCall.s;
    detail = 'to short call; below this can expire worthless';
  } else if (sg === 'csp' && sellPut) {
    ref = sellPut.s;
    detail = 'to short put assignment line';
  } else if (sg === 'covered_call' && sellCall) {
    ref = sellCall.s;
    detail = 'to short call assignment line';
  } else if (d.breakeven != null) {
    ref = d.breakeven;
    detail = 'to breakeven';
  }

  return ref != null
    ? 'Current $' + safeNum(d.price).toFixed(2) + ' &rarr; $' + safeNum(ref).toFixed(2) + ' ' + detail
    : 'Current $' + safeNum(d.price).toFixed(2) + ' &bull; distance from key risk level';
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

function renderHeaderChips(d) {
  var s = d.summary || {};
  var dte = s.dte || { label: d.dte != null ? d.dte + ' DTE' : 'Unknown', tone: 'neutral', detail: '' };
  var earn = s.earnings || { label: d.earningsRisk ? 'Earnings risk' : 'No earnings risk', tone: d.earningsRisk ? 'bad' : 'good', detail: d.earningsDate || 'Unknown' };
  var liq = s.liquidity || { label: 'Unknown', grade: 'Unknown', detail: 'Check bid/ask before entry' };
  var liqTone = liq.grade === 'Good' ? 'good' : liq.grade === 'Okay' ? 'warn' : liq.grade === 'Thin' || liq.grade === 'Poor' ? 'bad' : 'neutral';

  function chip(label, value, detail, tone) {
    return '<div class="analysis-chip">' +
      '<div class="analysis-chip-label">' + label + '</div>' +
      '<div class="analysis-chip-value" style="color:' + toneColor(tone) + '">' + value + '</div>' +
      (detail ? '<div class="analysis-chip-detail">' + detail + '</div>' : '') +
    '</div>';
  }

  var liqDetail = liq.avgBidAsk != null ? 'Bid/ask $' + liq.avgBidAsk : (liq.detail || '');
  return '<div class="analysis-chip-row">' +
    chip('DTE', dte.label, dte.detail, dte.tone) +
    chip('Earnings', earn.label, earn.detail, earn.tone) +
    chip('Liquidity', liq.label || liq.grade || 'Unknown', liqDetail, liqTone) +
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
  var thetaKnown = theta != null;
  if (thetaKnown) theta = isDebitAnalysis(d) ? -Math.abs(theta) : Math.abs(theta);
  var thetaGood = thetaKnown && !isDebitAnalysis(d);

  function cell(label, value, color, sub) {
    return '<div class="universal-metric">' +
      '<div class="universal-label">' + label + '</div>' +
      '<div class="universal-value" style="color:' + (color || 'var(--text)') + '">' + value + '</div>' +
      '<div class="universal-sub">' + (sub || '&nbsp;') + '</div>' +
    '</div>';
  }

  return '<div class="universal-metrics">' +
    cell('Cushion', cushion != null ? cushion + '%' : 'N/A', cushion != null ? cushC(cushion) : 'var(--text)', cushionSubtext(d)) +
    cell('Max Profit', maxProfitText, 'var(--green)', d.entryType === 'debit' ? 'Maximum gain' : 'Credit / income potential') +
    cell('Max Loss / Risk', maxLossText, 'var(--red)', (u.maxLossUnlimited || d.maxLossUnlimited) ? 'Undefined risk' : 'Defined risk') +
    cell('Breakeven', fmtBe(be), 'var(--text)', 'At expiration') +
    cell('Prob. Worthless', prob != null ? prob + '%' : 'N/A', probAgainst ? 'var(--red)' : 'var(--green)', probAgainst ? 'Works against long options' : 'Works in your favor') +
    cell('Est. Daily Theta', thetaKnown ? formatSignedMoney(theta) : 'N/A', thetaKnown ? (thetaGood ? 'var(--green)' : 'var(--red)') : 'var(--text)', thetaKnown ? (thetaGood ? 'Time decay in your favor' : 'Time decay against you') : 'Estimate unavailable') +
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
      renderHeaderChips(d) +
    '</div>' +
    (d.structureWarning ? '<div class="structure-warning">' + esc(d.structureWarning) + '</div>' : '') +
    renderGreekBox(d) +
    renderUniversalMetrics(d) +
    renderTradeContext(d) +
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
