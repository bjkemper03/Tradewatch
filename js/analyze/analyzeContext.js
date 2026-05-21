// =============================================================================
// js/analyze/analyzeContext.js -- Trade context and issue displays
// =============================================================================

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

  function realisticTargetTable() {
    if (!((sg === 'long_call' || sg === 'long_put') && d.profitTargets && d.profitTargets.length)) return '';
    return '<div class="context-card" style="grid-column:span 2">' +
      '<div class="analysis-panel-label" style="color:var(--yellow);margin-bottom:10px">Realistic Targets</div>' +
      '<div style="display:grid;grid-template-columns:minmax(110px,1.1fr) minmax(76px,.8fr) minmax(72px,.7fr) minmax(62px,.6fr) minmax(62px,.6fr);gap:8px;align-items:center">' +
        '<div class="analysis-panel-label">Target</div>' +
        '<div class="analysis-panel-label">Stock</div>' +
        '<div class="analysis-panel-label">Profit</div>' +
        '<div class="analysis-panel-label">Touch</div>' +
        '<div class="analysis-panel-label">Exp</div>' +
        d.profitTargets.map(function(t) {
          var profitDollars = safeNum(t.profitDollars != null ? t.profitDollars : t.profit * 100);
          return '<div style="font-size:12px;color:var(--text);font-weight:700">' + (t.label || ('+$' + profitDollars.toFixed(0))) + '</div>' +
            '<div style="font-family:var(--mono);font-size:12px;color:var(--text2)">$' + t.targetPrice + '</div>' +
            '<div style="font-family:var(--mono);font-size:12px;color:' + (profitDollars > 0 ? 'var(--green)' : 'var(--text2)') + '">' + (profitDollars > 0 ? '+$' : '$') + profitDollars.toFixed(0) + '</div>' +
            '<div style="font-family:var(--mono);font-size:12px;color:var(--green)">' + fmtProbPct(t.probTouch) + '</div>' +
            '<div style="font-family:var(--mono);font-size:12px;color:var(--green)">' + fmtProbPct(t.prob) + '</div>';
        }).join('') +
      '</div>' +
      (d.framingNote ? '<div class="analysis-panel-detail" style="margin-top:10px">' + d.framingNote + '</div>' : '') +
    '</div>';
  }

  var primary = [];
  var width = spreadWidthFromLegs();
  function touchCard() {
    var rows = [];
    if (d.probTouchShort != null) {
      rows.push(['Short strike', Math.round(d.probTouchShort * 100) + '%']);
    }
    if (d.probTouchPutShort != null || d.probTouchCallShort != null) {
      if (d.probTouchPutShort != null) rows.push(['Put short', Math.round(d.probTouchPutShort * 100) + '%']);
      if (d.probTouchCallShort != null) rows.push(['Call short', Math.round(d.probTouchCallShort * 100) + '%']);
    }
    if (d.probTouchBreakeven != null) {
      rows.push(['Breakeven', Math.round(d.probTouchBreakeven * 100) + '%']);
    }
    if (d.probTouchLong != null) {
      rows.push(['Long strike', Math.round(d.probTouchLong * 100) + '%']);
    }
    if (!(sg === 'long_call' || sg === 'long_put') && d.profitTargets && d.profitTargets.length) {
      d.profitTargets.slice(0, 3).forEach(function(t) {
        if (t.probTouch != null && !rows.some(function(r) { return r[0] === t.label; })) {
          rows.push([t.label || '$' + t.targetPrice, Math.round(t.probTouch * 100) + '%']);
        }
      });
    }
    if (!rows.length) return '';
    return '<div class="context-card">' +
      '<div class="analysis-panel-label">Touch probabilities</div>' +
      '<div style="display:grid;gap:6px;margin-top:8px">' +
        rows.slice(0, 4).map(function(r) {
          return '<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text2)">' +
            '<span>' + r[0] + '</span>' +
            '<strong style="font-family:var(--mono);color:var(--yellow)">' + r[1] + '</strong>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="analysis-panel-detail">Before expiration</div>' +
    '</div>';
  }
  if (sg === 'credit_spread') {
    var creditWidthSub = width != null && d.maxProfit != null
      ? fmtMoney(d.maxProfit) + ' credit on ' + fmtMoneyCents(width) + ' width'
      : 'Credit quality check';
    if (d.crWidthPct != null) primary.push(mini('% of width', d.crWidthPct + '%', d.crWidthPct >= prefs.creditWidthMin ? 'var(--green)' : 'var(--yellow)', creditWidthSub));
    var tc1 = touchCard(); if (tc1) primary.push(tc1);
    if (d.riskReward != null) primary.push(mini('Risk / reward', d.riskReward + ':1', d.riskReward <= 4 ? 'var(--green)' : 'var(--yellow)', 'Risk per $1 reward'));
    if (d.exitSignal) primary.push(mini('Exit trigger', '$' + d.exitSignal, 'var(--yellow)', 'Suggested risk line'));
  } else if (sg === 'put_debit_spread' || sg === 'call_debit_spread') {
    if (width != null) primary.push(mini('Spread width', fmtMoneyCents(width), 'var(--text)', 'Max value at expiration'));
    var tc2 = touchCard(); if (tc2) primary.push(tc2);
    if (d.movePct != null) primary.push(mini('Move needed', d.movePct + '%', d.movePct < 5 ? 'var(--green)' : d.movePct < 10 ? 'var(--yellow)' : 'var(--red)', 'To breakeven'));
    if (d.riskReward != null) primary.push(mini('Risk / reward', d.riskReward + ':1', d.riskReward < 1 ? 'var(--green)' : 'var(--yellow)', 'Debit paid vs reward'));
  } else if (sg === 'bwb' || sg === 'butterfly' || sg === 'ratio_spread') {
    if (d.openingCredit != null) primary.push(mini('Opening credit', fmtMoney(d.openingCredit), 'var(--green)', 'Collected at entry'));
    if (d.openingDebit != null) primary.push(mini('Opening debit', fmtMoney(d.openingDebit), 'var(--red)', 'Paid at entry'));
    var tc3 = touchCard(); if (tc3) primary.push(tc3);
    if (d.creditCapturePct != null) primary.push(mini('Credit / max profit', d.creditCapturePct + '%', d.creditCapturePct >= 60 ? 'var(--green)' : 'var(--yellow)', 'Opening credit vs modeled max profit'));
    if (d.wingRatioLabel) primary.push(mini('Wing ratio', d.wingRatioLabel, 'var(--text)', 'Structure balance'));
  } else if (sg === 'long_call' || sg === 'long_put') {
    var rt = realisticTargetTable(); if (rt) primary.push(rt);
  } else if (sg === 'iron_condor' || sg === 'iron_butterfly') {
    if (width != null) primary.push(mini('Wing width', fmtMoneyCents(width), 'var(--text)', 'Outer defined risk'));
    var tc5 = touchCard(); if (tc5) primary.push(tc5);
  } else {
    var tc6 = touchCard(); if (tc6) primary.push(tc6);
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
        var profitDollars = safeNum(t.profitDollars != null ? t.profitDollars : t.profit * 100);
        return '<div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">' +
          '<div><strong style="font-size:12px;color:var(--text)">' + (t.label || ('+$' + profitDollars.toFixed(0))) + '</strong><span style="font-size:10px;color:var(--text3);margin-left:8px">$' + t.targetPrice + '</span></div>' +
          '<div style="font-family:var(--mono);font-size:12px;color:' + (profitDollars > 0 ? 'var(--green)' : 'var(--text2)') + '">' + (profitDollars > 0 ? '+$' : '$') + profitDollars.toFixed(0) + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    (d.framingNote ? '<div style="font-size:10px;color:var(--text3);margin-top:10px;line-height:1.5">' + d.framingNote + '</div>' : '') +
  '</div>';
  }
