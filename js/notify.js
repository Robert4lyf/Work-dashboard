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
// "Send a test" checks each link in the chain and says which one is broken:
// this phone showing notifications, this device's subscription, then the server sending one.
let pushTest = null; // steps: { name, ok (true/false/null = waiting), msg }
async function testPush() {
  const steps = (pushTest = []),
    step = (name, ok, msg) => {
      const s = steps.find(x => x.name === name);
      if (s) Object.assign(s, { ok, msg });
      else steps.push({ name, ok, msg });
      renderAccount();
    };
  // 1. This phone: show one straight away, no server involved.
  let reg = null;
  try {
    reg = await navigator.serviceWorker.ready;
    if (Notification.permission !== 'granted') throw new Error('blocked');
    await reg.showNotification('Dashboard', { body: 'This phone can show notifications', tag: 'local-test' });
    step('This phone', true, 'You should see a notification now.');
  } catch (e) {
    step(
      'This phone',
      false,
      'Notifications are blocked. Allow them for Chrome/this app in Android settings, then try again.',
    );
    return;
  }
  // 2. This device's subscription uses the current key.
  try {
    const sub = await reg.pushManager.getSubscription(),
      key = sub && sub.options && sub.options.applicationServerKey,
      same = key && b64u(new Uint8Array(key)) === S.pushKey;
    if (!sub) step('Subscription', false, 'Not subscribed. Tap "Turn off here", then turn it on again.');
    else if (key && !same)
      step('Subscription', false, 'Subscribed with an old key. Tap "Turn off here", then turn it on again.');
    else step('Subscription', true, 'Subscribed with the current key.');
    if (!sub || (key && !same)) return;
  } catch (e) {
    step('Subscription', null, "Couldn't check.");
  }
  // 3. The server: queue a notice and watch for it being sent (the job runs every minute).
  const key = 'test:' + Date.now();
  const { error } = await sb.from('cockpit_notices').upsert({
    key,
    at: new Date().toISOString(),
    title: 'Dashboard',
    body: 'Test notification from the server',
  });
  if (error) return step('Server', false, "Couldn't queue a test. Run the updated supabase-setup.sql.");
  step('Server', null, 'Waiting for the server to send it (up to 90 seconds)…');
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const get = cols => sb.from('cockpit_notices').select(cols).eq('key', key).maybeSingle();
    let { data, error: e } = await get('sent_at,error');
    if (e) ({ data } = await get('sent_at')); // before the error column was added
    if (data && data.sent_at)
      return data.error
        ? step('Server', false, 'The server tried but: ' + data.error + '.')
        : step(
            'Server',
            true,
            'Sent. If it still didn’t appear, check Android’s notification settings for Chrome.',
          );
  }
  step(
    'Server',
    false,
    'Not picked up. Check that send-notices is deployed with JWT verification off, has its four secrets (VAPID_SUBJECT must start with mailto:), and that notifications-cron.sql was run with your project ref and the same CRON_SECRET (README > Notifications).',
  );
}
function renderPushTest() {
  if (!pushTest) return '';
  return (
    '<div class="list box health" style="margin-top:10px">' +
    pushTest
      .map(
        s =>
          `<div class="hrow2 ${s.ok === true ? 'ok' : s.ok === false ? 'bad' : 'na'}"><span class="hicon" aria-hidden="true">${s.ok === true ? '✓' : s.ok === false ? '✗' : '…'}</span><div><b>${esc(s.name)}</b><p>${esc(s.msg)}</p></div></div>`,
      )
      .join('') +
    '</div>'
  );
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
  waitingNodes().forEach(({ n }) => {
    const w = n.wait;
    if (w.due && soon(at9(w.due)))
      out.push({
        key: 'chase:' + n.id + ':' + w.due,
        at: at9(w.due),
        title: 'Time to chase',
        body: n.text + (w.who ? ' (' + w.who + ')' : ''),
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
    ? '<p class="hint" style="margin:0 0 8px">On for this device: focus timer ends, deadlines (9am on the day) and Upcoming items returning.</p><div class="acts" style="margin-top:0"><button class="btn" id="pushtest">Send a test</button><button class="btn" id="pushoff">Turn off here</button></div>' +
      renderPushTest()
    : '<p class="hint" style="margin:0 0 8px">Off for this device.</p><button class="btn green" id="pushon">Turn on for this device</button>';
  return h;
}
