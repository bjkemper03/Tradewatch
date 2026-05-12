// =============================================================================
// js/pages/calendar.js -- Calendar and Sectors pages
// Depends on: trades, prefs, TICKER_SECTOR, SEC_META, CK, TTL, API
//             fetchEarningsData(), buildCalendarEvents(), fetchSectorPerf()
//             gc(), sc2(), spinHtml() from js/ui.js
// =============================================================================

// ---------------------------------------------------------------------------
// CALENDAR PAGE
// ---------------------------------------------------------------------------
async function renderCalendar() {
  var el = $('page-calendar');
  if (!el) return;
  el.innerHTML = spinHtml('LOADING...');

  // Fetch earnings for open positions
  var openTickers = [];
  var seen = {};
  trades.filter(function(t) { return t.status === 'OPEN'; }).forEach(function(t) {
    if (!seen[t.ticker]) { seen[t.ticker] = true; openTickers.push(t.ticker); }
  });

  var earnMap = {};
  for (var i = 0; i < openTickers.length; i++) {
    var tk = openTickers[i];
    var e = await fetchEarningsData(tk);
    if (e) earnMap[tk] = e;
    await new Promise(function(r) { setTimeout(r, 400); });
  }

  var today   = new Date();
  var events  = buildCalendarEvents();
  var ic      = { HIGH: 'var(--red)', MED: 'var(--yellow)', LOW: 'var(--green)' };

  // Add earnings for open positions
  Object.keys(earnMap).forEach(function(tk) {
    var e = earnMap[tk];
    if (e && !events.find(function(ev) { return ev.name.includes(tk); })) {
      events.push({
        d: new Date(e.date + 'T12:00:00'),
        name: tk + ' Earnings',
        sector: 'Open Position',
        impact: 'HIGH',
        note: 'Active ' + tk + ' position -- earnings within expiration = binary risk.',
        isPos: true,
      });
    }
  });

  events.sort(function(a, b) { return a.d - b.d; });
  var upcoming = events.filter(function(ev) { return Math.ceil((ev.d - today) / 86400000) >= -1; });
  var past     = events.filter(function(ev) { return Math.ceil((ev.d - today) / 86400000) < -1; });

  function renderEvList(evs) {
    if (!evs.length) return '<div style="text-align:center;color:var(--text3);padding:30px;font-size:12px">No events</div>';
    var byM = {};
    evs.forEach(function(ev) {
      var away = Math.ceil((ev.d - today) / 86400000);
      var mk   = ev.d.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!byM[mk]) byM[mk] = [];
      byM[mk].push(Object.assign({}, ev, { away: away }));
    });

    var html = '';
    Object.keys(byM).forEach(function(month) {
      html += '<div class="mhdr">' + month + '</div>';
      byM[month].forEach(function(ev) {
        var inDTE = ev.away >= 0 && ev.away <= prefs.dteHigh;
        var imm   = ev.away >= 0 && ev.away <= 5 && ev.impact === 'HIGH';
        var dc    = imm ? 'var(--red)' : inDTE ? 'var(--yellow)' : 'var(--text)';
        var away  = ev.away <= 0 ? 'Today' : ev.away === 1 ? 'Tmr' : ev.away < 0 ? Math.abs(ev.away) + 'd ago' : ev.away + 'D';
        html += '<div class="cal-ev ' + (imm ? 'imm' : inDTE ? 'dte' : '') + '">' +
          '<div class="cal-date-box">' +
            '<div class="cal-day" style="color:' + dc + '">' + ev.d.getDate() + '</div>' +
            '<div class="cal-mon">' + ev.d.toLocaleString('default', { month: 'short' }) + '</div>' +
          '</div>' +
          '<div style="flex:1">' +
            '<div style="font-size:13px;font-weight:600;margin-bottom:3px">' + ev.name +
              (ev.isPos ? ' <span style="font-size:9px;color:var(--blue2)">[OPEN]</span>' : '') +
            '</div>' +
            (ev.note ? '<div style="font-size:11px;color:var(--text2);line-height:1.5;margin-bottom:4px">' + ev.note + '</div>' : '') +
            '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
              '<span class="chip" style="background:var(--surface2);color:var(--text3);font-size:9px">' + ev.sector + '</span>' +
              '<span class="chip" style="background:' + ic[ev.impact] + '18;color:' + ic[ev.impact] + ';font-size:9px">' + ev.impact + '</span>' +
              (inDTE ? '<span class="chip" style="background:var(--yellow-dim);color:var(--yellow);font-size:9px">IN DTE</span>' : '') +
              (imm   ? '<span class="chip" style="background:var(--red-dim);color:var(--red);font-size:9px">IMMINENT</span>' : '') +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;min-width:34px">' +
            '<div style="font-family:var(--mono);font-size:11px;font-weight:600;color:' + dc + '">' + away + '</div>' +
          '</div>' +
        '</div>';
      });
    });
    return html;
  }

  var calendarHtml =
    '<div style="text-align:right;padding:0 16px 6px">' +
      '<button class="btn btn-ghost btn-sm" onclick="showPage(\'sectors\')" style="font-size:10px">View Sectors &rarr;</button>' +
    '</div>' +
    '<div class="cal-tabs">' +
      '<div class="cal-tab active" id="cal-tab-up">Upcoming</div>' +
      '<div class="cal-tab" id="cal-tab-past">Past Events</div>' +
    '</div>' +
    '<div id="cal-content"></div>';

  if (document.body && document.body.classList.contains('desktop')) {
    el.innerHTML = '<div class="desktop-cal-sec">' +
      '<div>' + calendarHtml + '</div>' +
      '<div><div class="desktop-panel-title">Sector Watch</div>' + await buildSectorsHtml() + '</div>' +
    '</div>';
  } else {
    el.innerHTML = calendarHtml;
  }

  $('cal-content').innerHTML = renderEvList(upcoming);

  $('cal-tab-up').onclick = function() {
    $('cal-content').innerHTML = renderEvList(upcoming);
    $('cal-tab-up').classList.add('active');
    $('cal-tab-past').classList.remove('active');
  };
  $('cal-tab-past').onclick = function() {
    $('cal-content').innerHTML = renderEvList(past);
    $('cal-tab-past').classList.add('active');
    $('cal-tab-up').classList.remove('active');
  };
}

