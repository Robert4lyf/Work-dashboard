/* desktop: on wide screens quests can be dragged within Today to reorder them. Today, Inbox
   and Focus are separate pages, as on a phone. */
const wideMQ = matchMedia('(min-width: 1100px)');
const dragAttr = key => (wideMQ.matches ? ` draggable="true" data-drag="${key}"` : '');

function moveToInbox(id) {
  const r = find(id);
  if (!r) return;
  const bf = snapshot();
  r.arr.splice(r.arr.indexOf(r.n), 1);
  delete r.n.since; // it starts afresh if it comes back to Today
  delete r.n.kept;
  S.inbox.unshift({ id: uid(), text: r.n.text, node: r.n, tag: r.n.tag, project: r.n.project });
  settle(bf);
  toast('Moved to inbox');
}

let dragging = null;
// Where a drop would land for the current drag, or null if it can't land here.
function dropZone(target, y) {
  if (!dragging || !target.closest) return null;
  const id = dragging.slice(2),
    rowEl = target.closest('#v-today [data-drag^="q:"]');
  if (!rowEl) return null;
  const other = find(rowEl.dataset.drag.slice(2)),
    me = find(id);
  // Reordering only within the same list.
  if (!me || me.arr !== other.arr || me.n === other.n) return null;
  const box = rowEl.getBoundingClientRect();
  return { id, rowEl, other, after: y > box.top + box.height / 2 };
}
function clearDrop() {
  document.querySelectorAll('.dropping').forEach(x => x.classList.remove('dropping'));
}
document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('[data-drag]');
  if (!el) return;
  dragging = el.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragging);
});
document.addEventListener('dragend', () => {
  dragging = null;
  clearDrop();
});
document.addEventListener('dragover', e => {
  const z = dropZone(e.target, e.clientY);
  clearDrop();
  if (!z) return;
  e.preventDefault();
  z.rowEl.classList.add('dropping');
});
document.addEventListener('drop', e => {
  const z = dropZone(e.target, e.clientY);
  clearDrop();
  dragging = null;
  if (!z) return;
  e.preventDefault();
  const bf = snapshot(),
    { arr, n } = find(z.id);
  arr.splice(arr.indexOf(n), 1);
  const at = z.other ? arr.indexOf(z.other.n) + (z.after ? 1 : 0) : arr.length;
  arr.splice(at, 0, n);
  settle(bf);
});
wideMQ.addEventListener('change', () => {
  renderAll();
  go(view);
});
