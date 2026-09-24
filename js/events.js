/* nav & events */
let view = 'today';
function renderAll() {
  renderHeader();
  renderToday();
  renderInbox();
  renderFocus();
  renderLog();
  renderAccount();
  renderZen();
}
// Fade whichever edge of the tab strip has more tabs beyond it.
function fadeTabs() {
  const t = $('#tabs');
  t.classList.toggle('more-left', t.scrollLeft > 6);
  t.classList.toggle('more-right', t.scrollLeft + t.clientWidth < t.scrollWidth - 6);
}
$('#tabs').addEventListener('scroll', fadeTabs, { passive: true });
window.addEventListener('resize', fadeTabs);
function go(v) {
  view = v;
  renderHeader();
  document.querySelectorAll('nav button[data-v]').forEach(x => {
    if (x.dataset.v === v) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
  const board = onBoard();
  document.body.classList.toggle('board', board);
  ['today', 'inbox', 'focus', 'log', 'account'].forEach(
    k => ($('#v-' + k).hidden = board ? !['today', 'inbox', 'focus'].includes(k) : k !== v),
  );
  // Keep the current tab visible when the tab bar is scrolled sideways.
  const tab = document.querySelector(`nav [data-v="${v}"]`);
  if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  fadeTabs();
  if (board) $('#v-' + v).scrollIntoView({ block: 'nearest' });
  else window.scrollTo(0, 0);
}
function openPath(p) {
  path = p;
  reorder = false;
  renderToday();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button[data-v]').forEach(
  b =>
    (b.onclick = () => {
      if (b.dataset.v === 'today' && view === 'today' && path.length) {
        openPath([]);
      }
      go(b.dataset.v);
    }),
);

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'qform') {
    const v = $('#qin').value.trim();
    if (!v) return;
    const b = snapshot();
    S.quests.push(fix({ id: uid(), text: v }));
    settle(b);
    const n = $('#qin');
    n && n.focus();
  }
  if (f.id === 'sform') {
    const v = $('#sin').value.trim();
    if (!v) return;
    const opt = $('#sopt').checked,
      b = snapshot(),
      p = find(f.dataset.parent).n;
    p.children.push(fix({ id: uid(), text: v, opt }));
    settle(b);
    $('#sin').focus();
    if (opt) $('#sopt').checked = true;
  }
  if (f.id === 'authform') signIn();
  if (f.id === 'projform') {
    const v = $('#projin').value.trim();
    if (!v) return;
    newProject(v);
    save();
    renderAll();
    $('#projin').focus();
  }
  if (f.id === 'tagform') {
    const v = $('#tagin').value.trim();
    if (!v) return;
    if (S.tags.some(t => t.name === v)) {
      toast('That tag already exists');
      return;
    }
    const used = S.tags.map(t => t.color);
    S.tags.push({
      name: v,
      color: PALETTE.find(c => !used.includes(c)) || PALETTE[S.tags.length % PALETTE.length],
    });
    save();
    renderAll();
    $('#tagin').focus();
  }
  if (f.id === 'iform') {
    const n = capture($('#iin').value);
    if (!n) return;
    $('#iin').focus();
    if (n > 1) toast('Added ' + n + ' items');
  }
  if (f.dataset.subfor) {
    const id = f.dataset.subfor,
      v = f.querySelector('input').value.trim(),
      it = S.inbox.find(x => x.id === id);
    if (!v || !it) return;
    it.node = it.node || inboxToNode(it);
    it.node.children.push(fix({ id: uid(), text: v }));
    save();
    renderAll();
    const nf = document.querySelector(`[data-subfor="${id}"] input`);
    nf && nf.focus();
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'imp') {
    if (el.files && el.files[0]) importFile(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.setproject) {
    setProject(el.dataset.kind, el.dataset.setproject, el.value);
    return;
  }
  if (el.dataset.projname !== undefined) {
    const p = S.projects[+el.dataset.projname],
      v = el.value.trim().slice(0, 40);
    if (p && v) p.name = v;
    save();
    renderAll();
    return;
  }
  if (el.dataset.tagname !== undefined) {
    renameTag(+el.dataset.tagname, el.value);
    save();
    renderAll();
    return;
  }
  if (el.dataset.schedpick) {
    schedule(el.dataset.kind, el.dataset.schedpick, el.value);
    return;
  }
  if (el.dataset.restart) {
    const n = S.later.find(x => x.id === el.dataset.restart);
    if (n && el.value > today()) {
      n.start = el.value;
      S.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      save();
    }
    renderToday();
    return;
  }
  if (el.id === 'fq') {
    S.focusQ = el.value;
    save();
    renderFocus();
    return;
  }
  const fld = el.dataset.field;
  if (!fld) return;
  const r = find(el.dataset.id);
  if (!r) return;
  if (fld === 'text') {
    const v = el.value.trim();
    if (v) {
      r.n.text = v;
      const t = tplFor(r.n);
      if (t) t.text = v;
      save();
      renderAll();
    }
    return;
  }
  if (fld === 'month') {
    setRepeat(r.n, t => (t.monthDay = +el.value));
    return;
  }
  if (fld === 'due') {
    r.n.due = el.value;
    save();
    renderAll();
    return;
  }
  if (fld === 'opt') {
    const b = snapshot();
    r.n.opt = el.checked;
    settle(b);
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.field !== 'notes') return;
  const r = find(el.dataset.id);
  if (r) {
    r.n.notes = el.value;
    save();
  }
});

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.open) {
    const r = find(d.open);
    if (r) {
      openPath([...r.parents.map(p => p.id), r.n.id]);
      if (view !== 'today') go('today');
    }
  }
  if (d.v && b.closest('header')) go(d.v);
  if (d.crumb !== undefined) openPath(path.slice(0, +d.crumb + 1));
  if (d.toggle) {
    const n = find(d.toggle).n,
      bf = snapshot();
    n.done = !n.done;
    settle(bf);
  }
  if (d.del) {
    const r = find(d.del);
    if (!r) return;
    if (!arm(b, r.n.children.length ? 'Delete all?' : 'Delete?')) return;
    withUndo('Deleted ' + r.n.text, () => {
      const bf = snapshot();
      r.arr.splice(r.arr.indexOf(r.n), 1);
      settle(bf);
    });
  }
  if (d.up || d.down) {
    const r = find(d.up || d.down),
      i = r.arr.indexOf(r.n),
      j = d.up ? i - 1 : i + 1;
    if (j < 0 || j >= r.arr.length) return;
    [r.arr[i], r.arr[j]] = [r.arr[j], r.arr[i]];
    save();
    renderAll();
  }
  if (d.top) {
    const r = find(d.top);
    if (r) {
      r.arr.splice(r.arr.indexOf(r.n), 1);
      r.arr.unshift(r.n);
      save();
      renderAll();
    }
  }
  if (b.id === 'reorder') {
    reorder = !reorder;
    renderToday();
  }
  if (d.savetpl) {
    const n = find(d.savetpl).n,
      t = Object.assign({ id: uid(), days: [] }, strip(n)),
      i = S.templates.findIndex(x => x.text === n.text);
    if (i >= 0) {
      t.id = S.templates[i].id;
      t.days = S.templates[i].days;
      t.monthDay = S.templates[i].monthDay;
      S.templates[i] = t;
      toast('Template updated');
    } else {
      S.templates.push(t);
      toast('Template saved');
    }
    save();
  }
  if (d.tpl) {
    const t = S.templates.find(x => x.id === d.tpl);
    const bf = snapshot(),
      q = inst(t);
    q.tpl = t.id;
    S.quests.push(q);
    settle(bf);
    toast('Added ' + t.text);
  }
  if (d.deltpl) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Template deleted', () => {
      S.templates = S.templates.filter(x => x.id !== d.deltpl);
      save();
      renderToday();
    });
  }
  if (d.rep) {
    const t = S.templates.find(x => x.id === d.rep),
      wd = +d.wd;
    t.days = t.days.includes(wd) ? t.days.filter(x => x !== wd) : [...t.days, wd];
    if (t.auto && !repeats(t)) {
      S.templates = S.templates.filter(x => x !== t);
      S.quests.forEach(q => {
        if (q.tpl === t.id) delete q.tpl;
      });
    }
    save();
    renderAll();
  }
  if (d.rday) {
    const wd = +d.rday,
      r = find(d.id);
    if (r)
      setRepeat(r.n, t => (t.days = t.days.includes(wd) ? t.days.filter(x => x !== wd) : [...t.days, wd]));
  }
  if (d.rpreset) {
    const r = find(d.id),
      k = d.rpreset;
    if (r)
      setRepeat(r.n, t => {
        t.days = k === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : k === 'weekdays' ? [1, 2, 3, 4, 5] : [];
        if (k === 'off') t.monthDay = 0;
      });
  }
  if (d.toinbox) moveToInbox(d.toinbox);
  if (d.sched) schedule(d.kind, d.sched, d.when);
  if (d.now) {
    const i = S.later.findIndex(x => x.id === d.now);
    if (i >= 0) {
      const n = S.later.splice(i, 1)[0];
      delete n.start;
      const bf = snapshot();
      S.quests.push(n);
      settle(bf);
      toast('Added to today');
    }
  }
  if (d.dellater) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Deleted', () => {
      S.later = S.later.filter(x => x.id !== d.dellater);
      save();
      renderAll();
    });
  }
  if (d.focuson) {
    S.focusQ = d.focuson;
    save();
    renderFocus();
    go('focus');
  }
  if (d.promote) {
    const i = S.inbox.findIndex(x => x.id === d.promote),
      it = S.inbox[i],
      bf = snapshot();
    S.quests.push(inboxToNode(it));
    S.inbox.splice(i, 1);
    settle(bf);
    toast('Added to today');
  }
  if (d.steps) {
    if (expanded.has(d.steps)) expanded.delete(d.steps);
    else expanded.add(d.steps);
    renderInbox();
    const nf = document.querySelector(`[data-subfor="${d.steps}"] input`);
    nf && nf.focus();
  }
  if (d.delsub) {
    const it = S.inbox.find(x => x.id === d.delsub);
    if (it && it.node)
      withUndo('Removed', () => {
        it.node.children = it.node.children.filter(k => k.id !== d.sub);
        save();
        renderInbox();
      });
  }
  if (b.id === 'mic') toggleMic();
  if (d.clear) {
    withUndo('Cleared', () => {
      S.inbox = S.inbox.filter(x => x.id !== d.clear);
      addXP(5);
      save();
      renderAll();
    });
  }
  if (d.settag !== undefined) {
    const v = d.settag;
    if (d.kind === 'q') {
      const r = find(d.id);
      if (r) {
        r.n.tag = r.n.tag === v ? '' : v;
        const t = tplFor(r.n);
        if (t) t.tag = r.n.tag;
      }
    } else {
      const it = S.inbox.find(x => x.id === d.id);
      if (it) {
        it.tag = it.tag === v ? '' : v;
        if (it.node) it.node.tag = it.tag;
      }
    }
    save();
    renderAll();
  }
  if (d.look) {
    setLook(d.look, d.val);
    renderAccount();
  }
  if (d.edittags) {
    renderAccount();
    go('account');
    const t = $('#tagsec');
    t && t.scrollIntoView();
  }
  if (d.projdone) {
    const p = S.projects.find(x => x.id === d.projdone);
    if (p) {
      p.done = !p.done;
      save();
      renderAll();
      toast(p.done ? 'Project finished' : 'Project reopened');
    }
  }
  if (d.delproj) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Project deleted', () => {
      const id = S.projects[+d.delproj].id;
      S.projects.splice(+d.delproj, 1);
      eachTagged(n => {
        if (n.project === id) n.project = '';
      });
      save();
      renderAll();
    });
  }
  if (d.deltag) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Tag deleted', () => {
      const name = S.tags[+d.deltag].name;
      S.tags.splice(+d.deltag, 1);
      eachTagged(n => {
        if (n.tag === name) n.tag = '';
      });
      save();
      renderAll();
    });
  }
  if (d.range) {
    range = +d.range;
    renderLog();
  }
  if (d.mins) {
    S.mins = +d.mins;
    save();
    renderFocus();
  }
  if (b.id === 'start') startTimer(focusTarget());
  if (d.zstart) startTimer(d.zstart);
  if (d.zen) setZen(true);
  if (b.id === 'zenexit') setZen(false);
  if (b.id === 'plus5' || d.plus5) {
    const t = S.timer;
    if (!t) return;
    t.mins += 5;
    if (t.left != null) t.left += 300000;
    else t.end += 300000;
    save();
    renderFocus();
    renderZen();
  }
  if (b.id === 'stop' || d.discard) {
    if (!arm(b, 'Tap again to discard')) return;
    S.timer = null;
    save();
    renderAll();
  }
  if (b.id === 'stopsave' || d.stop === 'save') stopAndSave(false);
  if (b.id === 'stopdone' || d.stop === 'done') stopAndSave(true);
  if (d.pause) {
    const t = S.timer;
    if (!t) return;
    if (t.left != null) {
      t.end = Date.now() + t.left;
      delete t.left;
    } else t.left = Math.max(0, t.end - Date.now());
    save();
    renderHeader();
    renderFocus();
    renderZen();
  }
  if (b.id === 'undo') undo();
  if (b.id === 'copylog') copyLog();
  if (b.id === 'hist') loadHistory();
  if (d.hist) {
    const r = versions.find(x => String(x.id) === d.hist);
    if (r && r.data && Array.isArray(r.data.quests)) {
      pending = r.data;
      renderAccount();
      window.scrollTo(0, 0);
    }
  }
  if (b.id === 'exp') exportData();
  if (b.id === 'doRestore') {
    norm(pending);
    pending = null;
    path = [];
    save();
    renderAll();
    toast('Backup restored');
    go('today');
  }
  if (b.id === 'noRestore') {
    pending = null;
    renderAccount();
  }
  if (b.id === 'syncBtn') {
    renderAccount();
    go('account');
  }
  if (b.id === 'signup') signUp();
  if (b.id === 'signout') {
    unlisten();
    sb.auth.signOut().then(() => {
      session = null;
      syncStatus = '';
      versions = null;
      renderSyncBadge();
      renderAccount();
    });
  }
  if (b.id === 'syncNow') sync();
});

