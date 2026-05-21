// =============================================================================
// js/analyze/analyzeResult.js -- Analyze result rendering and metrics
// =============================================================================

function renderGreekBox(d) {
  var g = d.positionGreeks || (d.summary && d.summary.greeks) || d.greeks || {};
  var items = [
    ['Delta', g.delta != null ? g.delta : d.absDelta],
    ['Gamma', g.gamma],
    ['Theta', g.theta],
    ['Vega',  g.vega],
    ['Rho',   g.rho]
  ];
  function fmtGreek(v, showSign) {
    if (v == null || !Number.isFinite(safeNum(v))) return 'N/A';
    var n = safeNum(v);
    return (showSign && n > 0 ? '+' : '') + n.toFixed(3);
  }
  function legDeltaDetail() {
    var k = d.keyLegGreeks || {};
    var rows = [];
    function add(key, label, signed) {
      if (!k[key] || k[key].delta == null) return;
      var delta = safeNum(k[key].delta);
      var text = signed
        ? (delta > 0 ? '+' : '') + delta.toFixed(2)
        : Math.abs(delta).toFixed(2);
      rows.push(label + ' ' + text);
    }
    var sg = d.strategyGroup || '';
    if (k.shares) {
      add('shares', 'Shares', true);
      add('shortCall', 'Short call');
    } else if (sg === 'credit_spread' && k.shortPut) {
      add('shortPut', 'Short put');
      add('longPut', 'Long put');
    } else if (sg === 'credit_spread' && k.shortCall) {
      add('shortCall', 'Short call');
      add('longCall', 'Long call');
    } else if (sg === 'put_debit_spread') {
      add('longPut', 'Long put');
      add('shortPut', 'Short put');
    } else if (sg === 'call_debit_spread') {
      add('longCall', 'Long call');
      add('shortCall', 'Short call');
    } else if (sg === 'iron_condor' || sg === 'iron_butterfly') {
      add('shortPut', 'Short put');
      add('shortCall', 'Short call');
    } else {
      add('shortPut', 'Short put');
      add('longPut', 'Long put');
      add('shortCall', 'Short call');
      add('longCall', 'Long call');
    }
    add('body', 'Body');
    return rows.length ? rows.join(' / ') : '';
  }
  var deltaDetail = legDeltaDetail();
  return '<div class="greeks-strip">' + items.map(function(item) {
    var val = item[1];
    var isDelta = item[0] === 'Delta';
    return '<div class="greek-cell">' +
      '<div class="greek-label">' + item[0] + '</div>' +
      '<div class="greek-value">' + fmtGreek(val, true) + '</div>' +
      (isDelta && deltaDetail ? '<div style="font-size:10px;color:var(--text3);margin-top:4px;line-height:1.35">' + deltaDetail + '</div>' : '') +
    '</div>';
  }).join('') + '</div>';
}

function toneColor(tone) {
  if (tone === 'good') return 'var(--green)';
  if (tone === 'bad') return 'var(--red)';
  if (tone === 'warn') return 'var(--yellow)';
  return 'var(--text)';
}

function issueColor(issue) {
  if (!issue) return 'var(--green)';
  if (issue.level === 'red' || issue.level === 'critical') return 'var(--red)';
  if (issue.level === 'info' || issue.level === 'note') return 'var(--text2)';
  return 'var(--yellow)';
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

  if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    return 'Profit zone depends on breakevens and body/ratio geometry';
  }

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
  var earn = s.earnings || { label: d.earningsRisk ? 'Earnings risk' : (d.earningsDate ? 'No earnings risk' : 'Earnings unknown'), tone: d.earningsRisk ? 'bad' : (d.earningsDate ? 'good' : 'neutral'), detail: d.earningsDate || 'Date unavailable' };
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
  var earn = s.earnings || { label: d.earningsRisk ? 'Earnings risk' : (d.earningsDate ? 'No earnings risk' : 'Earnings unknown'), tone: d.earningsRisk ? 'bad' : (d.earningsDate ? 'good' : 'neutral'), detail: d.earningsDate || 'Date unavailable' };
  var liq = s.liquidity || { label: 'Unknown', grade: 'Unknown', detail: 'Check bid/ask before entry' };
  var liqTone = liq.grade === 'Good' ? 'good' : liq.grade === 'Okay' ? 'warn' : liq.grade === 'Thin' || liq.grade === 'Poor' ? 'bad' : 'neutral';
  var scoreKnown = d.score != null && Number.isFinite(safeNum(d.score));
  var scoreTone = !scoreKnown ? 'neutral' : safeNum(d.score) >= 75 ? 'good' : safeNum(d.score) >= 50 ? 'warn' : 'bad';

  function chip(label, value, detail, tone) {
    return '<div class="analysis-chip">' +
      '<div class="analysis-chip-label">' + label + '</div>' +
      '<div class="analysis-chip-value" style="color:' + toneColor(tone) + '">' + value + '</div>' +
      (detail ? '<div class="analysis-chip-detail">' + detail + '</div>' : '') +
    '</div>';
  }

  var liqDetail = liq.avgBidAsk != null ? 'Bid/ask $' + liq.avgBidAsk : (liq.detail || '');
  return '<div class="analysis-chip-row">' +
    chip('Score', scoreKnown ? String(safeNum(d.score)) : 'N/A', d.signal === 'INCOMPLETE' ? 'Incomplete' : '100 minus deductions', scoreTone) +
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
  var thetaGood = thetaKnown && theta >= 0;

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
  var greekNote = {
    level: 'model',
    msg: 'Greeks shown are estimated net position Greeks for the full trade when possible. Delta detail lists key leg deltas used for trade selection and risk context.'
  };
  return '<details class="card" style="padding:10px 12px">' +
    '<summary style="cursor:pointer;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Model assumptions</summary>' +
    '<div style="display:grid;gap:6px;margin-top:9px">' +
    [greekNote].concat(notes).slice(0, 6).map(function(n) {
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
  var sc       = sig === 'GO' ? '#22c55e' : sig === 'NO-GO' ? '#ef4444' : sig === 'INCOMPLETE' ? '#94a3b8' : '#f59e0b';
  var sigLabel = sig === 'GO' ? 'GO' : sig === 'NO-GO' ? 'NO-GO' : sig === 'INCOMPLETE' ? 'INCOMPLETE' : 'CAUTION';
  var issues   = d.issues || [];
  var reasons  = issues.length ? issues.map(function(i) { return i.msg; }) : ['All checks passed -- structure looks solid'];
  var band = d.scoreBand && d.scoreBand.label
    ? '<div style="font-size:10px;color:var(--text3);margin-top:6px">' + esc(d.scoreBand.label) +
      (d.scoreBand.flaggedMetrics && d.scoreBand.flaggedMetrics.length ? ': ' + esc(d.scoreBand.flaggedMetrics.join(', ')) : '') +
      '</div>'
    : '';

  var heroTone = sig === 'GO' ? 'good' : sig === 'NO-GO' ? 'bad' : 'warn';
  var cleanHtml = '<div class="analysis-shell">' +
    '<div class="analysis-hero ' + heroTone + '">' +
      '<div class="signal-dot" style="background:' + sc + '">' + sigLabel + '</div>' +
      '<div>' +
        '<div class="analysis-title">' + d.ticker + ' &mdash; ' + d.strategy + '</div>' +
        '<div class="analysis-sub">' +
          reasons.map(function(r) {
            var ic = issues.find(function(i) { return i.msg === r; });
            var col = issueColor(ic);
            return '<span style="color:' + col + '">' + r + '</span>';
          }).join('<br>') +
        '</div>' +
        band +
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
}
