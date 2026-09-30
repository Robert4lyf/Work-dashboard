/* inbox */
const expanded = new Set(); // inbox items showing their subquest editor
// An inbox item as a quest, keeping its tag, waiting details (as a step) and any subquests.
function inboxToNode(it) {
  const n = it.node || fix({ id: uid(), text: it.text });
  n.tag = it.tag || n.tag;
  n.project = it.project || n.project;
  // The item's waiting details are the ones that count ("Got it" in the Inbox clears only those).
  delete n.wait;
  if (it.wait) {
    n.wait = it.wait;
    waitToStep(n); // (as a quest, the waiting is a step's)
  }
  return n;
}
// Inbox item to Today (its Today button), with Undo.
function promoteInbox(id) {
  const i = S.inbox.findIndex(x => x.id === id);
  if (i < 0) return;
  withUndo('Moved to Today', () => {
    const bf = snapshot();
    S.quests.push(inboxToNode(S.inbox[i]));
    S.inbox.splice(i, 1);
    settle(bf);
  });
}
// Clear an inbox item (its Clear button), with Undo.
function clearInbox(id) {
  withUndo('Cleared', () => {
    S.inbox = S.inbox.filter(x => x.id !== id);
    addXP(5);
    save();
    renderAll();
  });
}
function renderInbox() {
  let h = '<h2>Inbox</h2>';
  h += `<form class="addrow" id="iform"><input id="iin" maxlength="600" placeholder="Capture a thought" aria-label="New inbox item" autocomplete="off">${mic ? `<button type="button" class="btn mic${listening ? ' on' : ''}" id="mic" aria-label="${listening ? 'Stop listening' : 'Speak to capture'}" aria-pressed="${listening}">${micIcon}</button>` : ''}<button class="btn pink">Add</button></form>`;
  if (!S.inbox.length)
    h +=
      '<div class="empty">Nothing captured. Type a thought above (or say it with the mic); sort it into Today later.</div>';
  else h += '<div class="list box">';
  S.inbox.forEach(it => {
    const kids = it.node ? it.node.children : [],
      c = it.node ? count(it.node) : 0,
      open = expanded.has(it.id);
    h += `<div class="item" data-id="${it.id}"><p><button class="ititle" data-steps="${it.id}" aria-expanded="${open}">${esc(it.text)}<span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button> ${tagBadge(it.tag)}${waitBadge(it)}${it.node ? stepWaitBadge(it.node) : ''}${c ? `<span class="tag opt">${c} subquest${c === 1 ? '' : 's'}</span>` : ''}</p>`;
    if (open) {
      // Its subquests, added here before it goes to Today (they move with it).
      if (kids.length) {
        h += '<ul class="subs">';
        kids.forEach(
          k =>
            (h += `<li><span>${esc(k.text)}</span><button class="x" data-delsub="${it.id}" data-sub="${k.id}" aria-label="Remove ${esc(k.text)}">×</button></li>`),
        );
        h += '</ul>';
      }
      h += `<form class="addrow" data-subfor="${it.id}"><input id="is-${it.id}" data-keep maxlength="120" placeholder="Add a subquest" aria-label="New subquest for ${esc(it.text)}" autocomplete="off"><button class="btn">Add</button></form>`;
      // Then waiting.
      h += `<label class="f" for="iwait-${it.id}">Waiting on (optional)</label><input class="fld" id="iwait-${it.id}" data-iwait="${it.id}" value="${esc((it.wait && it.wait.who) || '')}" maxlength="60" placeholder="Who you're waiting on" autocomplete="off">`;
    }
    h += `<div class="iacts"><button class="btn sm blue" data-promote="${it.id}">Today</button><button class="btn sm" data-clear="${it.id}">Clear</button></div></div>`;
  });
  if (S.inbox.length) h += '</div>';
  setHTML($('#v-inbox'), h);
}
// "call Sam next item book dentist" -> two items. Also splits on new lines.
const splitItems = v =>
  v
    .split(/\bnext item\b[,.;:]?|\n/i)
    .map(x => x.trim().replace(/^[,.;:]\s*/, ''))
    .filter(Boolean);
function capture(v) {
  const items = splitItems(v);
  if (!items.length) return 0;
  items.reverse().forEach(full => {
    // Capitalised, unless it starts with a web address (or has nothing to capitalise).
    const t = /^[a-z][\w+.-]*:\/\//i.test(full) ? full : full[0].toUpperCase() + full.slice(1),
      it = { id: uid(), text: t.slice(0, 200) };
    if (t.length > 200) it.node = fix({ id: uid(), text: it.text, notes: t }); // the rest in the notes
    S.inbox.unshift(it);
  });
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
  if (!focusLocked()) go('inbox'); // (mid-session, single-task mode stays: the toast says)
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
