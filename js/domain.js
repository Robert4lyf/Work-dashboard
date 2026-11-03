/* domain events (Release C): the places where work changes state say so here, once, with a key
   that names the change the same on every device (a quest finished on a day, a flow's report by
   its row id, a run's outcome). Rules listen (see rules.js) and workflows advance (see
   workflows.js). Nothing here touches the page: a redraw never makes an event. */
let eventQueue = [],
  eventBusy = false;
function emitEvent(ev) {
  if (!ev || !ev.k || !ev.key) return;
  eventQueue.push(ev);
  if (eventBusy) return; // (handled after the one under way: no re-entry)
  eventBusy = true;
  try {
    while (eventQueue.length) {
      const e = eventQueue.shift();
      try {
        onWorkflowEvent(e);
      } catch (x) {
        console.warn('workflow event', e.k, x);
      }
      try {
        onRuleEvent(e);
      } catch (x) {
        console.warn('rule event', e.k, x);
      }
    }
  } finally {
    eventBusy = false;
  }
}
// A short, stable id from a key (for records two devices must name the same).
function keyId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
// Minutes as "1h 30m" / "45m" (as hm, but 0 reads as none).
const hmOr = (m, none = '') => (m > 0 ? hm(m) : none);
