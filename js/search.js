/* search: one box for everything (quests, Upcoming, the Inbox, notes, knowledge, flows and
   what's been done), opened from the header. */
let searchQ = '';
const SEARCH_MAX = 20; // per group
function renderSearch() {
  setHTML(
    $('#v-search'),
    `<h2>Search</h2><input class="fld" type="search" id="sq" placeholder="Quests, inbox, notes, knowledge…" aria-label="Search everything" autocomplete="off" value="${esc(searchQ)}"><div id="sres">${searchResults()}</div>`,
  );
}
function openSearch() {
  go('search');
  renderSearch();
  const i = $('#sq');
  if (i) {
    i.focus();
    i.select();
  }
}
function typedSearch(v) {
  searchQ = v;
  $('#sres').innerHTML = searchResults();
}
// The typed words, matched in any case and across any run of spaces or line breaks.
const searchRe = q =>
  new RegExp(
    q
      .split(' ')
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'),
    'i',
  );
// A few words either side of the match, for text that's longer than a line. Found in the text as
// written (not a lower-cased copy, which can differ in length), so what's marked is what matched.
function snippet(text, q) {
  text = String(text || '');
  const m = searchRe(q).exec(text);
  if (!m) return esc(text.slice(0, 100).replace(/\s+/g, ' '));
  const from = Math.max(0, m.index - 40),
    to = Math.min(text.length, m.index + m[0].length + 60),
    flat = t => esc(t.replace(/\s+/g, ' '));
  return (
    (from ? '…' : '') +
    flat(text.slice(from, m.index)) +
    '<mark>' +
    flat(m[0]) +
    '</mark>' +
    flat(text.slice(m.index + m[0].length, to)) +
    (to < text.length ? '…' : '')
  );
}
function searchResults() {
  const q = searchQ.trim().replace(/\s+/g, ' ');
  if (!q) return '<p class="hint">Type to search everything.</p>';
  // (anything, as synced rows may hold a number where text belongs)
  const re = searchRe(q),
    has = s => s != null && re.test(String(s)),
    day = d => (cleanDay(d) ? dayLabel(d) : ''),
    groups = [],
    row = (attrs, title, sub) =>
      `<button class="soonrow srow" ${attrs}><span>${esc(title)}${sub ? `<br><small class="hint">${sub}</small>` : ''}</span></button>`,
    group = (name, rows) => rows.length && groups.push([name, rows]);

  // Quests (steps too), with where they sit and any waiting details.
  const qs = [];
  (function w(ns, trail) {
    ns.forEach(n => {
      const wt = n.wait ? [n.wait.who, n.wait.note].join(' ') : '';
      if (has(n.text) || has(n.notes) || has(wt)) {
        const sub = [
          trail.length ? esc(trail.join(' / ')) : '',
          isDone(n) ? 'done' : '',
          n.wait ? 'waiting' + (n.wait.who ? ' on ' + esc(n.wait.who) : '') : '',
          !has(n.text) && has(n.notes) ? snippet(n.notes, q) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        qs.push(row(`data-open="${n.id}"`, n.text, sub));
      }
      w(n.children, [...trail, n.text]);
    });
  })(S.quests, []);
  group('Today', qs);
  group(
    'Upcoming',
    S.later.filter(n => has(n.text) || has(n.notes)).map(n => row('data-goupd="1"', n.text, day(n.start))),
  );
  group(
    'Inbox',
    S.inbox
      .filter(i => has(i.text) || (i.wait && has(i.wait.who)))
      .map(i =>
        row('data-goto="inbox"', i.text, i.wait && i.wait.who ? 'waiting on ' + esc(i.wait.who) : ''),
      ),
  );
  // Notes: each matching line.
  group(
    'Notes',
    String(S.notes || '')
      .split('\n')
      .filter(l => has(l))
      .map(l => `<button class="soonrow srow" data-goto="notes"><span>${snippet(l, q)}</span></button>`),
  );
  group(
    'Knowledge',
    S.kb
      .filter(a => has(a.title) || has(a.body))
      .sort((a, b) => byName(a.title, b.title))
      .map(a =>
        row(
          `data-sart="${a.id}"`,
          a.title,
          [esc(kbTrail(a.cat).join(' › ') || 'Uncategorised'), !has(a.title) ? snippet(a.body, q) : '']
            .filter(Boolean)
            .join(' · '),
        ),
      ),
  );
  group(
    'Flows',
    S.flows
      .filter(f => has(f.name))
      .map(
        f =>
          `<div class="srow"><a class="btn blue sm" href="${esc(f.url)}" data-flow="${f.id}">${esc(f.name)}</a> <small class="hint">runs the flow</small></div>`,
      ),
  );
  // What's been done (the log keeps about four months).
  group(
    'Done',
    S.log
      .filter(x => has(x.text) || (Array.isArray(x.trail) && x.trail.some(has)))
      .slice()
      .reverse()
      .map(
        x =>
          `<div class="soonrow srow"><span>${esc(x.text)}<br><small class="hint">${[Array.isArray(x.trail) && x.trail.length ? esc(x.trail.join(' / ')) : '', day(x.d) && 'done ' + day(x.d)].filter(Boolean).join(' · ')}</small></span></div>`,
      ),
  );
  if (!groups.length) return '<p class="hint">Nothing matches.</p>';
  return groups
    .map(
      ([name, rows]) =>
        `<div class="sgroup"><h2>${name} <small>${rows.length}</small></h2>${rows.slice(0, SEARCH_MAX).join('')}${rows.length > SEARCH_MAX ? `<p class="hint">and ${rows.length - SEARCH_MAX} more: add a word to narrow it down.</p>` : ''}</div>`,
    )
    .join('');
}