document.addEventListener(
  'toggle',
  e => {
    if (e.target.id) panels[e.target.id] = e.target.open;
  },
  true,
);

/* keyboard shortcuts (desktop) */
const KEYS =
  'n new quest · i capture · t today · f focus · l history · s settings · z single-task · p pause · Esc back';
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (el.closest && el.closest('input,textarea,select,[contenteditable]')) {
    if (e.key === 'Escape') el.blur();
    return;
  }
  const k = e.key,
    field = id => {
      const f = $(id);
      if (!f) return false;
      e.preventDefault();
      f.focus();
      return true;
    };
  if (k === 'n') {
    go('today');
    field('#sin') || field('#qin');
  } else if (k === 'i') {
    go('inbox');
    field('#iin');
  } else if (k === 't') {
    if (view === 'today' && path.length) openPath([]);
    go('today');
  } else if (k === 'f') go('focus');
  else if (k === 'l') go('log');
  else if (k === 'p' && S.timer) {
    const b = $('[data-pause]');
    if (b) b.click();
  } else if (k === '?') toast(KEYS, false, 5000);
  else if (k === 's') go('account');
  else if (k === 'z') setZen(!zen);
  else if (k === 'Escape') {
    if (zen) setZen(false);
    else if (view === 'today' && path.length) openPath(path.slice(0, -1));
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    rollover();
    if (timerDue()) finishTimer(true);
    else renderAll();
    sync();
  }
});
window.addEventListener('online', () => sync());
window.addEventListener('offline', () => {
  if (session) setSync('offline');
});
setInterval(() => {
  if (!document.hidden) sync();
}, 60000);

load();
rollover();
if (timerDue()) finishTimer(true);
else renderAll();
go(view);
receiveShare();
setInterval(timerTick, 500);
if (sb) {
  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    renderSyncBadge();
    if (view === 'account') renderAccount();
    if (s && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) {
      setTimeout(sync, 0);
      listen();
    }
  });
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
