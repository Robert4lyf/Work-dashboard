/* alarms: set for times today. When one goes off it rings on the chosen device (or all of them)
   until dismissed: continuously while the app is open there, and as a repeating notification
   (once a minute for 10 minutes) when it isn't. At the end of the day every alarm switches off
   but stays in the list, ready to edit or switch on again.
   An alarm: { id, time 'HH:MM', label, device ('' = any), day (the day it's on for, else ''),
   done (the day it was dismissed), snooze (ms time to ring again, or 0) } */

// This device: an id and a name, kept on the device; the list of named devices is synced so an
// alarm can pick one.
const DEVICE_KEY = 'dashboard-device';
let thisDevice = null;
try {
  thisDevice = JSON.parse(localStorage.getItem(DEVICE_KEY));
} catch (e) {}
if (!thisDevice || !thisDevice.id) {
  const ua = navigator.userAgent;
  thisDevice = {
    id: 'd' + Math.random().toString(36).slice(2, 10),
    name: /Android/i.test(ua) ? 'Android phone' : /Windows/i.test(ua) ? 'Windows PC' : 'This device',
  };
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(thisDevice));
  } catch (e) {}
}
// Keep this device's entry (name, and push endpoint for alarm notifications) up to date.
function registerDevice() {
  const cur = S.devices.find(d => d.id === thisDevice.id),
    want = { id: thisDevice.id, name: thisDevice.name, endpoint: pushEndpoint || '' };
  if (cur && cur.name === want.name && cur.endpoint === want.endpoint) return;
  if (cur) Object.assign(cur, want);
  else S.devices.push(want);
  save();
}
// Forget another device (e.g. an old phone, or a browser whose data was cleared). Its alarms
// ring on any device instead.
function forgetDevice(id) {
  if (id === thisDevice.id) return;
  S.devices = S.devices.filter(d => d.id !== id);
  S.alarms.forEach(a => a.device === id && (a.device = ''));
  save();
  renderAll();
}
function renderDevices() {
  const others = S.devices.filter(d => d.id !== thisDevice.id);
  if (!others.length) return '';
  return `<p class="hint" style="margin:6px 0 0">Other devices (forget ones you no longer use; one still in use adds itself back): ${others
    .map(
      d =>
        `<span class="tchip"><span>${esc(d.name)}</span><button class="tdel" data-forgetdev="${d.id}" aria-label="Forget ${esc(d.name)}">×</button></span>`,
    )
    .join(' ')}</p>`;
}
function renameDevice(name) {
  name = name.trim().slice(0, 40);
  if (!name || name === thisDevice.name) return;
  thisDevice.name = name;
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(thisDevice));
  } catch (e) {}
  registerDevice();
  renderAll();
}

// Dismissed (or passed) for the day it's on for.
const alarmDone = a => !!a.done && a.done === a.day;
// On and not yet dismissed: it will ring, is ringing, or is snoozed.
const alarmLive = a => alarmOn(a) && !alarmDone(a);
// On for today; or on for yesterday and still ringing or snoozed across midnight (until it's
// dismissed, for up to an hour past its time, so a missed one doesn't ring the next morning).
const alarmOn = a =>
  a.day === today() || (a.day === shift(today(), -1) && !alarmDone(a) && alarmAt(a) > Date.now() - 3600e3);
