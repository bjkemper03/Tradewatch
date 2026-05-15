// =============================================================================
// js/ui.js -- Shared DOM, color, toast, and HTML helper functions
// Must load BEFORE any js/pages/*.js files.
// All functions are global.
// =============================================================================

const $ = id => document.getElementById(id);
const sigC = s => s==='GREEN'?'#22c55e':s==='YELLOW'?'#f59e0b':'#ef4444';
const barC = s => s>=62?'#22c55e':s>=42?'#f59e0b':'#ef4444';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch];
  });
}

function isAdminUser() {
  var email = currentUser && currentUser.email ? currentUser.email.toLowerCase() : '';
  return ADMIN_EMAILS.map(function(e) { return e.toLowerCase(); }).indexOf(email) !== -1;
}

function toast(m, d=2500) {
  const t = $('toast');
  t.textContent = m;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', d);
}

// ---------------------------------------------------------------------------
// Metric card -- small labeled value box
// ---------------------------------------------------------------------------
function mc2(label, value, color) {
  return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 11px">' +
    '<div style="font-size:9px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">' + label + '</div>' +
    '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + (color || 'var(--text)') + '">' + value + '</div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Grid layout wrappers
// ---------------------------------------------------------------------------
function g2html(items) {
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' + items.join('') + '</div>';
}

function g3html(items) {
  return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">' + items.join('') + '</div>';
}

// ---------------------------------------------------------------------------
// Score bar -- used in overview signal breakdown
// ---------------------------------------------------------------------------
function sbar(label, score, weight) {
  var col = score >= 62 ? '#22c55e' : score >= 42 ? '#f59e0b' : '#ef4444';
  return '<div class="sb-wrap">' +
    '<div class="sb-row">' +
      '<span style="color:var(--text2);font-size:11px">' + label + '</span>' +
      '<span style="color:' + col + ';font-family:var(--mono);font-size:11px">' + Math.round(score) + '/100 &bull; ' + weight + '</span>' +
    '</div>' +
    '<div class="sb-track"><div class="sb-fill" style="width:' + score + '%;background:' + col + '"></div></div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Quick stat tile
// ---------------------------------------------------------------------------
function quickTile(label, val, col) {
  return '<div class="tile">' +
    '<div class="tile-label">' + label + '</div>' +
    '<div class="tile-value" style="color:' + col + ';font-size:14px">' + val + '</div>' +
  '</div>';
}

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------
function spinHtml(msg) {
  return '<div class="lc"><div class="spin"></div><p>' + msg + '</p></div>';
}

// ---------------------------------------------------------------------------
// Gauge SVG -- used by overview signal display
// ---------------------------------------------------------------------------
function renderGauge(score, sig) {
  var col = sig === 'GREEN' ? '#22c55e' : sig === 'YELLOW' ? '#f59e0b' : '#ef4444';
  var toRad = function(d) { return d * Math.PI / 180; };
  var cx = 80, cy = 75, r = 58;
  var startDeg = -210, endDeg = 30;
  var scoreDeg = startDeg + (score / 100) * (endDeg - startDeg);
  var arcX = function(d) { return cx + r * Math.cos(toRad(d)); };
  var arcY = function(d) { return cy + r * Math.sin(toRad(d)); };
  var bgLarge = (endDeg - startDeg) > 180 ? 1 : 0;
  var bgD = 'M' + arcX(startDeg).toFixed(1) + ' ' + arcY(startDeg).toFixed(1) +
            ' A' + r + ' ' + r + ' 0 ' + bgLarge + ' 1 ' +
            arcX(endDeg).toFixed(1) + ' ' + arcY(endDeg).toFixed(1);
  var scoreLarge = (scoreDeg - startDeg) > 180 ? 1 : 0;
  var scoreD = score > 0
    ? 'M' + arcX(startDeg).toFixed(1) + ' ' + arcY(startDeg).toFixed(1) +
      ' A' + r + ' ' + r + ' 0 ' + scoreLarge + ' 1 ' +
      arcX(scoreDeg).toFixed(1) + ' ' + arcY(scoreDeg).toFixed(1)
    : '';
  var nx = (cx + (r - 10) * Math.cos(toRad(scoreDeg))).toFixed(1);
  var ny = (cy + (r - 10) * Math.sin(toRad(scoreDeg))).toFixed(1);
  return '<svg width="160" height="100" viewBox="0 0 160 100" style="display:block;margin:0 auto">' +
    '<path d="' + bgD + '" stroke="#252d3d" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    (scoreD ? '<path d="' + scoreD + '" stroke="' + col + '" stroke-width="9" fill="none" stroke-linecap="round" opacity=".85"/>' : '') +
    '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="' + col + '" stroke-width="2.5" stroke-linecap="round"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="3.5" fill="' + col + '"/>' +
  '</svg>';
}
