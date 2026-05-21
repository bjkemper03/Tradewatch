// =============================================================================
// js/analyze/analyzeForm.js -- Analyze form rendering and state helpers
// =============================================================================

function renderAnalyzeForm() {
  var el = $('page-analyze');
  var remembered = lastAnalysisResult || null;
  azStrat = (remembered && (remembered.selectedStrategy || remembered.strategy)) || 'PUT CREDIT SPREAD';
  azLegData = remembered && remembered.legs && remembered.legs.length
    ? remembered.legs.map(function(l) { return Object.assign({}, l); })
    : DEF['PUT CREDIT SPREAD'].map(function(l) { return Object.assign({}, l); });

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
    '<div id="az-strategy-context"></div>' +
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
  renderAnalyzeStrategyContext();
  if ($('az-strat')) $('az-strat').value = azStrat;
  if (remembered) {
    if ($('az-tk')) $('az-tk').value = remembered.ticker || '';
    if ($('az-exp')) $('az-exp').value = remembered.expDate || remembered.exp || '';
    if ($('az-cr')) $('az-cr').value = remembered.entryPremium != null ? remembered.entryPremium : remembered.credit || '';
    if ($('az-entry')) $('az-entry').value = remembered.entryType || (isDebitStrat(azStrat) ? 'debit' : 'credit');
    if ($('az-ctx')) $('az-ctx').value = remembered.notes || '';
    if ($('az-cc-own-shares')) $('az-cc-own-shares').checked = remembered.ownsShares === true;
    if ($('az-cc-wants-assignment')) $('az-cc-wants-assignment').checked = remembered.wantsAssignment === true;
    if ($('az-cc-share-basis')) $('az-cc-share-basis').value = remembered.shareBasisProvided && remembered.shareBasis ? remembered.shareBasis : '';
    azUpdateCol();
    renderAnalysisResult(remembered);
  }
}

// ---------------------------------------------------------------------------
// Analyze form helpers
// ---------------------------------------------------------------------------
function azChangeStrat(s) {
  azStrat   = s;
  azLegData = (DEF[s] || [{ a:'BUY', t:'PUT', n:1, s:'' }]).map(function(l) { return Object.assign({}, l); });
  buildAzLegs();
  renderAnalyzeStrategyContext();
  var entry = $('az-entry');
  if (entry) entry.value = isDebitStrat(s) ? 'debit' : 'credit';
  azUpdateCol();
}

function renderAnalyzeStrategyContext() {
  var el = $('az-strategy-context');
  if (!el) return;
  if (azStrat !== 'COVERED CALL') {
    el.innerHTML = '';
    return;
  }
  el.innerHTML =
    '<div class="strategy-context-box">' +
      '<div class="analysis-panel-label">Covered Call Context</div>' +
      '<label class="strategy-context-check">' +
        '<input id="az-cc-own-shares" type="checkbox">' +
        '<span>I own the shares</span>' +
      '</label>' +
      '<label class="strategy-context-check">' +
        '<input id="az-cc-wants-assignment" type="checkbox">' +
        '<span>I want assignment</span>' +
      '</label>' +
      '<div class="strategy-context-field">' +
        '<label>Avg share price</label>' +
        '<input id="az-cc-share-basis" type="number" step="0.01" placeholder="Optional">' +
      '</div>' +
    '</div>';
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