// ---------------------------------------------------------------------------
// SECTORS PAGE
// ---------------------------------------------------------------------------
async function buildSectorsHtml() {
  var perf = gc(CK.sec, TTL.sec);
  if (!perf) {
    perf = {};
    var mktCache = gc(CK.mkt, TTL.mkt);
    perf['SPY'] = (mktCache && mktCache.spy && mktCache.spy.perf5) ? mktCache.spy.perf5 : null;
    for (var i = 0; i < SEC_META.length; i++) {
      var s = SEC_META[i];
      try {
        var r = await fetch(API.quote + '?ticker=' + s.sym, { signal: AbortSignal.timeout(8000) });
        var d = await r.json();
        perf[s.sym] = d.ok ? d.changePct : null;
      } catch(e) {
        perf[s.sym] = null;
      }
      await new Promise(function(res) { setTimeout(res, 300); });
    }
    sc2(CK.sec, perf);
  }

  var spyPerf  = perf['SPY'] || 0;
  var positive = SEC_META.filter(function(s) { return perf[s.sym] !== null && perf[s.sym] > 0; }).length;

  var openTickers = new Set(trades.filter(function(t) { return t.status === 'OPEN'; }).map(function(t) { return t.ticker; }));
  var openSectors = new Set();
  openTickers.forEach(function(tk) {
    if (TICKER_SECTOR[tk]) openSectors.add(TICKER_SECTOR[tk]);
  });

  var html =
    '<div style="padding:0 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-size:12px;color:var(--text2)">SPY 5D: <span style="font-family:var(--mono);font-weight:700;color:' +
        (spyPerf > 0 ? 'var(--green)' : 'var(--red)') + '">' + (spyPerf > 0 ? '+' : '') + spyPerf + '%</span></div>' +
      '<div style="font-size:11px;color:var(--text3)">' + positive + '/' + SEC_META.length + ' positive</div>' +
    '</div>';

  SEC_META.forEach(function(s) {
    var raw     = perf[s.sym];
    var has     = raw != null;
    var pct     = has ? raw : 0;
    var rel     = has ? parseFloat((pct - spyPerf).toFixed(2)) : null;
    var out     = rel !== null && rel > 0.5;
    var under   = rel !== null && rel < -0.5;
    var col     = !has ? 'var(--text3)' : out ? 'var(--green)' : under ? 'var(--red)' : 'var(--yellow)';
    var leftCol = !has ? 'var(--border)' : out ? 'var(--green)' : under ? 'var(--red)' : 'var(--yellow)';
    var hint    = out ? 'Consider spreads on ' + s.sym + ' names' : under ? s.sym + ' trending down -- wider cushion or skip' : null;
    var hasPos  = openSectors.has(s.name);

    html += '<div class="sec" style="border-left-color:' + leftCol + '">' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span style="font-size:13px;font-weight:600">' + s.name + '</span>' +
          '<span style="font-size:9px;color:var(--text3);font-family:var(--mono)">' + s.sym + '</span>' +
          (hasPos ? '<span class="chip" style="background:var(--blue-dim);color:var(--blue2);border:1px solid rgba(99,102,241,.25);font-size:8px">OPEN</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--text3);margin-bottom:3px">' + s.top3 + '</div>' +
        '<div style="font-size:11px;color:var(--text2);line-height:1.4">' + s.note + '</div>' +
        (hint ? '<div style="font-size:10px;color:' + col + ';margin-top:3px">&rarr; ' + hint + '</div>' : '') +
        (rel !== null ? '<div style="font-size:10px;color:' + col + ';margin-top:2px;font-family:var(--mono)">' + (rel > 0 ? '+' : '') + rel + '% vs SPY</div>' : '') +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0;min-width:56px">' +
        '<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:' + col + '">' + (has ? (pct > 0 ? '+' : '') + pct + '%' : 'N/A') + '</div>' +
        '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + (out ? '&uarr;' : under ? '&darr;' : '&rarr;') + ' 1-day</div>' +
      '</div>' +
    '</div>';
  });

  html += '<div style="text-align:center;padding:8px 0 12px">' +
    '<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="localStorage.removeItem(CK.sec);showPage(curPage)">&#8635; Refresh Sectors</button>' +
  '</div>';

  return html;
}

async function renderSectors() {
  var el = $('page-sectors');
  if (!el) return;
  el.innerHTML = spinHtml('FETCHING SECTORS...');
  el.innerHTML = await buildSectorsHtml();
}
