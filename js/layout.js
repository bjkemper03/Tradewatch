// =============================================================================
// js/layout.js -- Responsive layout detection, page routing, and app startup.
// Keeps index.html structural while coordinating page modules.
// =============================================================================

const PAGES = ['overview','analyze','trades','calendar','sectors','stats','prefs'];
let curPage = 'overview';

function isDesktopLayout() {
  return window.innerWidth >= 768;
}

function syncSideNav(page) {
  document.querySelectorAll('#side-nav .snav-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

function applyLayout() {
  if (!document.body) return;
  document.body.classList.toggle('desktop', isDesktopLayout());
  syncSideNav(curPage);
}

function showPage(name) {
  curPage = name;
  PAGES.forEach(function(p) {
    var el = $('page-' + p);
    if (el) el.classList.toggle('active', p === name);
    var nb = $('nb-' + p);
    if (nb) nb.classList.toggle('active', p === name);
  });
  syncSideNav(name);
  if (name === 'overview') renderOverview();
  if (name === 'analyze') renderAnalyze();
  if (name === 'trades') renderTrades();
  if (name === 'calendar') renderCalendar();
  if (name === 'sectors') renderSectors();
  if (name === 'stats') renderStats();
  if (name === 'prefs') renderPrefs();
}

async function initApp() {
  try { trades = JSON.parse(localStorage.getItem(TK) || '[]'); } catch(e) { trades = []; }
  try { hist = normalizeHist(JSON.parse(localStorage.getItem(HK) || JSON.stringify(DEFAULT_HIST))); } catch(e) { hist = {...DEFAULT_HIST}; }
  try { prefs = JSON.parse(localStorage.getItem(CK.prefs) || JSON.stringify(DEFAULT_PREFS)); } catch(e) { prefs = {...DEFAULT_PREFS}; }
  if (!localStorage.getItem(HK)) saveHist();

  if (_sbClient && currentUser) {
    try {
      const [sbTrades, sbPrefs, sbHist] = await Promise.all([
        getTrades(),
        getUserSettings(),
        getBaseline()
      ]);
      if (Array.isArray(sbTrades)) trades = sbTrades;
      if (sbPrefs) prefs = sbPrefs;
      if (sbHist) hist = normalizeHist({ ...hist, ...sbHist });
      localStorage.setItem(TK, JSON.stringify(trades));
      localStorage.setItem(CK.prefs, JSON.stringify(prefs));
      localStorage.setItem(HK, JSON.stringify(hist));
    } catch(e) {
      console.warn('[OP] Supabase load failed, using localStorage cache:', e);
    }
  }

  $('hdr-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday:'short', month:'short', day:'numeric'
  }).toUpperCase();

  azLegData = DEF['PUT CREDIT SPREAD'].map(function(l) { return {...l}; });
  formLegData = DEF['PUT CREDIT SPREAD'].map(function(l) { return {...l}; });
  applyLayout();
  showPage('overview');
}

document.addEventListener('DOMContentLoaded', function() {
  applyLayout();
  window.addEventListener('resize', applyLayout);
});
