/* capture from anywhere: shortcuts (Android, other tools) add inbox items by calling the
   cockpit_capture database function with a secret token. The token is created in Settings and
   kept on this device so the setup details can be shown again. */
const CAPTURE_KEY = 'dashboard-capture-token';
let captureToken = '';
try {
  captureToken = localStorage.getItem(CAPTURE_KEY) || '';
} catch (e) {}
const captureUrl = () => (CFG.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/rpc/cockpit_capture';
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
async function newCaptureToken() {
  const { data, error } = await sb.rpc('cockpit_new_capture_token');
  if (error) {
    toast("Couldn't create a link. Run the updated supabase-setup.sql", false, 4000);
    return;
  }
  captureToken = data;
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
    if (!r.ok) throw new Error(r.status);
    toast('Sent. It will appear in your inbox');
    sync();
  } catch (e) {
    toast("The test didn't go through", false, 3000);
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
      '<p class="hint" style="margin:0 0 8px">For Android or other tools, create a private capture link.</p><button class="btn" id="capnew">Create capture link</button>'
    );
  }
  const row = (label, value, id) =>
    `<div class="caprow"><span>${label}</span><code>${esc(value)}</code><button class="linkbtn" data-copy="${id}">Copy</button></div>`;
  h +=
    row('URL', captureUrl(), 'url') +
    row('apikey header', CFG.supabaseAnonKey, 'key') +
    row('token', captureToken, 'token');
  h += `<details id="capand"${panels.capand ? ' open' : ''}><summary>Android</summary><ol class="steps">
    <li>Install the free <b>HTTP Shortcuts</b> app and create a Regular Shortcut.</li>
    <li>Method <b>POST</b>, the URL above, a header <b>apikey</b> with the value above, and a JSON body <code>{"token":"…","text":"{{text}}"}</code> where <b>text</b> is a variable that asks for input (it can use voice).</li>
    <li>Add it to your home screen, or run it from a Google Assistant routine.</li></ol></details>
    <div class="acts"><button class="btn" id="captest">Send a test</button><button class="btn" id="capnew">New link</button></div>
    <p class="hint">Anyone with the token can add items to your inbox (nothing else). "New link" replaces it; old shortcuts then stop working.</p>`;
  return h;
}
// Launched from an app-icon shortcut (manifest "shortcuts").
function receiveLaunch() {
  const q = new URLSearchParams(location.search);
  if (!q.has('capture') && !q.has('focus') && !q.has('talk')) return;
  history.replaceState(null, '', location.pathname);
  if (q.has('talk')) return talkable() ? openTalk(false) : undefined;
  if (q.has('focus')) return go('focus');
  go('inbox');
  const i = $('#iin');
  if (i) i.focus();
}
