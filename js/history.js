/* done log */
// Interruptions in the last 7 days: how many, what they were, and when they tend to come.
function renderInterrupts() {
  const since = Date.now() - 7 * 864e5,
    xs = S.interrupts.filter(x => x.t > since);
  if (!xs.length) return '';
  const why = {},
    hour = {};
  xs.forEach(x => {
    const k = x.why || 'Not noted';
    why[k] = (why[k] || 0) + 1;
    const hr = new Date(x.t).getHours();
    hour[hr] = (hour[hr] || 0) + 1;
  });
  const focus = S.sessions.filter(x => x.t > since).reduce((a, x) => a + x.mins, 0),
    peak = Object.keys(hour).sort((a, b) => hour[b] - hour[a])[0],
    rows = Object.keys(why)
      .sort((a, b) => why[b] - why[a])
      .slice(0, 5),
    max = why[rows[0]];
  let h = `<div class="bars box" style="margin:0 0 22px"><h2>Interruptions, last 7 days: ${xs.length}</h2><p class="hint" style="margin:0 0 6px">${focus >= 30 ? `About ${(xs.length / (focus / 60)).toFixed(1)} per focus hour. ` : ''}Most often ${pad(peak)}:00–${pad((+peak + 1) % 24)}:00.</p>`;
  rows.forEach(
    k =>
      (h += `<div class="bar"><span>${esc(k)}</span><div class="track"><div style="width:${(why[k] / max) * 100}%;background:var(--pink)"></div></div><span>${why[k]}</span></div>`),
  );
  return h + '</div>';
}
function logDays(since) {
  return [...new Set(S.log.filter(x => x.d >= since).map(x => x.d))].sort().reverse();
}
function logText() {
  return logDays(shift(today(), -6))
    .map(
      d =>
        dayLabel(d) +
        '\n' +
        S.log
          .filter(x => x.d === d)
          .map(x => '- ' + [...x.trail, x.text].join(' / '))
          .join('\n'),
    )
    .join('\n\n');
}
function renderLog() {
  let h =
    '<h2>History</h2>' + renderStats() + renderInterrupts() + renderProjects(shift(today(), -(range - 1)));
  const days = logDays(shift(today(), -13));
  h +=
    '<div class="sechead"><h2>Done</h2>' +
    (days.length ? '<button class="linkbtn" id="copylog">Copy last 7 days</button>' : '') +
    '</div>';
  if (!days.length) {
    h += '<div class="empty">Nothing finished yet.</div>';
    setHTML($('#v-log'), h);
    return;
  }
  days.forEach(d => {
    const f = Object.values(S.daily[d] || {}).reduce((a, b) => a + b, 0);
    h += `<div class="logday box"><h2><span>${dayLabel(d)}</span>${f ? `<small>${hm(f)} focus</small>` : ''}</h2><ul>`;
    S.log
      .filter(x => x.d === d)
      .forEach(
        x =>
          (h += `<li>${esc(x.text)}${x.trail.length ? ` <small>in ${esc(x.trail.join(' / '))}</small>` : ''}</li>`),
      );
    h += '</ul></div>';
  });
  setHTML($('#v-log'), h);
}
function copyLog() {
  const txt = logText();
  if (!txt) {
    toast('Nothing in the last 7 days');
    return;
  }
  const fail = () => toast("Couldn't copy on this device");
  try {
    navigator.clipboard.writeText(txt).then(() => toast('Copied'), fail);
  } catch (e) {
    fail();
  }
}
