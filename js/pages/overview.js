// =============================================================================
// js/pages/overview.js -- Overview / market signal page
// Depends on: prefs, CK, fetchMarketData(), buildGuidance(), renderGauge(),
//             sVIX(), sStruct(), sSent(), getSig(), sigC(), barC(),
//             g3html(), mc2(), quickTile(), spinHtml() from ui.js
// =============================================================================

function renderOverview() {
  var el = $('page-overview');
  el.innerHTML = spinHtml('LOADING SIGNAL...');

  fetchMarketData().then(function(mkt) {
    if (!mkt) {
      el.innerHTML = '<div class="lc"><p style="color:var(--red)">Data unavailable.</p>' +
        '<button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="renderOverview()">Retry</button></div>';
      return;
    }

    var vix = mkt.vix, fg = mkt.fg, spy = mkt.spy, qqq = mkt.qqq, hyg = mkt.hyg, rsp = mkt.rsp;
    var creditChg = (hyg && hyg.perf5) ? -hyg.perf5 * 2 : 0;
    var rspDiff   = (rsp && spy) ? parseFloat((rsp.perf5 - spy.perf5).toFixed(2)) : 0;
    var vs        = sVIX(vix && vix.level, (vix && vix.chg) || 0);
    var ss        = sStruct(spy && spy.above50, spy && spy.above200, qqq && qqq.above50, rspDiff);
    var sent      = sSent(fg, creditChg);
    var composite = Math.round(vs * 0.40 + ss * 0.35 + sent * 0.15 + 10);
    var sig       = getSig(vs, ss, sent);
    var col       = sigC(sig);
    var fgScore   = (fg && fg.score) || 50;
    var fgCol     = fgScore > 60 ? '#22c55e' : fgScore < 40 ? '#ef4444' : '#f59e0b';
    var sigLabel  = sig === 'GREEN' ? 'Strong Market Conditions' : sig === 'YELLOW' ? 'Mixed Market Conditions' : 'Poor Market Conditions';

    var cacheTs = JSON.parse(localStorage.getItem(CK.mkt) || '{}').ts || Date.now();
    var age     = Math.round((Date.now() - cacheTs) / 60000);

    // Update header signal pill
    var pill = $('hdr-sig');
    if (pill) {
      pill.style.display    = 'flex';
      pill.style.background = col + '18';
      pill.style.border     = '1px solid ' + col + '30';
      pill.innerHTML = '<div style="width:6px;height:6px;border-radius:50%;background:' + col + '"></div>' +
        '<span style="color:' + col + ';font-size:10px;font-weight:600">' + sig + '</span>';
    }

    el.innerHTML = '<div class="fadeup">' +

      // ── Signal card ───────────────────────────────────────────────────────
      '<div class="card" style="border-color:' + col + '25">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<div>' +
            '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Market Signal</div>' +
            '<div style="font-size:20px;font-weight:700;color:' + col + '">' + sigLabel + '</div>' +
          '</div>' +
          renderGauge(composite, sig) +
        '</div>' +
        g3html([
          mc2('VIX Env',    Math.round(vs),   barC(vs)),
          mc2('Structure',  Math.round(ss),   barC(ss)),
          mc2('Sentiment',  Math.round(sent), barC(sent))
        ]) +
        '<div style="padding:9px 12px;background:' + col + '0c;border-radius:8px;font-size:11px;color:' + col + ';line-height:1.5;border:1px solid ' + col + '18">Signal describes broad market conditions only. Direction, sizing, and strategy choice depend on your trade plan.</div>' +
      '</div>' +

      // ── Market tiles row 1 ────────────────────────────────────────────────
      '<div class="tiles">' +
        quickTile('VIX',
          (vix && vix.ok && vix.level) ? vix.level.toFixed(1) : 'N/A',
          (vix && vix.ok && vix.level) ? (vix.level < 18 ? 'var(--green)' : vix.level < 26 ? 'var(--yellow)' : 'var(--red)') : 'var(--text3)') +
        quickTile('SPY 5D',
          (spy && spy.perf5 !== undefined) ? (spy.perf5 > 0 ? '+' : '') + spy.perf5 + '%' : 'N/A',
          (spy && spy.perf5 > 0) ? 'var(--green)' : (spy && spy.perf5 < 0) ? 'var(--red)' : 'var(--text3)') +
        quickTile('SPY',
          (spy && spy.price) ? '$' + spy.price : 'N/A',
          'var(--text)') +
      '</div>' +

      // ── Market tiles row 2 ────────────────────────────────────────────────
      '<div class="tiles">' +
        quickTile('SPY 50MA',  (spy && spy.above50)  ? 'Above' : 'Below', (spy && spy.above50)  ? 'var(--green)' : 'var(--red)') +
        quickTile('QQQ 50MA',  (qqq && qqq.above50)  ? 'Above' : 'Below', (qqq && qqq.above50)  ? 'var(--green)' : 'var(--red)') +
        quickTile('RSP/SPY',
          rspDiff ? (rspDiff > 0 ? '+' : '') + rspDiff + '%' : 'N/A',
          rspDiff > 0.5 ? 'var(--green)' : rspDiff < -1 ? 'var(--red)' : 'var(--yellow)') +
      '</div>' +

      // ── Guidance ──────────────────────────────────────────────────────────
      '<div class="card">' +
        '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">What This Means</div>' +
        '<div style="font-size:12px;color:var(--text2);line-height:1.7">' + buildGuidance(sig, vix, spy, creditChg, fg, rspDiff) + '</div>' +
      '</div>' +

      // ── Market note ───────────────────────────────────────────────────────
      (prefs.marketNote
        ? '<div class="card" style="border-color:rgba(245,158,11,.3)">' +
            '<div style="font-size:10px;color:var(--yellow);font-weight:600;margin-bottom:5px">MARKET NOTE</div>' +
            '<div style="font-size:12px;color:var(--text2);line-height:1.6">' + prefs.marketNote + '</div>' +
          '</div>'
        : '') +

      // ── Cache info ────────────────────────────────────────────────────────
      '<div style="text-align:center;padding:4px 0 12px">' +
        '<span class="dl"><span class="dl-dot"></span>' + (age < 2 ? 'Just fetched' : age + 'm ago') + ' &bull; 4hr cache</span><br>' +
        '<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="fetchMarketData(true).then(function(){renderOverview()})">&#8635; Force Refresh</button>' +
      '</div>' +

    '</div>';
  });
}
