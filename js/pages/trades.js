// =============================================================================
// js/pages/trades.js -- Trades page coordinator
// =============================================================================

function renderTrades() {
  var el = $('page-trades');
  if (!el) return;

  var today = new Date();
  var open = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closed = trades.filter(function(t) { return t.status === 'CLOSED'; });

  open.forEach(function(t) {
    var d = parseExp(t.expDate);
    if (d) t.currentDTE = Math.max(0, Math.ceil((d - today) / 86400000));
  });
  hydrateLivePrices();

  var hasLive = openLiveQuotes(open).length > 0;
  var liveAge = liveQuoteAgeText(open);

  var html = '<div class="fadeup">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 16px;margin-bottom:10px">' +
      '<div style="font-size:13px;font-weight:600">' + open.length + ' Open Position' + (open.length !== 1 ? 's' : '') + '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="toggleTradeForm()">+ Log Trade</button>' +
    '</div>';

  html += tradeFormHtml();
  html += livePricePromptHtml(open, hasLive, liveAge);

  if (open.length === 0) {
    html += '<div style="text-align:center;color:var(--text3);padding:40px 0;font-size:12px">No open trades &mdash; tap Log Trade to add one</div>';
  }

  open.forEach(function(t) { html += renderOpenTradeCard(t); });
  html += closedTradesHtml(closed);
  html += '</div>';
  el.innerHTML = html;

  if (!formLegData || !formLegData.length) {
    formLegData = DEF[formStrat] ? DEF[formStrat].map(function(l) { return Object.assign({}, l); }) : [{ a:'BUY', t:'PUT', n:1, s:'' }];
  }
  buildLegs();
}