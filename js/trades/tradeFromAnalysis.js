// =============================================================================
// js/trades/tradeFromAnalysis.js -- Log trades from Analyze results
// =============================================================================
function logFromAnalysis() {
  if (!azResult) return;
  pendingAnalysisForLog = azResult.analysis ? JSON.parse(JSON.stringify(azResult.analysis)) : null;
  formStrat   = azResult.strategy || 'PUT CREDIT SPREAD';
  formLegData = azResult.legs || DEF[formStrat].map(function(l) { return Object.assign({}, l); });
  showPage('trades');
  setTimeout(function() {
    formStrat   = azResult.strategy || 'PUT CREDIT SPREAD';
    formLegData = (azResult.legs || DEF[formStrat] || []).map(function(l) { return Object.assign({}, l); });
    var f = $('tfm');
    if (f && f.style.display === 'none') f.style.display = 'block';
    setTimeout(function() {
      if ($('tf-tk'))    $('tf-tk').value    = azResult.ticker || '';
      if ($('tf-px'))    $('tf-px').value    = azResult.price    != null ? azResult.price.toFixed(2)    : '';
      if ($('tf-exp'))   $('tf-exp').value   = azResult.exp      || '';
      if ($('tf-dte'))   $('tf-dte').value   = azResult.dte      != null ? azResult.dte.toString()      : '';
      if ($('tf-cr'))    $('tf-cr').value    = azResult.credit   != null ? azResult.credit.toString()   : '';
      if ($('tf-col'))   $('tf-col').value   = azResult.collateral != null ? azResult.collateral.toFixed(0) : '';
      if ($('tf-exit'))  $('tf-exit').value  = azResult.exitSignal != null ? azResult.exitSignal.toString() : '';
      if ($('tf-notes')) $('tf-notes').value = azResult.notes || '';
      buildLegs();
    }, 80);
  }, 150);
}
