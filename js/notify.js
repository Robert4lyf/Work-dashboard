/* notifications: real push notifications, even with the app closed. Each device that turns them
   on stores its push subscription in cockpit_push_subs; the app keeps a queue of upcoming notices
   in cockpit_notices, and the send-notices function sends the due ones every minute.
   One-time setup needs a VAPID key pair: the public key is kept in synced data (S.pushKey), the
   private key goes into Supabase's function secrets. */
const PUSH_KEY = 'dashboard-push-endpoint';
let pushEndpoint = '';
try {
  pushEndpoint = localStorage.getItem(PUSH_KEY) || '';
} catch (e) {}
let newPrivateKey = ''; // shown once after generating keys, never stored
const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64u = bytes =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function generatePushKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)),
    jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u(pub), privateKey: jwk.d };
}
async function setupPushKeys() {
  const k = await generatePushKeys();
  S.pushKey = k.publicKey;
  newPrivateKey = k.privateKey;
  save();
  renderAccount();
}
async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') {
      toast('Notifications are blocked in browser settings', false, 3000);
      return;
    }
    const reg = await navigator.serviceWorker.ready,
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: unb64u(S.pushKey),
      }),
      j = sub.toJSON();
    const { error } = await sb
      .from('cockpit_push_subs')
      .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
    if (error) throw error;
    pushEndpoint = j.endpoint;
    localStorage.setItem(PUSH_KEY, pushEndpoint);
    toast('Notifications on for this device');
  } catch (e) {
    console.warn(e);
    toast("Couldn't turn notifications on here", false, 3000);
  }
  renderAccount();
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready,
      sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await sb.from('cockpit_push_subs').delete().eq('endpoint', pushEndpoint);
  } catch (e) {}
  pushEndpoint = '';
  try {
    localStorage.removeItem(PUSH_KEY);
  } catch (e) {}
  renderAccount();
}
async function testPush() {
  const { error } = await sb.from('cockpit_notices').upsert({
    key: 'test:' + Date.now(),
    at: new Date().toISOString(),
    title: 'Dashboard',
    body: 'Test notification',
  });
  toast(error ? "Couldn't queue a test" : 'Test queued. It arrives within a minute');
}

// The notices the current data calls for: timer end, deadlines (9am on the day) and Upcoming
// items returning to Today (9am on the day), over the next 30 days.
function wantedNotices(now = Date.now()) {
  const out = [],
    at9 = ds => {
      const [y, m, d] = ds.split('-').map(Number);
      return new Date(y, m - 1, d, 9).getTime();
    },
    soon = t => t > now && t < now + 30 * 864e5;
  const t = S.timer;
  if (t && t.left == null && soon(t.end))
    out.push({ key: 'timer:' + t.end, at: t.end, title: 'Focus session done', body: timerLabel(t) || '' });
  (function w(ns, trail) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && soon(at9(n.due)))
        out.push({
          key: 'due:' + n.id + ':' + n.due,
          at: at9(n.due),
          title: 'Due today',
          body: [...trail, n.text].join(' / '),
        });
      w(n.children, [...trail, n.text]);
    });
  })(S.quests, []);
  S.later.forEach(n => {
    if (soon(at9(n.start)))
      out.push({
        key: 'start:' + n.id + ':' + n.start,
        at: at9(n.start),
        title: 'Back on Today',
        body: n.text,
      });
  });
  S.promises.forEach(p => {
    if (!p.done && p.due && soon(at9(p.due)))
      out.push({
        key: 'promise:' + p.id + ':' + p.due,
        at: at9(p.due),
        title: p.dir === 'owe' ? 'Promise due' : 'Time to chase',
        body: p.what + (p.who ? (p.dir === 'owe' ? ' for ' : ' from ') + p.who : ''),
      });
  });
  return out;
}
// Keep the server's queue matching wantedNotices(); only talks to the server when it changed.
const NOTICE_HASH = 'dashboard-notices-hash';
async function syncNotices() {
  if (!sb || !session || !S.pushKey) return;
  const want = wantedNotices(),
    h = hashOf(want);
  try {
    if (localStorage.getItem(NOTICE_HASH) === h) return;
  } catch (e) {}
  const { data, error } = await sb.from('cockpit_notices').select('key').is('sent_at', null);
  if (error) return;
  const keep = new Set(want.map(n => n.key)),
    stale = data.map(r => r.key).filter(k => !keep.has(k) && !k.startsWith('test:'));
  if (want.length) {
    const { error: e2 } = await sb.from('cockpit_notices').upsert(
      want.map(n => ({ ...n, at: new Date(n.at).toISOString() })),
      { onConflict: 'user_id,key' },
    );
    if (e2) return;
  }
  if (stale.length) await sb.from('cockpit_notices').delete().in('key', stale);
  try {
    localStorage.setItem(NOTICE_HASH, h);
  } catch (e) {}
}

function renderNotifySettings() {
  let h = '<h2 style="margin-top:26px" id="notifsec">Notifications</h2>';
  if (!pushSupported()) return h + '<p class="hint">This browser can\'t receive notifications.</p>';
  if (!S.pushKey)
    return (
      h +
      '<p class="hint" style="margin:0 0 8px">A one-time setup is needed first (see "Notifications" in the README). It starts with a key pair.</p><button class="btn" id="pushkeys">Generate keys</button>'
    );
  if (newPrivateKey)
    h += `<div class="banner box"><p>Copy these into Supabase > Edge Functions > Secrets now. The private key isn't saved anywhere else.</p>
      <div class="caprow"><span>VAPID_PUBLIC_KEY</span><code>${esc(S.pushKey)}</code><button class="linkbtn" data-copy="vpub">Copy</button></div>
      <div class="caprow"><span>VAPID_PRIVATE_KEY</span><code>${esc(newPrivateKey)}</code><button class="linkbtn" data-copy="vpriv">Copy</button></div></div>`;
  h += pushEndpoint
    ? '<p class="hint" style="margin:0 0 8px">On for this device: focus timer ends, deadlines (9am on the day) and Upcoming items returning.</p><div class="acts" style="margin-top:0"><button class="btn" id="pushtest">Send a test</button><button class="btn" id="pushoff">Turn off here</button></div>'
    : '<p class="hint" style="margin:0 0 8px">Off for this device.</p><button class="btn green" id="pushon">Turn on for this device</button>';
  return h;
}
