// =============================================================================
// js/pages/admin.js -- Lightweight admin dashboard for beta operations.
// =============================================================================

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

function renderAdmin() {
  var el = $('page-admin');
  if (!el) return;
  if (!isAdminUser()) {
    el.innerHTML = '<div class="lc"><p>Admin access is not enabled for this account.</p></div>';
    return;
  }

  var open = trades.filter(function(t) { return t.status === 'OPEN'; });
  var closed = trades.filter(function(t) { return t.status === 'CLOSED'; });
  var userEmail = currentUser && currentUser.email ? currentUser.email : 'unknown';

  el.innerHTML = '<div class="fadeup">' +
    '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
        '<div>' +
          '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Admin</div>' +
          '<div style="font-size:18px;font-weight:700">Beta Admin Preview</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:4px">Signed in as ' + esc(userEmail) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px;padding:9px 12px;background:var(--yellow-dim);border:1px solid rgba(245,158,11,.25);border-radius:8px;font-size:11px;color:var(--yellow);line-height:1.5">This page is UI-only. Client-side email checks are not real security. Real admin data/actions must use a server endpoint that verifies the Supabase auth token and a server-side role or allowlist.</div>' +
    '</div>' +
    '<div class="tiles">' +
      quickTile('Open', open.length, 'var(--green)') +
      quickTile('Closed', closed.length, 'var(--text)') +
      quickTile('Mode', 'UI Only', 'var(--yellow)') +
    '</div>' +
    '<div class="card">' +
      '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Safe Admin Roadmap</div>' +
      '<div class="data-row"><span class="data-label">Server auth</span><span class="data-value">Verify JWT server-side</span></div>' +
      '<div class="data-row"><span class="data-label">Admin allowlist</span><span class="data-value">Keep on server only</span></div>' +
      '<div class="data-row"><span class="data-label">User metrics</span><span class="data-value">Use protected API route</span></div>' +
      '<div class="data-row"><span class="data-label">Tester feedback</span><span class="data-value">Use secured table/API</span></div>' +
    '</div>' +
    '</div>';
}
