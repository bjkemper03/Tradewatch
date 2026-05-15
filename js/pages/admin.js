// =============================================================================
// js/pages/admin.js -- Lightweight admin dashboard for beta operations.
// =============================================================================

const ADMIN_EVENTS_KEY = 'op_admin_events_v1';

function recordAdminEvent(type, meta) {
  try {
    var rows = JSON.parse(localStorage.getItem(ADMIN_EVENTS_KEY) || '[]');
    rows.push({ type: type, meta: meta || {}, ts: new Date().toISOString() });
    localStorage.setItem(ADMIN_EVENTS_KEY, JSON.stringify(rows.slice(-500)));
  } catch(e) {}
}

function installAdminNav() {
  if (!isAdminUser() || $('nb-admin')) return;
  var sideBottom = document.querySelector('#side-nav .snav-bottom');
  if (sideBottom) {
    var btn = document.createElement('button');
    btn.className = 'snav-btn';
    btn.dataset.page = 'admin';
    btn.onclick = function() { showPage('admin'); };
    btn.textContent = 'Admin';
    sideBottom.insertBefore(btn, sideBottom.firstChild);
  }
}

function adminEvents() {
  try { return JSON.parse(localStorage.getItem(ADMIN_EVENTS_KEY) || '[]'); }
  catch(e) { return []; }
}

function renderAdmin() {
  var el = $('page-admin');
  if (!el) return;
  if (!isAdminUser()) {
    el.innerHTML = '<div class="lc"><p>Admin access is not enabled for this account.</p></div>';
    return;
  }

  var events = adminEvents();
  var open = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closed = trades.filter(function(t) { return t.status === 'CLOSED'; });
  var lastSeen = events.length ? new Date(events[events.length - 1].ts).toLocaleString() : 'No local events yet';
  var userEmail = currentUser && currentUser.email ? currentUser.email : 'unknown';
  var cacheKeys = Object.keys(localStorage).filter(function(k) { return k.indexOf('op_') === 0; });

  el.innerHTML = '<div class="fadeup">' +
    '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
        '<div>' +
          '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Admin</div>' +
          '<div style="font-size:18px;font-weight:700">Beta Operations</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:4px">Signed in as ' + esc(userEmail) + '</div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="recordAdminEvent(\'feedback_reviewed\');renderAdmin()">Mark Reviewed</button>' +
      '</div>' +
    '</div>' +
    '<div class="tiles">' +
      quickTile('Views', events.filter(function(e) { return e.type === 'page_view'; }).length, 'var(--blue2)') +
      quickTile('Open', open.length, 'var(--green)') +
      quickTile('Closed', closed.length, 'var(--text)') +
    '</div>' +
    '<div class="tiles">' +
      quickTile('Admin Events', events.length, 'var(--yellow)') +
      quickTile('Cache Keys', cacheKeys.length, 'var(--text2)') +
      quickTile('Last Event', lastSeen === 'No local events yet' ? 'None' : 'Seen', 'var(--text)') +
    '</div>' +
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Sales & Marketing Notes</div>' +
      '<textarea id="admin-notes" style="min-height:90px;font-size:12px" placeholder="Tester feedback, launch ideas, sales notes...">' + esc(localStorage.getItem('op_admin_notes_v1') || '') + '</textarea>' +
      '<button class="btn btn-primary btn-w" style="margin-top:10px" onclick="localStorage.setItem(\'op_admin_notes_v1\', $(\'admin-notes\').value);recordAdminEvent(\'admin_notes_saved\');toast(\'Admin notes saved\')">Save Notes</button>' +
    '</div>' +
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Useful Next Metrics</div>' +
      '<div class="data-row"><span class="data-label">Supabase user count</span><span class="data-value">Needs service API route</span></div>' +
      '<div class="data-row"><span class="data-label">Signups by week</span><span class="data-value">Needs analytics table</span></div>' +
      '<div class="data-row"><span class="data-label">Feature usage</span><span class="data-value">Track analyze/log/close actions</span></div>' +
      '<div class="data-row"><span class="data-label">Tester feedback</span><span class="data-value">Add shared feedback form</span></div>' +
    '</div>' +
    '</div>';
}
