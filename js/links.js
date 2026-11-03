/* a quest's resources: what's needed to do the work, linked to the quest (n.links): Knowledge
   articles and flows by id (nothing is copied: a renamed article keeps its link, a deleted one
   shows as gone), and web links by address, http(s) only. Its steps share them. */
const hostOf = u => {
  try {
    return new URL(u).host;
  } catch (e) {
    return u;
  }
};
// Only http(s). A bare "example.com/page" is taken as https.
function parseLinkUrl(v) {
  v = String(v || '')
    .trim()
    .replace(/\s+/g, '');
  if (v && !/^[a-z][\w+.-]*:/i.test(v) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) v = 'https://' + v;
  return okUrl(v) ? v : '';
}
function linkRow(l, qid, editable) {
  let body,
    name = l.kind === 'url' ? l.label || hostOf(l.url) : '';
  if (l.kind === 'kb') {
    const a = S.kb.find(x => x.id === l.ref);
    name = a ? a.title : 'removed article';
    body = a
      ? `<button class="open" data-sart="${a.id}"><small>Article</small><span>${esc(a.title)}</span></button>`
      : '<span class="open gone"><small>Article</small><span>Removed from Knowledge</span></span>';
  } else if (l.kind === 'flow') {
    const f = S.flows.find(x => x.id === l.ref);
    name = f ? f.name : 'removed flow';
    body = f
      ? `<a class="open" href="${esc(f.url)}" data-flow="${f.id}" title="${f.last ? 'Last used ' + esc(whenLabel(f.last)) : 'Not used yet'}"><small>Flow</small><span>&#9654; ${esc(f.name)}</span></a>`
      : '<span class="open gone"><small>Flow</small><span>Flow removed</span></span>';
  } else
    body = `<a class="open" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><small>Link</small><span>${esc(l.label || hostOf(l.url))}</span></a>`;
  return `<div class="row resrow" data-link="${l.id}">${body}${editable ? `<button class="x" data-unlink="${qid}" data-linkid="${l.id}" aria-label="Remove resource: ${esc(name)}">×</button>` : ''}</div>`;
}
// On a quest's page: its resources, open when there are any, with the ways to add one.
function renderLinks(n) {
  const ls = n.links || [],
    open = panels.resd ?? ls.length > 0;
  let h = `<details id="resd" class="resd"${open ? ' open' : ''}><summary>Resources${ls.length ? ` <small>${ls.length}</small>` : ' <small class="hint">none yet</small>'}</summary>`;
  if (ls.length) h += `<div class="list box reslist">${ls.map(l => linkRow(l, n.id, true)).join('')}</div>`;
  else h += '<p class="hint reshint">The article, flow or web page this quest needs, a tap away.</p>';
  h += `<div class="chips resadd"><button class="chip" data-resadd="kb" data-id="${n.id}">+ Article</button><button class="chip" data-resadd="flow" data-id="${n.id}">+ Flow</button><button class="chip" data-resadd="url" data-id="${n.id}">+ Web link</button></div></details>`;
  return h;
}
// On a step's page: the quest's resources, to use (changed on the quest's page).
function renderInheritedLinks(q) {
  const ls = q.links || [];
  if (!ls.length) return '';
  return `<details id="resd" class="resd"${(panels.resd ?? true) ? ' open' : ''}><summary>Resources <small>${ls.length}, the quest's</small></summary><div class="list box reslist">${ls.map(l => linkRow(l, q.id, false)).join('')}</div></details>`;
}
// A repeating quest's template keeps the same resources (as it keeps the name and tag).
function mirrorLinks(n) {
  const t = tplFor(n);
  if (!t) return;
  if (n.links) t.links = n.links.map(l => ({ ...l }));
  else delete t.links;
}
function addLink(qid, link) {
  const r = find(qid);
  if (!r || r.parents.length) return;
  const ls = r.n.links || [];
  if (ls.length >= LINKS_MAX) return toast(`A quest can have up to ${LINKS_MAX} resources`, false, 3000);
  const same = ls.find(
    l => l.kind === link.kind && (link.kind === 'url' ? l.url === link.url : l.ref === link.ref),
  );
  if (same) return toast('Already linked');
  r.n.links = [...ls, { id: uid(), ...link }];
  mirrorLinks(r.n);
  panels.resd = true;
  save();
  renderToday();
  toast('Resource added');
}
function removeLink(qid, lid) {
  const r = find(qid);
  if (!r || !r.n.links) return;
  const l = r.n.links.find(x => x.id === lid);
  if (!l) return;
  withUndo('Resource removed', () => {
    r.n.links = r.n.links.filter(x => x.id !== lid);
    if (!r.n.links.length) delete r.n.links;
    mirrorLinks(r.n);
    save();
    renderToday();
  });
}
/* choosing one: a sheet listing the articles (searchable) or the flows not yet linked, or a
   small form for a web link */
