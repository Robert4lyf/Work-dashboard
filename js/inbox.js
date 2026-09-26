/* inbox */
const expanded = new Set(); // inbox items showing their subquest editor
// An inbox item as a quest, keeping its tag, project, waiting details and any subquests.
function inboxToNode(it) {
  const n = it.node || fix({ id: uid(), text: it.text });
  n.tag = it.tag || n.tag;
  n.project = it.project || n.project;
  if (it.wait) n.wait = it.wait;
  return n;
}
// Inbox item to Today (the Today button, or a swipe left), with Undo.
function promoteInbox(id) {
  const i = S.inbox.findIndex(x => x.id === id);
  if (i < 0) return;
  swiped = null;
  withUndo('Moved to Today', () => {
    const bf = snapshot();
    S.quests.push(inboxToNode(S.inbox[i]));
    S.inbox.splice(i, 1);
    settle(bf);
  });
}
/* swipes on a phone: left sends an item to Today (the tab to the left), right shows quick options */
let swipe = null,
  swiped = null, // the item showing its quick options
  swipeClick = false; // a swipe just ended: the click that follows isn't a tap
const SWIPE = 90;
$('#v-inbox').addEventListener('pointerdown', e => {
  const el = e.target.closest('.item[data-id]');
  swipeClick = false;
  // The title is a button (tap to expand) but still swipes.
  if (!el || e.target.closest('button:not(.ititle), input, select, textarea, form, a')) return;
  swipe = { el, id: el.dataset.id, x: e.clientX, y: e.clientY, dx: 0, on: false, pid: e.pointerId };
});
$('#v-inbox').addEventListener('pointermove', e => {
  const s = swipe;
  if (!s || e.pointerId !== s.pid) return;
  const dx = e.clientX - s.x,
    dy = e.clientY - s.y;
  if (!s.on) {
    if (Math.abs(dy) > 12) return (swipe = null); // scrolling, not swiping
    if (Math.abs(dx) < 12) return;
    s.on = true;
    s.el.classList.add('swiping');
  }
  s.dx = dx;
  s.el.style.transform = `translateX(${dx}px)`;
  s.el.parentElement.dataset.swipe = dx < 0 ? 'today' : 'more';
  s.el.dataset.swipe = dx < -SWIPE ? 'today' : dx > SWIPE ? 'more' : '';
});
function endSwipe() {
  const s = swipe;
  swipe = null;
  if (!s || !s.on) return;
  swipeClick = true;
  s.el.classList.remove('swiping');
  s.el.style.transform = '';
  delete s.el.dataset.swipe;
  delete s.el.parentElement.dataset.swipe;
  if (s.dx < -SWIPE) promoteInbox(s.id);
  else if (s.dx > SWIPE) {
    swiped = s.id;
    renderInbox();
  }
}
$('#v-inbox').addEventListener('pointerup', endSwipe);
$('#v-inbox').addEventListener(
  'click',
  e => {
    if (swipeClick) e.stopPropagation();
    swipeClick = false;
  },
  true,
);
$('#v-inbox').addEventListener('pointercancel', endSwipe);
function renderInbox() {
  let h = '<h2>Inbox</h2>';
  h += `<form class="addrow" id="iform"><input id="iin" maxlength="600" placeholder="Capture a thought" aria-label="New inbox item" autocomplete="off">${mic ? `<button type="button" class="btn mic${listening ? ' on' : ''}" id="mic" aria-label="${listening ? 'Stop listening' : 'Speak to capture'}" aria-pressed="${listening}">${micIcon}</button>` : ''}<button class="btn pink">Add</button></form>`;
  if (!S.inbox.length) h += '<div class="empty">Inbox empty.</div>';
  else h += '<div class="list box">';
  S.inbox.forEach(it => {
    const kids = it.node ? it.node.children : [],
      c = it.node ? count(it.node) : 0,
      open = expanded.has(it.id);
    h += `<div class="item" data-id="${it.id}"${dragAttr('i:' + it.id)}><p><button class="ititle" data-steps="${it.id}" aria-expanded="${open}">${esc(it.text)}<span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button> ${tagBadge(it.tag)}${projectBadge(it.project)}${waitBadge(it)}${c ? `<span class="tag opt">${c} subquest${c === 1 ? '' : 's'}</span>` : ''}</p>`;
    if (open) {
      h +=
        tagPicker('i', it.id, it.tag) +
        projectPicker('i', it.id, it.project) +
        `<label class="f">Waiting on (optional)</label><input class="fld" data-iwait="${it.id}" value="${esc((it.wait && it.wait.who) || '')}" maxlength="60" placeholder="Who you're waiting on" autocomplete="off">` +
        laterPicker('i', it.id);
      if (kids.length) {
        h += '<ul class="subs">';
        kids.forEach(
          k =>
            (h += `<li><span>${esc(k.text)}${k.children.length ? ` <small class="hint">(${count(k)} more)</small>` : ''}</span><button class="x" data-delsub="${it.id}" data-sub="${k.id}" aria-label="Remove ${esc(k.text)}">×</button></li>`),
        );
        h += '</ul>';
      }
      h += `<form class="addrow" data-subfor="${it.id}"><input maxlength="120" placeholder="Add a subquest" aria-label="New subquest for ${esc(it.text)}" autocomplete="off"><button class="btn">Add</button></form>`;
    }
    const chip = (attrs, label) => `<button class="chip" ${attrs}>${label}</button>`;
    h +=
      swiped === it.id
        ? `<div class="iacts quick">${chip(`data-sched="${it.id}" data-kind="i" data-when="${shift(today(), 1)}"`, 'Tomorrow')}${chip(`data-sched="${it.id}" data-kind="i" data-when="${nextMonday()}"`, 'Next week')}${chip(`data-waiton="${it.id}"`, 'Waiting…')}<button class="chip del" data-clear="${it.id}">Clear</button><button class="x" data-unswipe="1" aria-label="Close options">×</button></div></div>`
        : `<div class="iacts"><button class="btn sm blue" data-promote="${it.id}">Today</button><button class="btn sm" data-clear="${it.id}">Clear</button></div></div>`;
  });
  if (S.inbox.length) h += '</div>';
  setHTML($('#v-inbox'), h);
}
// "call Sam next item book dentist" -> two items. Also splits on new lines.
const splitItems = v =>
  v
    .split(/\bnext item\b[,.;:]?|\n/i)
    .map(x => x.trim().replace(/^[,.;:]\s*/, ''))
    .filter(Boolean)
    .map(x => x.slice(0, 200));
