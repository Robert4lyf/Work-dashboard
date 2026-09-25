/* done log */
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
  let h = '<h2>History</h2>' + renderStats() + renderProjects(shift(today(), -(range - 1)));
  const days = logDays(shift(today(), -13));
  h +=
    '<div class="listbar" style="justify-content:space-between;align-items:center;margin:0 0 8px"><h2 style="margin:0">Done</h2>' +
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