let resQuery = '';
function openResourcePicker(kind, qid) {
  const r = find(qid);
  if (!r) return;
  resQuery = '';
  if (kind === 'url')
    return popSheet(
      `<form id="resurlform" data-id="${qid}"><h2 id="sheettitle">Add a web link</h2><label class="f" for="resurl">Address</label><input class="fld" id="resurl" inputmode="url" placeholder="https://…" maxlength="2000" autocomplete="off" required><label class="f" for="reslabel">Shown as <small class="hint">(optional)</small></label><input class="fld" id="reslabel" maxlength="80" placeholder="SSRS portal" autocomplete="off"><div class="acts"><button class="btn green" id="sheetok">Add</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div></form>`,
      { labelledBy: 'sheettitle' },
    );
  popSheet(
    `<h2 id="sheettitle">${kind === 'kb' ? 'Link an article' : 'Link a flow'}</h2>${
      kind === 'kb' && S.kb.length > 6
        ? `<input class="fld" type="search" id="resq" data-id="${qid}" placeholder="Search articles" aria-label="Search articles" autocomplete="off">`
        : ''
    }<div class="qalist" id="reslist">${resourceChoices(kind, qid)}</div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function resourceChoices(kind, qid) {
  const r = find(qid),
    ls = (r && r.n.links) || [],
    linked = new Set(ls.filter(l => l.kind === kind).map(l => l.ref)),
    q = resQuery.trim().toLowerCase();
  if (kind === 'flow') {
    const fs = S.flows.filter(f => !linked.has(f.id)).sort((a, b) => byName(a.name, b.name));
    if (!S.flows.length) return '<p class="hint">No flows yet. Add one under Knowledge > Flows.</p>';
    if (!fs.length) return '<p class="hint">Every flow is linked already.</p>';
    return fs
      .map(
        f =>
          `<button class="qact" type="button" data-linkflow="${f.id}" data-id="${qid}">${esc(f.name)}</button>`,
      )
      .join('');
  }
  if (!S.kb.length) return '<p class="hint">No articles yet. Write one under Knowledge.</p>';
  const arts = S.kb
    .filter(a => !linked.has(a.id))
    .filter(a => !q || (a.title + '\n' + kbTrail(a.cat).join(' ')).toLowerCase().includes(q))
    .sort((a, b) => byName(a.title, b.title));
  if (!arts.length)
    return `<p class="hint">${q ? 'No articles match.' : 'Every article is linked already.'}</p>`;
  return arts
    .slice(0, 40)
    .map(
      a =>
        `<button class="qact" type="button" data-linkkb="${a.id}" data-id="${qid}">${esc(a.title)}<small>${esc(kbTrail(a.cat).join(' › ') || 'Uncategorised')}</small></button>`,
    )
    .join('');
}
function resourceSearch(v, qid) {
  resQuery = v;
  const el = $('#reslist');
  if (el) el.innerHTML = resourceChoices('kb', qid);
}
function submitLinkUrl(qid) {
  const url = parseLinkUrl($('#resurl').value),
    label = cleanText($('#reslabel').value.trim()).slice(0, 80);
  if (!url) return toast('Enter a web address starting with http:// or https://', false, 3500);
  closeSheet();
  addLink(qid, { kind: 'url', url, label });
}
function linkClick(d) {
  if (d.resadd) return openResourcePicker(d.resadd, d.id);
  if (d.linkkb) return addLink(d.id, { kind: 'kb', ref: d.linkkb });
  if (d.linkflow) return addLink(d.id, { kind: 'flow', ref: d.linkflow });
  if (d.unlink) return removeLink(d.unlink, d.linkid);
}