function capture(v) {
  const items = splitItems(v);
  if (!items.length) return 0;
  items.reverse().forEach(t => S.inbox.unshift({ id: uid(), text: t[0].toUpperCase() + t.slice(1) }));
  save();
  renderAll();
  beep([880]);
  return items.length;
}

/* share to inbox: Android's Share menu opens index.html?title=…&text=…&url=… */
function receiveShare() {
  const q = new URLSearchParams(location.search);
  if (!['title', 'text', 'url'].some(k => q.has(k))) return;
  history.replaceState(null, '', location.pathname);
  const title = (q.get('title') || '').trim(),
    text = (q.get('text') || '').trim(),
    url = (q.get('url') || '').trim();
  // Apps often repeat the title in the text, or the link in the text; keep each once.
  const parts = [text.startsWith(title) ? '' : title, text, url && !text.includes(url) ? url : ''].filter(
    Boolean,
  );
  if (!parts.length) return;
  const full = parts.join('\n'),
    item = { id: uid(), text: parts.join(' · ').replace(/\s+/g, ' ').slice(0, 200) };
  if (full.length > 200) item.node = fix({ id: uid(), text: item.text, notes: full });
  S.inbox.unshift(item);
  save();
  renderAll();
  go('inbox');
  toast('Added to inbox');
}

/* voice capture: browsers with speech recognition only */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = !!SR;
const micIcon =
  '<svg viewBox="0 0 7 8" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 0h3v5H2zM0 3h1v2H0zM6 3h1v2H6zM1 5h5v1H1zM3 6h1v1H3zM1 7h5v1H1z"/></svg>';
let listening = false,
  rec = null;
function toggleMic() {
  if (listening) {
    rec && rec.stop();
    return;
  }
  let heard = '';
  try {
    rec = new SR();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = true;
    rec.continuous = false;
  } catch (e) {
    toast("Voice isn't available here");
    return;
  }
  rec.onresult = e => {
    heard = [...e.results].map(r => r[0].transcript).join(' ');
    const i = $('#iin');
    if (i) i.value = heard;
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      toast('Microphone blocked. Allow it in browser settings', false, 3000);
    else if (e.error === 'no-speech') toast("Didn't catch that");
    else if (e.error !== 'aborted') toast("Voice didn't work, try again");
  };
  rec.onend = () => {
    listening = false;
    rec = null;
    const n = heard.trim() ? capture(heard) : 0;
    renderInbox();
    if (n) toast(n > 1 ? 'Added ' + n + ' items' : 'Added');
  };
  try {
    rec.start();
    listening = true;
    renderInbox();
  } catch (e) {
    listening = false;
    toast("Voice didn't work, try again");
  }
}
