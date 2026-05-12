// =============================================================================
// js/pages/prefs.js -- Settings / Preferences page
// Depends on: prefs, currentUser, savePrefs(), toast() from index.html
// =============================================================================

function renderPrefs() {
  var el = $('page-prefs');
  if (!el) return;
  var startSize = prefs.startingAccountSize || prefs.accountSize || 10000;

  el.innerHTML =
    '<div class="fadeup">' +

    // Strategy Style
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Strategy Style</div>' +
      '<div class="pref-row">' +
        '<span style="font-size:12px;color:var(--text2)">Primary style</span>' +
        '<select id="p-strat" style="width:120px;font-size:12px" onchange="prefs.primaryStrategy=this.value;savePrefs()">' +
          ['credit','debit','mixed'].map(function(v) {
            return '<option value="' + v + '"' + (prefs.primaryStrategy === v ? ' selected' : '') + '>' + v.toUpperCase() + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="pref-row">' +
        '<span style="font-size:12px;color:var(--text2)">DTE range</span>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<input type="number" value="' + prefs.dteLow + '" style="width:60px;font-family:var(--mono)" onblur="prefs.dteLow=parseInt(this.value)||14;savePrefs()">' +
          '<span style="color:var(--text3);font-size:12px">to</span>' +
          '<input type="number" value="' + prefs.dteHigh + '" style="width:60px;font-family:var(--mono)" onblur="prefs.dteHigh=parseInt(this.value)||21;savePrefs()">' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Delta & Cushion
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Delta &amp; Cushion</div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Delta target low</span>' +
        '<input type="number" value="' + prefs.deltaLow + '" step="0.01" style="width:80px;font-family:var(--mono)" onblur="prefs.deltaLow=parseFloat(this.value)||0.18;savePrefs()"></div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Delta target high</span>' +
        '<input type="number" value="' + prefs.deltaHigh + '" step="0.01" style="width:80px;font-family:var(--mono)" onblur="prefs.deltaHigh=parseFloat(this.value)||0.28;savePrefs()"></div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Min cushion %</span>' +
        '<input type="number" value="' + prefs.cushionMin + '" style="width:80px;font-family:var(--mono)" onblur="prefs.cushionMin=parseFloat(this.value)||5;savePrefs()"></div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Min credit/width %</span>' +
        '<input type="number" value="' + prefs.creditWidthMin + '" style="width:80px;font-family:var(--mono)" onblur="prefs.creditWidthMin=parseFloat(this.value)||8;savePrefs()"></div>' +
    '</div>' +

    // Market Note
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Market Note</div>' +
      '<textarea id="p-note" placeholder="Major world events, trade war..." style="min-height:70px;font-size:12px" onblur="prefs.marketNote=this.value;savePrefs()">' + (prefs.marketNote || '') + '</textarea>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:4px">Shows highlighted on Overview tab.</div>' +
    '</div>' +

    // Account
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Account</div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Display name</span>' +
        '<input type="text" value="' + (prefs.displayName || '') + '" style="width:130px;font-size:12px" onblur="prefs.displayName=this.value;savePrefs()"></div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Starting account $</span>' +
        '<input type="number" value="' + startSize + '" style="width:110px;font-family:var(--mono)" onblur="prefs.startingAccountSize=parseInt(this.value)||10000;prefs.accountSize=prefs.accountSize||prefs.startingAccountSize;savePrefs()"></div>' +
      '<div class="pref-row"><span style="font-size:12px;color:var(--text2)">Sizing account $</span>' +
        '<input type="number" value="' + (prefs.accountSize || startSize) + '" style="width:110px;font-family:var(--mono)" onblur="prefs.accountSize=parseInt(this.value)||prefs.startingAccountSize||10000;savePrefs()"></div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:6px;line-height:1.5">Starting account anchors the P/L chart. Sizing account can change for future trade collateral without rewriting past returns.</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:6px">Signed in as: ' + (currentUser && currentUser.email ? currentUser.email : 'unknown') + '</div>' +
    '</div>' +

    // Save button
    '<div style="padding:0 12px 12px">' +
      '<button class="btn btn-primary btn-w" onclick="savePrefs();toast(\'Preferences saved!\')">Save Preferences</button>' +
    '</div>' +

    '</div>';
}
