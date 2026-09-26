/* health check (Settings): tests each part of the setup against the real services and says
   what to fix. Each check gives ok true (working), false (broken) or null (not set up / n/a). */
let health = null, // null: not run; 'running'; or a list of results
  liveStatus = ''; // the live-updates channel's state, from listen()
async function runHealth() {
  health = 'running';
  renderAccount();
  const out = [],
    add = (name, ok, msg, fix) => out.push({ name, ok, msg, fix });
  const q = async fn => {
    try {
      const { data, error } = await fn();
      return error ? { error } : { data };
    } catch (e) {
      return { error: e };
    }
  };
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !sb)
    add('Supabase settings', false, 'Not set up', 'Fill in config.js (README, step 2).');
  else add('Supabase settings', true, 'Found');
  if (!session) add('Signed in', sb ? false : null, 'Not signed in', sb ? 'Sign in above.' : '');
  else {
    add('Signed in', true, session.user.email || 'Yes');
    const items = await q(() => sb.from('cockpit_items').select('key').limit(1));
    add(
      'Sync table',
      !items.error,
      items.error ? 'Missing or unreadable' : 'Readable',
      'Run the updated supabase-setup.sql in the SQL Editor.',
    );
    add(
      'Last sync',
      syncStatus === 'error' ? false : lastSync ? true : null,
      lastSync ? new Date(lastSync).toLocaleString() : 'Not yet',
      'Tap Sync now; if it keeps failing, re-run supabase-setup.sql.',
    );
    add(
      'Live updates',
      liveStatus === 'SUBSCRIBED' ? true : liveStatus ? false : null,
      liveStatus === 'SUBSCRIBED' ? 'Connected' : liveStatus || 'Unknown',
      'In Supabase, Database > Publications > supabase_realtime must include cockpit_items.',
    );
    // Notifications: this device, then whether the server has ever sent one.
    if (!pushSupported()) add('Notifications on this device', null, "This browser can't receive them");
    else
      add(
        'Notifications on this device',
        pushEndpoint && Notification.permission === 'granted' ? true : S.pushKey ? false : null,
        pushEndpoint ? 'On' : S.pushKey ? 'Off' : 'Not set up',
        'Turn them on under Notifications below (allow them when the browser asks).',
      );
    if (S.pushKey) {
      const sent = await q(() =>
        sb
          .from('cockpit_notices')
          .select('sent_at')
          .not('sent_at', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(1),
      );
      const late = await q(() =>
        sb
          .from('cockpit_notices')
          .select('at')
          .is('sent_at', null)
          .lt('at', new Date(Date.now() - 10 * 60e3).toISOString())
          .limit(1),
      );
      const last = !sent.error && sent.data && sent.data[0] && sent.data[0].sent_at;
      add(
        'Notifications from the server',
        sent.error || (late.data && late.data.length) ? false : last ? true : null,
        sent.error
          ? 'Notice table missing'
          : late.data && late.data.length
            ? 'Some are overdue and unsent'
            : last
              ? 'Last sent ' + new Date(last).toLocaleString()
              : 'None sent yet',
        sent.error
          ? 'Run the updated supabase-setup.sql.'
          : 'Check the send-notices function is deployed with its secrets, and that notifications-cron.sql was run (README > Notifications).',
      );
    }
  }
  const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  add('Works offline', sw ? true : false, sw ? 'Yes' : 'Not yet', 'Reload the app once.');
  health = out;
  renderAccount();
}
function renderHealth() {
  let h = '<h2 style="margin-top:26px" id="healthsec">Health check</h2>';
  if (health === 'running') return h + '<p class="hint">Checking…</p>';
  if (!health)
    return (
      h +
      '<p class="hint" style="margin:0 0 8px">Test sync and notifications against your Supabase project.</p><button class="btn" id="healthrun">Run check</button>'
    );
  h += '<div class="list box health">';
  health.forEach(r => {
    const icon = r.ok === true ? '✓' : r.ok === false ? '✗' : '–';
    h += `<div class="hrow2 ${r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'na'}"><span class="hicon" aria-hidden="true">${icon}</span><div><b>${esc(r.name)}</b> <small>${esc(r.msg)}</small>${r.ok === false && r.fix ? `<p>${esc(r.fix)}</p>` : ''}</div></div>`;
  });
  return h + '</div><button class="btn sm" id="healthrun">Run again</button>';
}
