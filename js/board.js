/* desktop board: on wide screens Today, Inbox and Focus sit side by side, and quests and inbox
   items can be dragged between them (or within Today to reorder). */
const wideMQ = matchMedia('(min-width: 1100px)');
const onBoard = () => wideMQ.matches && ['today', 'inbox', 'focus'].includes(view);
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
  const [kind, id] = dragging.split(':'),
    col = target.closest('#v-today, #v-inbox, #v-focus');
  if (!col) return null;
  if (col.id !== 'v-today') return kind === 'q' ? { col, kind, id } : null;
  const rowEl = target.closest('[data-drag^="q:"]');
  if (!rowEl) return kind === 'i' ? { col, kind, id } : null;
  const other = find(rowEl.dataset.drag.slice(2)),
    me = kind === 'q' && find(id);
  // Reordering only within the same list; inbox items can only land in the top-level list.
  if (kind === 'q' ? !me || me.arr !== other.arr || me.n === other.n : other.parents.length) return null;
  const box = rowEl.getBoundingClientRect();
  return { col, kind, id, rowEl, other, after: y > box.top + box.height / 2 };
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
  (z.rowEl || z.col).classList.add('dropping');
});
document.addEventListener('drop', e => {
  const z = dropZone(e.target, e.clientY);
  clearDrop();
  dragging = null;
  if (!z) return;
  e.preventDefault();
  if (z.col.id === 'v-inbox') return moveToInbox(z.id);
  if (z.col.id === 'v-focus') {
    S.focusQ = z.id;
    save();
    return renderAll();
  }
  const bf = snapshot();
  let n, arr;
  if (z.kind === 'i') {
    const i = S.inbox.findIndex(x => x.id === z.id);
    if (i < 0) return;
    n = inboxToNode(S.inbox.splice(i, 1)[0]);
    arr = S.quests;
  } else {
    const me = find(z.id);
    arr = me.arr;
    n = me.n;
    arr.splice(arr.indexOf(n), 1);
  }
  const at = z.other ? arr.indexOf(z.other.n) + (z.after ? 1 : 0) : arr.length;
  arr.splice(at, 0, n);
  settle(bf);
});
wideMQ.addEventListener('change', () => {
  renderAll();
  go(view);
});
