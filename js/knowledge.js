/* the Knowledge tab: articles (guides, who's who, links) filed in categories and sub-categories,
   plus Flows: buttons that run Power Automate Desktop flows on this computer. */
let kbArt = null, // the article being read
  kbEdit = null, // the article being written: { id (none for a new one), cat }
  kbQuery = '', // what's typed in the search box
  kbMoving = null, // the category being moved (its "Move to" choice is showing)
  kbImgShown = null; // an article's picture shown full size
const byName = (a, b) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
// A flow's Run URL (Power Automate Desktop: the flow's Properties > Details). Only that kind of
// link: a synced row mustn't be able to put any other link behind a button.
const FLOW_URL = /^ms-powerautomate:\/[^\s"'<>`]*$/i;
// When something happened, as "Today 09:14" or "Mon 28 Sep 17:02".
const whenLabel = ms => {
  const d = new Date(ms);
  return dayLabel(fmt(d)) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
};
const KB_BODY = 50000, // characters in an article
  KB_IMGS = 30; // pictures in an article
const okText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// Called from norm: keep only well-formed categories, articles and flows.
function normKnowledge() {
  const ok = x => x && typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id);
  S.kbcats = (Array.isArray(S.kbcats) ? S.kbcats : [])
    .filter(ok)
    .map(c => ({ id: c.id, name: okText(c.name, 80) || 'Untitled', parent: okText(c.parent, 40) }));
  const ids = new Set(S.kbcats.map(c => c.id));
  // A parent that's gone, or a loop (two devices each filing one under the other): top level.
  S.kbcats.forEach(c => {
    if (c.parent && !ids.has(c.parent)) c.parent = '';
  });
  S.kbcats.forEach(c => {
    for (let p = c.parent, n = 0; p; n++) {
      if (p === c.id || n > 50) {
        c.parent = '';
        break;
      }
      p = (S.kbcats.find(x => x.id === p) || {}).parent;
    }
  });
  S.kb = (Array.isArray(S.kb) ? S.kb : []).filter(ok).map(a => ({
    id: a.id,
    cat: okText(a.cat, 40),
    title: okText(a.title, 200) || 'Untitled',
    body: okText(a.body, KB_BODY),
    edited: typeof a.edited === 'number' ? a.edited : 0,
    imgs: (Array.isArray(a.imgs) ? a.imgs : [])
      // (no cap here: two devices adding at once can go past it, and dropping the extras here
      // would delete them everywhere; the editor stops adding past KB_IMGS)
      .filter(m => ok(m) && okImg(m.src))
      .map((m, i) => ({ id: m.id, src: m.src, at: Number(m.at) || i + 1 })),
  }));
  S.flows = (Array.isArray(S.flows) ? S.flows : [])
    .filter(f => ok(f) && typeof f.url === 'string' && FLOW_URL.test(f.url))
    .map(f => ({
      id: f.id,
      name: okText(f.name, 60) || 'Flow',
      url: f.url,
      // (a time that can't be right, say from a device with its clock wrong, isn't shown)
      last: Number.isFinite(+f.last) && f.last > 0 && f.last < Date.now() + 864e5 ? +f.last : 0,
    }));
}
const kbCat = id => S.kbcats.find(c => c.id === id);
const kbKids = id => S.kbcats.filter(c => c.parent === id).sort((a, b) => byName(a.name, b.name));
const kbArts = id => S.kb.filter(a => a.cat === id).sort((a, b) => byName(a.title, b.title));
// Articles whose category went (deleted on another device while one was added here).
const kbLost = () => S.kb.filter(a => !kbCat(a.cat)).sort((a, b) => byName(a.title, b.title));
function kbTrail(id) {
  const t = [];
  for (let c = kbCat(id), n = 0; c && n < 50; c = kbCat(c.parent), n++) t.unshift(c.name);
  return t;
}
// Everything filed under a category, sub-categories included.
function kbCount(id) {
  return kbArts(id).length + kbKids(id).reduce((s, c) => s + kbCount(c.id), 0);
}
function kbCatIds(id) {
  return [id, ...kbKids(id).flatMap(c => kbCatIds(c.id))];
}
// Text as written, with web links made clickable. Links are found in the text itself (before
// escaping), so an & or a quote in one stays part of it; punctuation just after one isn't taken
// in, except a closing bracket that one of its own opened (as in Wikipedia's).
function kbLinkify(s) {
  let out = '',
    at = 0;
  for (const m of s.matchAll(/\bhttps?:\/\/[^\s<>"]+/g)) {
    let u = m[0];
    for (;;) {
      const last = u.slice(-1);
      if (/[.,;:!?'*]/.test(last)) u = u.slice(0, -1);
      else if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length)
        u = u.slice(0, -1);
      else if (last === ']' && (u.match(/\[/g) || []).length < (u.match(/\]/g) || []).length)
        u = u.slice(0, -1);
      else break;
    }
    out +=
      esc(s.slice(at, m.index)) +
      `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
    at = m.index + u.length;
  }
  return out + esc(s.slice(at));
}

function renderKnowledge() {
  // A background redraw (a sync, coming back to the app) leaves an article being written alone:
  // redrawing it would lose the scroll position, and on a phone break a word being typed.
  if (background && kbEdit && $('#kbform')) return;
  // What's typed in the editor is the draft: a redraw (a tick elsewhere, undo) shows it, not the
  // saved article.
  if (kbEdit && $('#kbform')) {
    kbEdit.title = $('#kbt').value;
    kbEdit.body = $('#kbb').value;
    kbEdit.cat = $('#kbc').value;
  }
  let h;
  if (kbEdit) h = kbEditor();
  else if (kbArt && S.kb.some(a => a.id === kbArt)) h = kbArticle(S.kb.find(a => a.id === kbArt));
  else {
    kbArt = null;
    h = kbFlows() + kbIndex();
  }
  setHTML($('#v-knowledge'), h);
}
function kbFlows() {
  const flows = [...S.flows].sort((a, b) => byName(a.name, b.name));
  let h = `<h2>Flows</h2>${
    flows.length
      ? `<div class="flows">${flows.map(f => `<div class="flow"><a class="btn blue" href="${esc(f.url)}" data-flow="${f.id}">${esc(f.name)}</a><small>${f.last ? 'Last used ' + whenLabel(f.last) : 'Not used yet'}</small></div>`).join('')}</div>`
      : '<p class="hint">Buttons that run your Power Automate Desktop flows on this computer.</p>'
  }`;
  h += `<details id="kbflows"${panels.kbflows || !flows.length ? ' open' : ''}${flows.length ? '' : ' data-held="1"'}><summary>${flows.length ? 'Manage flows' : 'Add a flow'}</summary>`;
  flows.forEach(
    f =>
      (h += `<div class="tagrow"><input class="fld" data-flowname="${f.id}" value="${esc(f.name)}" maxlength="60" aria-label="Flow name"><button class="x" data-delflow="${f.id}" aria-label="Delete flow ${esc(f.name)}">×</button></div>`),
  );
  h += `<form id="flowform"><label class="f" for="flowname">Button name</label><input class="fld" id="flowname" maxlength="60" autocomplete="off" required>
    <label class="f" for="flowurl">Run URL</label><input class="fld" id="flowurl" placeholder="ms-powerautomate:/console/flow/run?..." autocomplete="off" required>
    <div class="acts"><button class="btn">Add flow</button></div></form>
    <p class="hint kbhint">In Power Automate Desktop, open the flow's Properties, then Details, and copy its Run URL. The buttons work on a computer with Power Automate Desktop installed; it may ask you to confirm each run.</p></details>`;
  return h;
}
function kbIndex() {
  let h = `<h2 class="kbhead">Knowledge</h2><input class="fld" type="search" id="kbq" placeholder="Search articles" aria-label="Search articles" autocomplete="off" value="${esc(kbQuery)}"><div id="kbres">${kbResults()}</div>`;
  h += `<div id="kbtree"${kbQuery.trim() ? ' hidden' : ''}>`;
  const top = kbKids('');
  h += top.length
    ? top.map(kbCatTree).join('')
    : '<p class="hint">No categories yet. Add one below, then add articles to it.</p>';
  const lost = kbLost();
  if (lost.length)
    h += `<details id="kc-lost" class="kcat"${panels['kc-lost'] ? ' open' : ''}><summary>Uncategorised <small>${lost.length}</small></summary><div class="kbody">${lost.map(kbRow).join('')}</div></details>`;
  h +=
    '<form class="addrow kbadd" id="kbcatform"><input id="kbcatin" maxlength="80" placeholder="New category" aria-label="New category" autocomplete="off"><button class="btn">Add</button></form></div>';
  return h;
}
const kbRow = a => `<button class="soonrow kbrow" data-kbart="${a.id}"><span>${esc(a.title)}</span></button>`;
function kbCatTree(c) {
  const kids = kbKids(c.id),
    arts = kbArts(c.id),
    id = 'kc-' + c.id;
  return `<details id="${id}" class="kcat"${panels[id] ? ' open' : ''}><summary>${esc(c.name)} <small>${kbCount(c.id)}</small></summary><div class="kbody">
    ${kids.map(kbCatTree).join('')}${arts.map(kbRow).join('')}${!kids.length && !arts.length ? '<p class="hint kbempty">Empty.</p>' : ''}
    ${kbMoving === c.id ? kbMovePanel(c) : ''}<div class="links"><button class="linkbtn" data-kbnew="${c.id}">+ Article</button><button class="linkbtn" data-kbsub="${c.id}">+ Sub-category</button><button class="linkbtn" data-kbren="${c.id}">Rename</button><button class="linkbtn" data-kbmove="${c.id}">Move</button><button class="dellink" data-kbdelcat="${c.id}">Delete</button></div></div></details>`;
}
// Where a category can go: the top level, or into any category that isn't itself or inside it.
function kbMovePanel(c) {
  const inside = new Set(kbCatIds(c.id));
  return `<div class="kbmove box"><label class="f" for="kbmv">Move “${esc(c.name)}” into</label><select class="fld" id="kbmv"><option value=""${c.parent ? '' : ' selected'}>Top level</option>${kbCatOptions(c.parent, inside)}</select><div class="acts"><button class="btn sm blue" data-kbmvgo="${c.id}">Move</button><button class="btn sm" data-kbmvcancel="1">Cancel</button></div></div>`;
}
function kbResults() {
  const q = kbQuery.trim().toLowerCase();
  if (!q) return '';
  const hits = S.kb
    .filter(a => (a.title + '\n' + a.body + '\n' + kbTrail(a.cat).join(' ')).toLowerCase().includes(q))
    .sort((a, b) => byName(a.title, b.title));
  if (!hits.length) return '<p class="hint">No articles match.</p>';
  return hits
    .map(
      a =>
        `<button class="soonrow kbrow" data-kbart="${a.id}"><span>${esc(a.title)}<br><small class="hint">${esc(kbTrail(a.cat).join(' › ') || 'Uncategorised')}</small></span></button>`,
    )
    .join('');
}
function kbArticle(a) {
  const trail = kbTrail(a.cat);
  return `<button class="linkbtn" data-kbback="1">‹ Knowledge</button>
    <p class="hint kbtrail">${esc(trail.join(' › ') || 'Uncategorised')}</p>
    <h2 class="kbtitle">${esc(a.title)}</h2>
    <div class="kbtext box">${a.body ? kbLinkify(a.body) : a.imgs.length ? '' : '<span class="hint">Nothing written yet.</span>'}</div>
    ${kbImgGrid(a.imgs, false)}${kbImgFull(a.imgs)}
    <div class="acts"><button class="btn blue" data-kbedit="${a.id}">Edit</button><button class="btn" data-kbdel="${a.id}">Delete</button></div>`;
}
// An article's pictures as thumbnails: tap one for full size (reading), or remove it (editing).
function kbImgGrid(imgs, editing) {
  if (!imgs.length) return '';
  return `<div class="nimgs kbimgs">${imgs
    .map((m, i) =>
      editing
        ? `<div class="nimg"><span class="nimgopen"><img src="${m.src}" alt="Picture ${i + 1}"></span><button class="dellink" data-kbimgdel="${m.id}" aria-label="Remove picture ${i + 1}">Remove</button></div>`
        : `<div class="nimg"><button class="nimgopen" data-kbimg="${m.id}" aria-label="Show picture ${i + 1} full size"><img src="${m.src}" alt="Picture ${i + 1}"></button></div>`,
    )
    .join('')}</div>`;
}
function kbImgFull(imgs) {
  const m = kbImgShown && imgs.find(x => x.id === kbImgShown);
  if (!m) return ((kbImgShown = null), '');
  return `<div class="nimgfull" role="dialog" aria-label="Picture"><button class="nimgclose" data-kbimgclose="1" aria-label="Close"><img src="${m.src}" alt="Picture, full size"></button><div class="acts"><button class="btn" data-kbimgclose="1">Close</button></div></div>`;
}
// Every category, as a path, for the article's "Category" choice (leaving out `skip`).
function kbCatOptions(sel, skip) {
  const out = [];
  (function w(parent, trail) {
    kbKids(parent).forEach(c => {
      if (skip && skip.has(c.id)) return;
      out.push([c.id, [...trail, c.name].join(' › ')]);
      w(c.id, [...trail, c.name]);
    });
  })('', []);
  return out
    .map(([id, name]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');
}
function kbEditor() {
  const a = (kbEdit.id && S.kb.find(x => x.id === kbEdit.id)) || { title: '', body: '', cat: kbEdit.cat };
  if (!kbEdit.imgs) kbEdit.imgs = [...(a.imgs || [])]; // (changed here, kept only on Save)
  if (kbEdit.title === undefined) Object.assign(kbEdit, { title: a.title, body: a.body, cat: a.cat });
  return `<h2>${kbEdit.id ? 'Edit article' : 'New article'}</h2><form id="kbform">
    <label class="f" for="kbt">Title</label><input class="fld" id="kbt" maxlength="200" value="${esc(kbEdit.title)}" autocomplete="off" required>
    <label class="f" for="kbc">Category</label><select class="fld" id="kbc">${kbCatOptions(kbEdit.cat)}</select>
    <label class="f" for="kbb">Article</label><textarea class="fld kbbody" id="kbb" maxlength="${KB_BODY}" placeholder="Steps, contacts, links... Web links become clickable. Paste a screenshot to add it below.">${esc(kbEdit.body)}</textarea>
    <div class="sechead kbimghead"><h2>Pictures</h2><button class="btn sm" type="button" id="kbimgadd">Add picture</button></div><input type="file" id="kbimgfile" accept="image/*" multiple hidden aria-hidden="true"><div id="kbimgs">${kbImgGrid(kbEdit.imgs, true)}</div>
    <div class="acts"><button class="btn green">Save</button><button class="btn" type="button" data-kbcancel="1">Cancel</button></div></form>`;
}

// An article being written is kept on this device when the app is left, and comes back if the
// app was closed before it was saved (or cancelled).
const KB_DRAFT = 'dashboard-kbdraft';
function keepKbDraft() {
  if (!kbEdit || !$('#kbform')) return;
  const d = { ...kbEdit, title: $('#kbt').value, body: $('#kbb').value, cat: $('#kbc').value };
  try {
    localStorage.setItem(KB_DRAFT, JSON.stringify(d));
  } catch (e) {
    try {
      localStorage.setItem(KB_DRAFT, JSON.stringify({ ...d, imgs: undefined })); // (no room: the text)
    } catch (e2) {}
  }
}
function clearKbDraft() {
  try {
    localStorage.removeItem(KB_DRAFT);
  } catch (e) {}
}
function restoreKbDraft() {
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem(KB_DRAFT));
  } catch (e) {}
  if (!d || typeof d !== 'object') return false;
  const okId = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
  kbEdit = {
    id: okId(d.id) ? d.id : undefined,
    cat: okId(d.cat) && kbCat(d.cat) ? d.cat : (kbKids('')[0] || {}).id || '',
    title: String(d.title || ''),
    body: String(d.body || ''),
    imgs: Array.isArray(d.imgs)
      ? d.imgs
          .filter(m => m && okId(m.id) && okImg(m.src))
          .map(m => ({ id: m.id, src: m.src, at: Number(m.at) || 0 }))
      : undefined,
  };
  toast('Your unsaved article is back', false, 3000);
  return true;
}
// Opens the categories above one, so it can be seen.
function kbReveal(cat) {
  for (let c = kbCat(cat), n = 0; c && n < 50; c = kbCat(c.parent), n++) panels['kc-' + c.id] = true;
}
function kbAddCat(name, parent) {
  name = cleanText(name.trim().slice(0, 80));
  if (!name) return;
  const c = { id: uid(), name, parent: parent || '' };
  S.kbcats.push(c);
  kbReveal(parent);
  save();
  renderKnowledge();
}
function kbRename(id) {
  const c = kbCat(id);
  if (!c) return;
  const v = prompt('Rename category', c.name);
  if (!v || !v.trim()) return;
  c.name = cleanText(v.trim().slice(0, 80));
  save();
  renderKnowledge();
}
function kbDeleteCat(id) {
  const c = kbCat(id);
  if (!c) return;
  const ids = new Set(kbCatIds(id));
  withUndo('Deleted ' + c.name, () => {
    S.kbcats = S.kbcats.filter(x => !ids.has(x.id));
    S.kb = S.kb.filter(a => !ids.has(a.cat));
    save();
    renderKnowledge();
  });
}
function kbSave() {
  const title = cleanText($('#kbt').value.trim().slice(0, 200)),
    cat = $('#kbc').value,
    body = cleanText($('#kbb').value.replace(/\s+$/, ''));
  if (!title) return;
  let a = kbEdit.id && S.kb.find(x => x.id === kbEdit.id);
  if (!a) S.kb.push((a = { id: uid() }));
  Object.assign(a, {
    title,
    cat,
    body,
    imgs: kbEdit.imgs || a.imgs || [],
    edited: Date.now(),
  });
  kbEdit = null;
  clearKbDraft();
  kbArt = a.id;
  kbImgShown = null;
  kbReveal(cat);
  save();
  renderKnowledge();
  window.scrollTo(0, 0);
}
function kbDelete(id) {
  const a = S.kb.find(x => x.id === id);
  if (!a) return;
  withUndo('Deleted ' + a.title, () => {
    S.kb = S.kb.filter(x => x !== a);
    kbArt = null;
    save();
    renderKnowledge();
  });
}
function addFlow() {
  const name = $('#flowname').value.trim(),
    url = $('#flowurl').value.trim();
  if (!name || !url) return;
  if (!FLOW_URL.test(url))
    return toast('That isn\'t a Run URL: it starts with "ms-powerautomate:/"', false, 4000);
  S.flows.push({ id: uid(), name: cleanText(name.slice(0, 60)), url, last: 0 });
  panels.kbflows = true; // (stays open for adding another)
  save();
  renderKnowledge();
  $('#flowname').focus();
}
function kbMoveCat(id, parent) {
  const c = kbCat(id);
  if (!c || kbCatIds(id).includes(parent) || (parent && !kbCat(parent))) return;
  c.parent = parent;
  kbMoving = null;
  kbReveal(id);
  save();
  renderKnowledge();
  toast('Moved to ' + (parent ? kbTrail(parent).join(' › ') : 'the top level'));
}
// The editor's pictures redraw on their own: redrawing the form would lose what's typed.
function kbRenderEditImgs() {
  const el = $('#kbimgs');
  if (el && kbEdit) el.innerHTML = kbImgGrid(kbEdit.imgs, true);
}
async function kbAddImages(files) {
  if (!kbEdit) return;
  const room = KB_IMGS - kbEdit.imgs.length;
  if (room <= 0) return toast(`An article can have up to ${KB_IMGS} pictures`, false, 3000);
  const ed = kbEdit,
    r = await readImages([...files].slice(0, room));
  if (kbEdit !== ed) return; // (closed meanwhile, or another article opened)
  const t = Date.now();
  kbEdit.imgs.push(
    ...r.srcs.slice(0, KB_IMGS - kbEdit.imgs.length).map((src, i) => ({ id: uid(), src, at: t + i })),
  );
  kbRenderEditImgs();
  imageToast(r);
}
// A tap on a flow's button: remembered, so it can say when it was last used. (Whether the flow
// then ran is up to Power Automate: the page can't tell.)
document.addEventListener(
  'click',
  e => {
    const a = e.target.closest && e.target.closest('a[data-flow]'),
      f = a && S.flows.find(x => x.id === a.dataset.flow);
    if (!f) return;
    f.last = Date.now();
    save();
    setTimeout(renderKnowledge, 0); // (after the link has been followed)
  },
  true,
);
// Typing a search shows the matches in place of the categories (the box itself isn't redrawn).
function kbSearch(v) {
  kbQuery = v;
  $('#kbres').innerHTML = kbResults();
  $('#kbtree').hidden = !!v.trim();
}
function kbClick(d, b) {
  if (d.kbart) {
    kbArt = d.kbart;
    kbImgShown = null;
    renderKnowledge();
    window.scrollTo(0, 0);
  }
  if (d.kbback) {
    kbArt = null;
    renderKnowledge();
  }
  if (d.kbnew) {
    kbEdit = { cat: d.kbnew };
    kbImgShown = null;
    renderKnowledge();
    window.scrollTo(0, 0);
    $('#kbt').focus();
  }
  if (d.kbedit) {
    const a = S.kb.find(x => x.id === d.kbedit);
    if (!a) return;
    // (an article whose category went is filed in the first one, unless another is chosen)
    kbEdit = { id: a.id };
    kbImgShown = null;
    renderKnowledge();
    window.scrollTo(0, 0);
  }
  if (d.kbcancel) {
    kbEdit = null;
    clearKbDraft();
    renderKnowledge();
  }
  if (d.kbdel && arm(b, 'Delete?')) kbDelete(d.kbdel);
  if (d.kbsub) {
    const v = prompt('New sub-category in ' + ((kbCat(d.kbsub) || {}).name || ''));
    if (v) kbAddCat(v, d.kbsub);
  }
  if (d.kbren) kbRename(d.kbren);
  if (d.kbmove) {
    kbMoving = kbMoving === d.kbmove ? null : d.kbmove;
    renderKnowledge();
    if (kbMoving) $('#kbmv').focus();
  }
  if (d.kbmvgo) kbMoveCat(d.kbmvgo, $('#kbmv').value);
  if (d.kbmvcancel) {
    kbMoving = null;
    renderKnowledge();
  }
  if (b.id === 'kbimgadd') $('#kbimgfile').click();
  if (d.kbimgdel && kbEdit) {
    kbEdit.imgs = kbEdit.imgs.filter(m => m.id !== d.kbimgdel);
    kbRenderEditImgs();
  }
  if (d.kbimg) {
    kbImgShown = d.kbimg;
    renderKnowledge();
  }
  if (d.kbimgclose) {
    kbImgShown = null;
    renderKnowledge();
  }
  if (d.kbdelcat) {
    const n = kbCount(d.kbdelcat);
    if (arm(b, n ? `Delete it and ${plural(n, 'article')}?` : 'Delete?')) kbDeleteCat(d.kbdelcat);
  }
  if (d.delflow && arm(b, 'Delete?')) {
    const f = S.flows.find(x => x.id === d.delflow);
    withUndo('Deleted ' + (f ? f.name : 'flow'), () => {
      S.flows = S.flows.filter(x => x.id !== d.delflow);
      save();
      renderKnowledge();
    });
  }
}
