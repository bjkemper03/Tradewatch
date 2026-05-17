// =============================================================================
// js/analyze/analyzeSubmit.js -- Analyze API submission flow
// =============================================================================

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

    d.legs = azLegData.map(function(l) { return Object.assign({}, l); });
    d.entryPremium = credit;
    d.notes = $('az-ctx') ? $('az-ctx').value.trim() : '';
    lastAnalysisResult = JSON.parse(JSON.stringify(d));

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
      entryPremium:  credit,
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
    azResult.analysis = JSON.parse(JSON.stringify(d));

    renderAnalysisResult(d);

  } catch(e) {
    console.error('Analysis error:', e);
    $('az-result').innerHTML = '<div style="padding:14px;color:var(--red);font-size:11px">Fetch failed: ' + e.message + '</div>';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '&rarr; Analyze Trade';
  }
}
