/* capture from anywhere: shortcuts (Android, other tools) add inbox items by calling the
   cockpit_capture database function with a secret token. The token is created in Settings and
   kept on this device so the setup details can be shown again. */
const CAPTURE_KEY = 'dashboard-capture-token';
let captureToken = '';
try {
  captureToken = localStorage.getItem(CAPTURE_KEY) || '';
} catch (e) {}
const rpcUrl = fn => (CFG.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
const captureUrl = () => rpcUrl('cockpit_capture');
const alertUrl = () => rpcUrl('cockpit_alert');
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
async function newCaptureToken() {
  const { data, error } = await sb.rpc('cockpit_new_capture_token');
  if (error) {
    toast("Couldn't create a link. Run the updated supabase-setup.sql", false, 4000);
    return;
  }
  captureToken = data;
  panels.capsetup = true; // show the new details straight away
  try {
    localStorage.setItem(CAPTURE_KEY, data);
  } catch (e) {}
  renderAccount();
}
async function testCapture() {
  try {
    const r = await fetch(captureUrl(), {
      method: 'POST',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: captureToken, text: 'Test capture from Settings' }),
    });
    if (!r.ok) {
      const msg = ((await r.json().catch(() => ({}))).message || '').toLowerCase();
      if (msg.includes('unknown capture token'))
        return toast(
          'This link was replaced on another device. Tap New link here to get a current one',
          false,
          4000,
        );
      throw new Error(r.status);
    }
    toast('Sent. It will appear in your inbox');
    sync();
  } catch (e) {
    toast("The test didn't go through", false, 3000);
  }
}
// An alert, as a script or flow would send one: a notification plus an Inbox item.
async function testAlert() {
  try {
    const r = await fetch(alertUrl(), {
      method: 'POST',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: captureToken,
        title: 'Test alert',
        body: 'Sent from Settings',
        to: 'inbox',
      }),
    });
    if (!r.ok) {
      const msg = ((await r.json().catch(() => ({}))).message || '').toLowerCase();
      return toast(
        r.status === 404 || msg.includes('cockpit_alert')
          ? 'Alerts aren’t set up yet. Run the updated supabase-setup.sql'
          : msg.includes('unknown capture token')
            ? 'This token was replaced on another device. Tap New link here to get a current one'
            : msg.includes('too many alerts')
              ? 'Too many alerts in the last hour. Try again later'
              : "The alert didn't go through (" + (msg || r.status) + ')',
        false,
        4000,
      );
    }
    toast('Sent. A notification should arrive within a minute');
    sync();
  } catch (e) {
    toast("Couldn't reach Supabase. Check the connection", false, 4000);
  }
}
function copyText(text) {
  const done = () => toast('Copied'),
    fail = () => toast("Couldn't copy on this device");
  try {
    navigator.clipboard.writeText(text).then(done, fail);
  } catch (e) {
    fail();
  }
}
function renderCapture() {
  let h = '<h2 style="margin-top:26px" id="capsec">Capture from anywhere</h2>';
  const bookmarklet =
    "javascript:void(open('" +
    appUrl() +
    "index.html?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)))";
  h += `<p class="hint" style="margin:0 0 8px">On a computer, drag this to your bookmarks bar; clicking it sends the page you're on to your inbox: <a class="linkbtn" href="${esc(bookmarklet)}">+ Dashboard</a></p>`;
  if (!captureToken) {
    return (
      h +
      '<p class="hint" style="margin:0 0 8px">For Android or other tools, create a private capture link. If you made one on another device, this replaces it (shortcuts using the old one stop working).</p><button class="btn" id="capnew">Create capture link</button>'
    );
  }
  const row = (label, value, id) =>
    `<div class="caprow"><span>${label}</span><code>${esc(value)}</code><button class="linkbtn" data-copy="${id}">Copy</button></div>`;
  // Only needed while setting up a shortcut, so kept folded away.
  h += `<details id="capsetup"${panels.capsetup ? ' open' : ''}><summary>Set up a shortcut</summary>`;
  h +=
    row('URL', captureUrl(), 'url') +
    row('Alert URL', alertUrl(), 'alert') +
    row('apikey header', CFG.supabaseAnonKey, 'key') +
    row('token', captureToken, 'token');
  h += `<details id="capand"${panels.capand ? ' open' : ''}><summary>Android</summary><ol class="steps">
    <li>Install the free <b>HTTP Shortcuts</b> app and create a Regular Shortcut.</li>
    <li>Method <b>POST</b>, the URL above, a header <b>apikey</b> with the value above, and a JSON body <code>{"token":"…","text":"{{text}}"}</code> where <b>text</b> is a variable that asks for input (it can use voice).</li>
    <li>Add it to your home screen, or run it from a Google Assistant routine.</li></ol></details>
    <p class="hint">Alerts: scripts and flows (PowerShell, Power Automate Desktop) can POST <code>{"token":"…","title":"…","body":"…","to":"inbox"}</code> to the alert URL to notify your phone. <b>to</b> is phone, inbox, today or waiting (with <b>who</b> and <b>due</b>). See the README for examples.</p>
    <div class="acts"><button class="btn" id="captest">Send a test</button><button class="btn" id="alerttest">Test alert</button><button class="btn" id="capnew">New link</button></div>
    <p class="hint">Anyone with the token can add inbox items and quests and send you alerts, but can't read or change anything else. "New link" replaces it; old shortcuts then stop working.</p></details>`;
  return h;
}
// Launched from an app-icon shortcut (manifest "shortcuts").
function receiveLaunch() {
  const q = new URLSearchParams(location.search);
  // ?focus came from a removed shortcut that installed apps may still show: just tidy the URL.
  if (!q.has('capture') && !q.has('talk') && !q.has('focus')) return;
  history.replaceState(null, '', location.pathname);
  if (q.has('focus')) return;
  go('inbox'); // (?talk came from a removed shortcut: the capture box instead)
  const i = $('#iin');
  if (i) i.focus();
}
