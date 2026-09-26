// Sends the notices that are due. Kept free of imports so it can be tested with Node.
//   db   - Supabase client using the service role key (bypasses row-level security)
//   push - the web-push library, already given the VAPID keys
export async function sendDue({ db, push, now = new Date(), log = console }) {
  const late = new Date(now.getTime() - 6 * 3600e3);
  const { data: due, error } = await db
    .from('cockpit_notices')
    .select('user_id,key,at,title,body')
    .is('sent_at', null)
    .lte('at', now.toISOString())
    .limit(500);
  if (error) throw error;
  if (!due.length) return { sent: 0, skipped: 0, removed: 0 };
  const { data: subs, error: e2 } = await db
    .from('cockpit_push_subs')
    .select('endpoint,user_id,p256dh,auth')
    .in('user_id', [...new Set(due.map(n => n.user_id))]);
  if (e2) throw e2;
  let sent = 0,
    skipped = 0;
  const gone = new Set();
  for (const n of due) {
    // Why a notice didn't go out, kept on the notice so the app's test can show it.
    const errs = [];
    const mine = subs.filter(s => s.user_id === n.user_id && !gone.has(s.endpoint));
    // Anything more than 6 hours overdue (say the job was paused) is marked done unsent.
    if (new Date(n.at) < late) skipped++;
    else if (!mine.length) errs.push('no devices have notifications turned on');
    else
      for (const s of mine) {
        try {
          await push.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: n.title, body: n.body, tag: n.key }),
            { TTL: 3600 },
          );
          sent++;
        } catch (err) {
          // 404/410: the device unsubscribed or the app was removed; forget it.
          if (err.statusCode === 404 || err.statusCode === 410) gone.add(s.endpoint);
          else {
            log.warn('push failed', err.statusCode || err.message);
            errs.push(
              err.statusCode === 401 || err.statusCode === 403
                ? `push service refused (${err.statusCode}): the VAPID keys in the function's secrets don't match this device's`
                : `push failed: ${err.statusCode || err.message}`,
            );
          }
        }
      }
    const mark = v => db.from('cockpit_notices').update(v).eq('user_id', n.user_id).eq('key', n.key);
    let { error: e3 } = await mark({ sent_at: now.toISOString(), error: errs.join('; ') || null });
    // The error column is newer than the table; without it, still mark the notice sent.
    if (e3) ({ error: e3 } = await mark({ sent_at: now.toISOString() }));
    if (e3) throw e3;
  }
  if (gone.size)
    await db
      .from('cockpit_push_subs')
      .delete()
      .in('endpoint', [...gone]);
  return { sent, skipped, removed: gone.size };
}