const hhmmOf = t => {
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
// When it rings (ms): its time on the day it's on for (today if off), or the snooze time.
function alarmAt(a) {
  if (a.snooze) return a.snooze;
  const [h, m] = a.time.split(':').map(Number),
    [y, mo, d] = (a.day || today()).split('-').map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
}
// The device an alarm rings on: '' for any (also when its device is no longer listed, e.g.
// forgotten elsewhere at the same time the alarm was edited).
const alarmTarget = a => (a.device && S.devices.some(d => d.id === a.device) ? a.device : '');
const ringsHere = a => !alarmTarget(a) || alarmTarget(a) === thisDevice.id;
const ringing = (now = Date.now()) => S.alarms.filter(a => alarmLive(a) && now >= alarmAt(a) && ringsHere(a));
// The push endpoint that should get an alarm's notifications: '' for all devices, null if the
// chosen device can't receive them.
function alarmEndpoint(a) {
  if (!alarmTarget(a)) return '';
  const d = S.devices.find(x => x.id === a.device);
  return d && d.endpoint ? d.endpoint : null;
}
// Notices for alarms that are on: one when it goes off, then once a minute for 10 minutes,
// until dismissed. All ten stay wanted while the alarm is live, even once due, so a device
// syncing never removes one the server hasn't got round to sending yet.
function alarmNotices(now) {
  const out = [];
  S.alarms.forEach(a => {
    if (!alarmLive(a)) return;
    const ep = alarmEndpoint(a);
    if (ep === null) return;
    const start = alarmAt(a);
    for (let n = 0; n < 10; n++) {
      const at = start + n * 60000;
      const x = {
        // `armed` changes whenever it's switched on or its time changes, so a new ring never
        // reuses a key the server has already marked sent.
        key: `alarm:${a.id}:${a.armed || a.day}:${a.snooze || 0}:${n}`,
        at,
        title: '⏰ ' + (a.label || 'Alarm'),
        body: 'Alarm for ' + a.time + '. Open the app to dismiss.',
      };
      // Always set (null = every device), so switching to Any device updates queued rows too.
      x.device = ep || null;
      out.push(x);
    }
  });
  return out;
}

function addAlarm() {
  const h = new Date().getHours() + 1;
  S.alarms.push({
    id: uid(),
    time: h > 23 ? '23:59' : pad(h) + ':00', // not 00:00, which could never be switched on today
    label: '',
    device: '',
    day: '',
    done: '',
    snooze: 0,
  });
  alarmsOpen = true;
  save();
  renderAll();
}
// Switch on for today (only if the time is still to come) or off.
function setAlarmOn(a, on) {
  if (on) {
    if (alarmAt({ ...a, day: today(), snooze: 0 }) <= Date.now()) {
      toast('That time has already passed today', false, 2500);
      return renderAll();
    }
    Object.assign(a, { day: today(), done: '', snooze: 0, armed: Date.now() });
  } else Object.assign(a, { day: '', done: '', snooze: 0 });
  save();
  renderAll();
}
function editAlarm(id, field, value) {
  const a = S.alarms.find(x => x.id === id);
  if (!a) return;
  if (field === 'time') {
    if (!/^\d\d:\d\d$/.test(value) || value === a.time) return;
    const wasOn = alarmOn(a);
    a.time = value;
    a.snooze = 0;
    a.armed = Date.now();
    // A new time is for today if the alarm was on (even ringing from last night); an alarm
    // that was off stays off (clearing any leftover day, which could otherwise make it ring).
    a.day = wasOn ? today() : '';
    // A time already gone today (possibly just part-way through typing a new one) mustn't ring
    // straight away: it counts as done until it's set to a time still to come.
    a.done = wasOn && alarmAt(a) <= Date.now() ? a.day : '';
    save();
    renderHeader();
    // A background redraw keeps the time field focused and as typed.
    inBackground(renderToday);
    return;
  } else if (field === 'label') a.label = value.trim().slice(0, 60);
  else if (field === 'device') a.device = value;
  save();
  renderAll();
}
function deleteAlarm(id) {
  withUndo('Alarm deleted', () => {
    S.alarms = S.alarms.filter(x => x.id !== id);
    save();
    renderAll();
  });
}
function dismissAlarm(id) {
  const a = S.alarms.find(x => x.id === id);
  if (!a) return;
  a.done = a.day || today();
  a.snooze = 0;
  save();
  renderAll();
}
// Clear shown notifications for alarms that are dismissed or off (here or on another device):
// they stay on screen until tapped otherwise.
// Also clears this device's pushed copy while the full-screen card is ringing here.
let closeKey = '',
  closeAt = 0;
function closeAlarmNotes(ringingHere) {
  if (!navigator.serviceWorker) return;
  const live = new Set(S.alarms.filter(alarmLive).map(a => a.id)),
    here = new Set(document.hidden ? [] : ringingHere.map(a => a.id)),
    key = [...live].join() + '|' + [...here].join();
  // Every second while ringing here (a push arriving over the full-screen alarm is cleared at
  // once), otherwise on changes or every 20 s.
  if (key === closeKey && !here.size && Date.now() - closeAt < 20000) return;
  closeKey = key;
  closeAt = Date.now();
  navigator.serviceWorker
    .getRegistration()
    .then(r => r && r.getNotifications())
    .then(ns =>
      (ns || []).forEach(n => {
        const m = /^alarm:(.+)$/.exec(n.tag || '');
        if (m && (!live.has(m[1]) || here.has(m[1]))) n.close();
      }),
    )
    .catch(() => {});
}
function snoozeAlarm(id) {
  const a = S.alarms.find(x => x.id === id);
  if (!a) return;
  a.snooze = Date.now() + 5 * 60000;
  save();
  renderAll();
}

// The alarm list, on Today. alarmsOpen is set by tapping its heading (null: follow whether
// any alarm is on).
let alarmsOpen = null,
  alarmsOnSeen = -1;
function toggleAlarmsList(det) {
  alarmsOpen = !det.open;
}
function renderAlarms() {
  const on = S.alarms.filter(alarmOn).length,
    devs = S.devices.length > 1 ? S.devices : [];
  // Open while an alarm is on, unless folded by hand (until the number switched on changes).
  if (on !== alarmsOnSeen) {
    // One more switched on: show the list. One fewer: leave it as it is (not folding it under
    // the finger that just switched an alarm off).
    if (on > alarmsOnSeen) alarmsOpen = null;
    else if (alarmsOpen === null) alarmsOpen = alarmsOnSeen > 0;
    alarmsOnSeen = on;
  }
  let h = `<details id="alarmd" class="alarms"${(alarmsOpen ?? on > 0) ? ' open' : ''}><summary>Alarms${on ? ` <small>(${on} on)</small>` : ''}</summary>`;
  [...S.alarms]
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    .forEach(a => {
      const live = alarmOn(a),
        state = !live ? '' : alarmDone(a) ? 'Done' : a.snooze ? 'Snoozed' : '';
      // Ids let a background redraw (sync) keep the field being edited.
      h += `<div class="arow${live ? ' on' : ''}"><input class="fld atime" type="time" id="atime-${a.id}" data-atime="${a.id}" value="${a.time}" aria-label="Alarm time"><input class="fld" id="alabel-${a.id}" data-alabel="${a.id}" value="${esc(a.label || '')}" maxlength="60" placeholder="Label" aria-label="Alarm label">`;
      if (devs.length)
        h += `<select class="fld" data-adev="${a.id}" aria-label="Device"><option value="">Any device</option>${devs
          .map(
            d =>
              `<option value="${d.id}"${alarmTarget(a) === d.id ? ' selected' : ''}>${esc(d.name)}${d.endpoint ? '' : ' (no notifications)'}</option>`,
          )
          .join('')}</select>`;
      h += `<button class="chip" data-aon="${a.id}" aria-pressed="${live}">${live ? state || 'On' : 'Off'}</button><button class="x" data-adel="${a.id}" aria-label="Delete alarm ${a.time}">×</button>`;
      const dev = alarmTarget(a) && S.devices.find(d => d.id === a.device);
      if (dev && alarmEndpoint(a) === null)
        h += `<p class="hint awarn">${dev ? esc(dev.name) + ' has' : 'That device has'} no notifications turned on, so this only rings while the app is open there.</p>`;
      h += '</div>';
    });
  return (
    h +
    '<button class="btn sm" id="alarmadd">+ Alarm</button><p class="hint">Alarms are for today: they switch off overnight and stay here to switch on again.</p></details>'
  );
}
// The next alarm to go off today, for the header.
function nextAlarm() {
  const now = Date.now();
  return S.alarms
    .filter(a => alarmLive(a) && alarmAt(a) > now && ringsHere(a))
    .sort((a, b) => alarmAt(a) - alarmAt(b))[0];
}

// Browsers only allow sound after a tap: start (or resume) the audio on the first one, so an
// alarm later on can be heard.
['pointerdown', 'keydown'].forEach(ev =>
  document.addEventListener(
    ev,
    () => {
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
      } catch (e) {}
    },
    { capture: true, passive: true },
  ),
);
// Ringing: a full-screen card with Dismiss and Snooze, sounding until dismissed.
let ringIds = '';
// Show or hide the ringing card to match; straight after Dismiss or Snooze too, not a second later.
function syncRinging() {
  const r = ringing(),
    ids = r.map(a => [a.id, a.time, a.label, a.snooze].join('|')).join(',');
  if (ids !== ringIds) {
    ringIds = ids;
    renderRinging(r);
    renderHeader(); // the next-alarm pill moves on
  }
  closeAlarmNotes(r);
  return r;
}
function alarmTick() {
  // Nothing on and nothing showing: nothing to do (changes come through renderAll anyway).
  if (!ringIds && !S.alarms.some(alarmLive)) return;
  const r = syncRinging();
  if (!r.length) return;
  try {
    if (ac && ac.state === 'suspended') ac.resume();
  } catch (e) {}
  beep([988, 784, 988, 784]);
  try {
    navigator.vibrate && navigator.vibrate([400, 200, 400]);
  } catch (e) {}
}
function renderRinging(r) {
  const el = $('#v-alarm');
  el.hidden = !r.length;
  document.body.classList.toggle('ringing', !!r.length);
  el.innerHTML = r
    .map(
      a =>
        `<div class="ring box"><p class="ringtime">${a.time}</p><p class="ringlabel">${esc(a.label || 'Alarm')}</p><div class="acts"><button class="btn green big" data-adismiss="${a.id}">Dismiss</button><button class="btn big" data-asnooze="${a.id}">Snooze 5 min</button></div></div>`,
    )
    .join('');
}
