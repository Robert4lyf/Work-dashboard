/* the Knowledge tab: articles (guides, who's who, links) filed in categories and sub-categories,
   plus Flows: buttons that run Power Automate Desktop flows on this computer. */
let kbArt = null, // the article being read
  kbEdit = null, // the article being written: { id (none for a new one), cat }
  kbQuery = ''; // what's typed in the search box
const byName = (a, b) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
// A flow's Run URL (Power Automate Desktop: the flow's Properties > Details). Only that kind of
// link: a synced row mustn't be able to put any other link behind a button.
const FLOW_URL = /^ms-powerautomate:\/[^\s"'<>`]*$/i;
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
    body: okText(a.body, 50000),
    edited: typeof a.edited === 'number' ? a.edited : 0,
  }));
  S.flows = (Array.isArray(S.flows) ? S.flows : [])
    .filter(f => ok(f) && typeof f.url === 'string' && FLOW_URL.test(f.url))
    .map(f => ({ id: f.id, name: okText(f.name, 60) || 'Flow', url: f.url }));
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
// Text as written, with web links made clickable.
function kbLinkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, m => {
    const tail = (m.match(/(?:[.,;:!?)\]]|&#39;|&quot;)+$/) || [''])[0],
      u = m.slice(0, m.length - tail.length);
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>${tail}`;
  });
}

function renderKnowledge() {
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
      ? `<div class="flows">${flows.map(f => `<a class="btn blue" href="${esc(f.url)}" data-flow="${f.id}">${esc(f.name)}</a>`).join('')}</div>`
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
  {
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
  }
  return h;
}
const kbRow = a => `<button class="soonrow kbrow" data-kbart="${a.id}"><span>${esc(a.title)}</span></button>`;
function kbCatTree(c) {
  const kids = kbKids(c.id),
    arts = kbArts(c.id),
    id = 'kc-' + c.id;
  return `<details id="${id}" class="kcat"${panels[id] ? ' open' : ''}><summary>${esc(c.name)} <small>${kbCount(c.id)}</small></summary><div class="kbody">
    ${kids.map(kbCatTree).join('')}${arts.map(kbRow).join('')}${!kids.length && !arts.length ? '<p class="hint kbempty">Empty.</p>' : ''}
    <div class="links"><button class="linkbtn" data-kbnew="${c.id}">+ Article</button><button class="linkbtn" data-kbsub="${c.id}">+ Sub-category</button><button class="linkbtn" data-kbren="${c.id}">Rename</button><button class="dellink" data-kbdelcat="${c.id}">Delete</button></div></div></details>`;
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
    <div class="kbtext box">${a.body ? kbLinkify(a.body) : '<span class="hint">Nothing written yet.</span>'}</div>
    <div class="acts"><button class="btn blue" data-kbedit="${a.id}">Edit</button><button class="btn" data-kbdel="${a.id}">Delete</button></div>`;
}
// Every category, as a path, for the article's "Category" choice.
function kbCatOptions(sel) {
  const out = [];
  (function w(parent, trail) {
    kbKids(parent).forEach(c => {
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
  return `<h2>${kbEdit.id ? 'Edit article' : 'New article'}</h2><form id="kbform">
    <label class="f" for="kbt">Title</label><input class="fld" id="kbt" maxlength="200" value="${esc(a.title)}" autocomplete="off" required>
    <label class="f" for="kbc">Category</label><select class="fld" id="kbc">${kbCatOptions(a.cat)}</select>
    <label class="f" for="kbb">Article</label><textarea class="fld kbbody" id="kbb" placeholder="Steps, contacts, links... Web links become clickable.">${esc(a.body)}</textarea>
    <div class="acts"><button class="btn green">Save</button><button class="btn" type="button" data-kbcancel="1">Cancel</button></div></form>`;
}

// Opens the categories above one, so it can be seen.
function kbReveal(cat) {
  for (let c = kbCat(cat), n = 0; c && n < 50; c = kbCat(c.parent), n++) panels['kc-' + c.id] = true;
}
function kbAddCat(name, parent) {
  name = name.trim().slice(0, 80);
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
  c.name = v.trim().slice(0, 80);
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
  const title = $('#kbt').value.trim(),
    cat = $('#kbc').value,
    body = $('#kbb').value.replace(/\s+$/, '');
  if (!title) return;
  let a = kbEdit.id && S.kb.find(x => x.id === kbEdit.id);
  if (!a) S.kb.push((a = { id: uid() }));
  Object.assign(a, { title: title.slice(0, 200), cat, body, edited: Date.now() });
  kbEdit = null;
  kbArt = a.id;
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
  S.flows.push({ id: uid(), name: name.slice(0, 60), url });
  panels.kbflows = true; // (stays open for adding another)
  save();
  renderKnowledge();
  $('#flowname').focus();
}
// Typing a search shows the matches in place of the categories (the box itself isn't redrawn).
function kbSearch(v) {
  kbQuery = v;
  $('#kbres').innerHTML = kbResults();
  $('#kbtree').hidden = !!v.trim();
}
function kbClick(d, b) {
  if (d.kbart) {
    kbArt = d.kbart;
    renderKnowledge();
    window.scrollTo(0, 0);
  }
  if (d.kbback) {
    kbArt = null;
    renderKnowledge();
  }
  if (d.kbnew) {
    kbEdit = { cat: d.kbnew };
    renderKnowledge();
    window.scrollTo(0, 0);
    $('#kbt').focus();
  }
  if (d.kbedit) {
    const a = S.kb.find(x => x.id === d.kbedit);
    if (!a) return;
    // (an article whose category went is filed in the first one, unless another is chosen)
    kbEdit = { id: a.id, cat: a.cat };
    renderKnowledge();
    window.scrollTo(0, 0);
  }
  if (d.kbcancel) {
    kbEdit = null;
    renderKnowledge();
  }
  if (d.kbdel && arm(b, 'Delete?')) kbDelete(d.kbdel);
  if (d.kbsub) {
    const v = prompt('New sub-category in ' + ((kbCat(d.kbsub) || {}).name || ''));
    if (v) kbAddCat(v, d.kbsub);
  }
  if (d.kbren) kbRename(d.kbren);
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
