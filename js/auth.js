// =============================================================================
// js/auth.js -- Supabase client setup and authentication screen behavior.
// Keeps auth event wiring out of index.html while preserving current flow.
// =============================================================================

try {
  _sbClient = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  console.log('[OP] Supabase initialized');
} catch(e) {
  console.error('[OP] Supabase init failed:', e);
}

function showLogin() {
  document.getElementById('auth-login-card').style.display  = 'block';
  document.getElementById('auth-signup-card').style.display = 'none';
  document.getElementById('auth-forgot-card').style.display = 'none';
  document.getElementById('auth-confirm-card').style.display= 'none';
  document.getElementById('login-msg').textContent = '';
}

function showSignup() {
  document.getElementById('auth-login-card').style.display  = 'none';
  document.getElementById('auth-signup-card').style.display = 'block';
  document.getElementById('auth-forgot-card').style.display = 'none';
  document.getElementById('auth-confirm-card').style.display= 'none';
  document.getElementById('signup-msg').textContent = '';
}

function showForgot() {
  document.getElementById('auth-login-card').style.display  = 'none';
  document.getElementById('auth-signup-card').style.display = 'none';
  document.getElementById('auth-forgot-card').style.display = 'block';
  document.getElementById('auth-confirm-card').style.display= 'none';
  document.getElementById('forgot-msg').textContent = '';
}

function showConfirmNotice(email) {
  document.getElementById('auth-login-card').style.display  = 'none';
  document.getElementById('auth-signup-card').style.display = 'none';
  document.getElementById('auth-forgot-card').style.display = 'none';
  document.getElementById('auth-confirm-card').style.display= 'block';
  document.getElementById('confirm-email-display').textContent = email;
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.remove('visible');
  showLogin();
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-app').classList.add('visible');
  initApp();
}

async function doSignOut() {
  if (!confirm('Sign out of OptionsPlus?')) return;
  await _sbClient.auth.signOut();
  currentUser = null;
  showAuthScreen();
}

async function bootAuth() {
  try {
    const { data } = await _sbClient.auth.getSession();
    if (data && data.session && data.session.user) {
      currentUser = data.session.user;
      showApp();
    } else {
      showAuthScreen();
    }
  } catch(e) {
    console.error('[OP] Boot auth error:', e);
    showAuthScreen();
  }

  _sbClient.auth.onAuthStateChange(function(_e, session) {
    if (session && session.user && !currentUser) {
      currentUser = session.user;
      showApp();
    } else if (!session && currentUser) {
      currentUser = null;
      showAuthScreen();
    }
  });
}

function bindAuthEvents() {
  document.getElementById('login-btn').addEventListener('click', async function() {
    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    var msg = document.getElementById('login-msg');
    var btn = document.getElementById('login-btn');
    msg.textContent = ''; msg.className = 'auth-msg';
    if (!email || !email.includes('@')) { msg.textContent = 'Enter a valid email.'; msg.className = 'auth-msg err'; return; }
    if (!password) { msg.textContent = 'Enter your password.'; msg.className = 'auth-msg err'; return; }
    if (!_sbClient) { msg.textContent = 'Auth not ready. Refresh page.'; msg.className = 'auth-msg err'; return; }
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      var result = await _sbClient.auth.signInWithPassword({ email: email, password: password });
      if (result.error) throw result.error;
    } catch(e) {
      var errMsg = e.message || 'Sign in failed.';
      if (errMsg.toLowerCase().includes('invalid') || errMsg.toLowerCase().includes('credentials')) {
        errMsg = 'Incorrect email or password.';
      } else if (errMsg.toLowerCase().includes('confirm')) {
        errMsg = 'Please confirm your email first. Check your inbox.';
      }
      msg.textContent = errMsg;
      msg.className = 'auth-msg err';
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  document.getElementById('login-password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
  document.getElementById('login-email').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });

  document.getElementById('signup-btn').addEventListener('click', async function() {
    var email    = document.getElementById('signup-email').value.trim();
    var password = document.getElementById('signup-password').value;
    var confirm  = document.getElementById('signup-confirm').value;
    var msg = document.getElementById('signup-msg');
    var btn = document.getElementById('signup-btn');
    msg.textContent = ''; msg.className = 'auth-msg';
    if (!email || !email.includes('@')) { msg.textContent = 'Enter a valid email.'; msg.className = 'auth-msg err'; return; }
    if (password.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; msg.className = 'auth-msg err'; return; }
    if (password !== confirm) { msg.textContent = 'Passwords do not match.'; msg.className = 'auth-msg err'; return; }
    if (!_sbClient) { msg.textContent = 'Auth not ready. Refresh page.'; msg.className = 'auth-msg err'; return; }
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      var result = await _sbClient.auth.signUp({
        email: email,
        password: password,
        options: { emailRedirectTo: window.location.origin }
      });
      if (result.error) throw result.error;
      if (result.data && result.data.user && !result.data.session) {
        showConfirmNotice(email);
      } else if (result.data && result.data.session) {
        currentUser = result.data.session.user;
        showApp();
      } else {
        showConfirmNotice(email);
      }
    } catch(e) {
      var errMsg = e.message || 'Sign up failed.';
      if (errMsg.toLowerCase().includes('already')) {
        errMsg = 'An account with this email already exists. Try signing in.';
      }
      msg.textContent = errMsg;
      msg.className = 'auth-msg err';
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });

  document.getElementById('signup-confirm').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('signup-btn').click();
  });

  document.getElementById('forgot-btn').addEventListener('click', async function() {
    var email = document.getElementById('forgot-email').value.trim();
    var msg = document.getElementById('forgot-msg');
    var btn = document.getElementById('forgot-btn');
    msg.textContent = ''; msg.className = 'auth-msg';
    if (!email || !email.includes('@')) { msg.textContent = 'Enter your email.'; msg.className = 'auth-msg err'; return; }
    if (!_sbClient) { msg.textContent = 'Auth not ready. Refresh page.'; msg.className = 'auth-msg err'; return; }
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      var result = await _sbClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '?reset=true'
      });
      if (result.error) throw result.error;
      msg.textContent = 'Reset link sent! Check your email.';
      msg.className = 'auth-msg ok';
      btn.textContent = 'Sent!';
    } catch(e) {
      msg.textContent = e.message || 'Could not send reset email.';
      msg.className = 'auth-msg err';
      btn.disabled = false; btn.textContent = 'Send Reset Link';
    }
  });

  document.getElementById('forgot-email').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('forgot-btn').click();
  });
}

document.addEventListener('DOMContentLoaded', function() {
  bindAuthEvents();
  bootAuth();
});
