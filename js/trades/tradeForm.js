// =============================================================================
// js/trades/tradeForm.js -- Manual trade log form
// =============================================================================

function tradeFormHtml() {
  return '<div id="tfm" style="display:none"><div class="card" style="margin-bottom:10px">' +
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Strategy</div>' +
    buildStratPills(formStrat) +
    '<div class="fg2" style="margin-top:10px">' +
      '<div class="fld"><label>Ticker</label><input id="tf-tk" placeholder="NVDA" oninput="this.value=this.value.toUpperCase()" style="font-family:var(--mono);font-size:14px;font-weight:600"></div>' +
      '<div class="fld"><label>Stock Price at Open</label><input id="tf-px" placeholder="118.50" type="number" step="0.01" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fld"><label>Option Legs</label></div>' +
    '<div id="lc"></div>' +
    '<button onclick="addLeg()" style="padding:5px 11px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:10px;cursor:pointer;margin-bottom:10px">+ Add Leg</button>' +
    '<div class="fg2">' +
      '<div class="fld"><label>Expiration (5/10/26)</label><input id="tf-exp" placeholder="5/23/26" style="font-family:var(--mono)" oninput="tradeAutoCol()"></div>' +
      '<div class="fld"><label>DTE at Open</label><input id="tf-dte" placeholder="18" type="number" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fg3">' +
      '<div class="fld"><label>Entry/share $</label><input id="tf-cr" placeholder="0.45" type="number" step="0.01" oninput="tradeAutoCol()" style="font-family:var(--mono)"></div>' +
      '<div class="fld"><label>Collateral $ (auto)</label><input id="tf-col" placeholder="Auto" type="number" step="1" style="font-family:var(--mono)"></div>' +
      '<div class="fld"><label>Exit Trigger $</label><input id="tf-exit" placeholder="108" type="number" step="0.01" style="font-family:var(--mono)"></div>' +
    '</div>' +
    '<div class="fld"><label>Journal Tags</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' +
        TRADE_TAGS.map(function(tag, i) {
          return '<button class="tag" id="ttag-' + i + '" onclick="toggleTag(' + i + ',\'' + tag + '\')" data-tag="' + tag + '">' + tag + '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="fld"><label>Notes</label><input id="tf-notes" placeholder="Delta, context..."></div>' +
    '<button class="btn btn-primary btn-w" onclick="submitTrade()">&rarr; Log Trade</button>' +
  '</div></div>';
}
function buildStratPills(active) {
  return Object.keys(STRAT_GROUPS).map(function(grp) {
    var strats = STRAT_GROUPS[grp];
    return '<div style="font-size:8px;color:var(--text3);letter-spacing:1px;margin:8px 0 4px">' + grp + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
        strats.map(function(s) {
          return '<button class="sp ' + (s === active ? 'active' : '') + '" onclick="selectStrat(\'' + s + '\')">' + s + '</button>';
        }).join('') +
      '</div>';
  }).join('');
}

function selectStrat(s) {
  formStrat   = s;
  formLegData = (DEF[s] || [{ a:'BUY', t:'PUT', n:1, s:'' }]).map(function(l) { return Object.assign({}, l); });
  document.querySelectorAll('.sp').forEach(function(p) { p.classList.toggle('active', p.textContent === s); });
  buildLegs();
  tradeAutoCol();
}

// ---------------------------------------------------------------------------
// Leg builder
// ---------------------------------------------------------------------------
function buildLegs() {
  var c = $('lc');
  if (!c) return;
  c.innerHTML = formLegData.map(function(leg, i) {
    return '<div class="leg-row ' + (leg.a === 'SELL' ? 'sell' : 'buy-l') + '">' +
      '<select class="leg-action" style="color:' + (leg.a === 'SELL' ? '#ef4444' : '#22c55e') + '" onchange="formLegData[' + i + '].a=this.value;buildLegs();tradeAutoCol()">' +
        '<option ' + (leg.a === 'SELL' ? 'selected' : '') + '>SELL</option>' +
        '<option ' + (leg.a === 'BUY'  ? 'selected' : '') + '>BUY</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.n || 1) + '" min="1" max="20" class="leg-ct" onblur="formLegData[' + i + '].n=parseInt(this.value)||1;tradeAutoCol()">' +
      '<span style="color:var(--text3);font-size:10px">&times;</span>' +
      '<select class="leg-type" onchange="formLegData[' + i + '].t=this.value">' +
        '<option ' + (leg.t === 'PUT'  ? 'selected' : '') + '>PUT</option>' +
        '<option ' + (leg.t === 'CALL' ? 'selected' : '') + '>CALL</option>' +
      '</select>' +
      '<input type="number" value="' + (leg.s || '') + '" placeholder="Strike $" class="strike-input" style="flex:1" ' +
        'oninput="formLegData[' + i + '].s=this.value" onblur="formLegData[' + i + '].s=this.value;tradeAutoCol()">' +
      (formLegData.length > 1
        ? '<button class="leg-x" onclick="formLegData.splice(' + i + ',1);buildLegs();tradeAutoCol()">&times;</button>'
        : '') +
    '</div>';
  }).join('');
}

function tradeAutoCol() {
  var cr  = safeNum($('tf-cr') ? $('tf-cr').value : 0);
  var col = calcCollateral(formStrat, formLegData, cr, isDebitStrat(formStrat) ? 'debit' : 'credit');
  var el  = $('tf-col');
  if (el) el.value = col > 0 ? col.toFixed(0) : '';
}

function calcTradeBreakeven(strategy, legs, credit) {
  var sellLeg = legs.find(function(l) { return l.a === 'SELL'; });
  var buyLeg = legs.find(function(l) { return l.a === 'BUY'; });
  var cr = safeNum(credit);
  if (strategy === 'LONG PUT' && buyLeg) return safeNum(buyLeg.s) - cr;
  if (strategy === 'LONG CALL' && buyLeg) return safeNum(buyLeg.s) + cr;
  if (strategy === 'PUT DEBIT SPREAD' && buyLeg) return safeNum(buyLeg.s) - cr;
  if (strategy === 'CALL DEBIT SPREAD' && buyLeg) return safeNum(buyLeg.s) + cr;
  if (strategy === 'CALL CREDIT SPREAD' && sellLeg) return safeNum(sellLeg.s) + cr;
  if (strategy === 'COVERED CALL') return null;
  if (sellLeg) return safeNum(sellLeg.s) - cr;
  return null;
}


function addLeg() {
  formLegData.push({ a:'BUY', t:'PUT', n:1, s:'' });
  buildLegs();
}

// ---------------------------------------------------------------------------
// Form toggle
// ---------------------------------------------------------------------------
function toggleTradeForm() {
  var f    = $('tfm');
  var show = f.style.display === 'none';
  f.style.display = show ? 'block' : 'none';
  if (show) { selectedTags = []; pendingAnalysisForLog = null; buildLegs(); }
}

// ---------------------------------------------------------------------------
// Tag toggle
// ---------------------------------------------------------------------------
function toggleTag(i, tag) {
  var idx = selectedTags.indexOf(tag);
  if (idx > -1) selectedTags.splice(idx, 1);
  else selectedTags.push(tag);
  var btn = $('ttag-' + i);
  if (btn) btn.classList.toggle('on', selectedTags.includes(tag));
}

// ---------------------------------------------------------------------------
// Submit new trade
