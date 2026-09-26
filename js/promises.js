/* promises: what you've promised people ("I owe") and what people owe you ("Waiting for").
   Each is { id, dir: 'owe' | 'wait', what, who, due, done (the day it was closed), t }. */
let pdir = 'owe';
const PROMISE_LISTS = [
  ['owe', 'I owe', 'for'],
  ['wait', 'Waiting for', 'from'],
];
const promiseDue = p => dueTag({ due: p.due || '', done: false, children: [] });
// Open promises due today or earlier, for the header.
const promisesDue = () => S.promises.filter(p => !p.done && p.due && p.due <= today()).length;
function promiseText(p) {
  const who = p.who ? ` (${p.dir === 'owe' ? 'for' : 'from'} ${p.who})` : '';
  return (p.dir === 'owe' ? '' : 'Got: ') + p.what + who;
}
function renderPromises() {
  const people = [...new Set(S.promises.map(p => p.who).filter(Boolean))];
  let h = `<h2>Promises</h2><form class="pform box" id="pform"><div class="chips">${PROMISE_LISTS.map(([k, l]) => `<button type="button" class="chip" data-pdir="${k}" aria-pressed="${pdir === k}">${l}</button>`).join('')}</div>
    <input class="fld" id="pwhat" maxlength="120" placeholder="${pdir === 'owe' ? 'What you promised' : 'What you’re waiting for'}" aria-label="What" autocomplete="off">
    <div class="prow2"><input class="fld" id="pwho" maxlength="60" placeholder="${pdir === 'owe' ? 'For whom' : 'From whom'}" aria-label="Who" list="pwholist" autocomplete="off"><input class="fld" type="date" id="pdue" aria-label="By when (optional)"></div>
    <datalist id="pwholist">${people.map(w => `<option value="${esc(w)}">`).join('')}</datalist>
    <button class="btn">Add</button></form>`;
  PROMISE_LISTS.forEach(([k, label, rel]) => {
    const open = S.promises
      .filter(p => p.dir === k && !p.done)
      .sort((a, b) =>
        (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : a.t - b.t,
      );
    h += `<div class="sechead"><h2>${label}</h2></div>`;
    if (!open.length) {
      h += '<div class="empty">Nothing here.</div>';
      return;
    }
    h += '<div class="list box">';
    open.forEach(p => {
      const meta = (p.who ? `${rel} ${esc(p.who)} ` : '') + promiseDue(p);
      h += `<div class="row"><button class="check" data-pdone="${p.id}" aria-label="Done: ${esc(p.what)}">${tick}</button><div class="open"><span>${esc(p.what)}</span>${meta ? `<small>${meta}</small>` : ''}</div><button class="x" data-pdel="${p.id}" aria-label="Delete ${esc(p.what)}">×</button></div>`;
    });
    h += '</div>';
  });
  const done = S.promises.filter(p => p.done).sort((a, b) => (a.done < b.done ? 1 : -1));
  if (done.length) {
    h += `<details id="pdoned"${panels.pdoned ? ' open' : ''}><summary>Done lately (${done.length})</summary><div class="list box">`;
    done.forEach(
      p =>
        (h += `<div class="row done"><button class="check" data-pdone="${p.id}" aria-pressed="true" aria-label="Not done: ${esc(p.what)}">${tick}</button><div class="open"><span>${esc(promiseText(p))}</span><small>${dayLabel(p.done)}</small></div></div>`),
    );
    h += '</div></details>';
  }
  const el = $('#v-promises');
  el.querySelectorAll('details[id]').forEach(d => (panels[d.id] = d.open));
  setHTML(el, h);
}
function addPromise() {
  const what = $('#pwhat').value.trim();
  if (!what) return;
  S.promises.push({
    id: uid(),
    dir: pdir,
    what,
    who: $('#pwho').value.trim(),
    due: $('#pdue').value || '',
    done: '',
    t: Date.now(),
  });
  save();
  renderAll();
  $('#pwhat').focus();
}
// Closing a promise also goes in History, so kept promises count as work done.
function togglePromise(id) {
  const p = S.promises.find(x => x.id === id);
  if (!p) return;
  const key = 'p-' + p.id;
  if (p.done) {
    S.log = S.log.filter(x => !(x.id === key && x.d === p.done));
    p.done = '';
  } else {
    p.done = today();
    S.log.push({ id: key, d: today(), text: promiseText(p), trail: [], p: '' });
  }
  save();
  renderAll();
}
