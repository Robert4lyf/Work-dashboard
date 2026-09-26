/* inbox */
const expanded = new Set(); // inbox items showing their subquest editor
// An inbox item as a quest, keeping its tag, project and any subquests.
function inboxToNode(it) {
  const n = it.node || fix({ id: uid(), text: it.text });
  n.tag = it.tag || n.tag;
  n.project = it.project || n.project;
  return n;
}
function renderInbox() {
  let h = '<h2>Inbox</h2>';
  h += `<form class="addrow" id="iform"><input id="iin" maxlength="600" placeholder="Capture a thought" aria-label="New inbox item" autocomplete="off">${mic ? `<button type="button" class="btn mic${listening ? ' on' : ''}" id="mic" aria-label="${listening ? 'Stop listening' : 'Speak to capture'}" aria-pressed="${listening}">${micIcon}</button>` : ''}<button class="btn pink">Add</button></form>`;
  if (!S.inbox.length) h += '<div class="empty">Inbox empty.</div>';
  S.inbox.forEach(it => {
    const kids = it.node ? it.node.children : [],
      c = it.node ? count(it.node) : 0,
      open = expanded.has(it.id);
    h += `<div class="item box"${dragAttr('i:' + it.id)}><p>${esc(it.text)} ${tagBadge(it.tag)}${projectBadge(it.project)}${c ? `<span class="tag opt">${c} subquest${c === 1 ? '' : 's'}</span>` : ''}<br><button class="linkbtn" data-steps="${it.id}" aria-expanded="${open}">${open ? 'Hide' : 'Details and subquests'}</button></p>`;
    if (open) {
      h += tagPicker('i', it.id, it.tag) + projectPicker('i', it.id, it.project) + laterPicker('i', it.id);
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
    h += `<div class="row" style="padding:0;margin:0"><button class="btn blue" data-promote="${it.id}">Move to today</button><button class="btn green" data-clear="${it.id}">Clear</button></div></div>`;
  });
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
