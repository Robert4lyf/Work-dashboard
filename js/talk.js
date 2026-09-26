/* talk mode (optional, this device only): the app reads your day aloud and you answer by voice,
   so you can plan with headphones without looking at the screen. Needs speech synthesis and
   recognition (Chrome on Android has both). The rest of the app is unchanged. */
const TALK_KEY = 'dashboard-talk';
const talkable = () => !!(SR && window.speechSynthesis && window.SpeechSynthesisUtterance);
let talkPref = false;
try {
  talkPref = localStorage.getItem(TALK_KEY) === '1';
} catch (e) {}
function setTalkPref(on) {
  talkPref = on;
  try {
    if (on) localStorage.setItem(TALK_KEY, '1');
    else localStorage.removeItem(TALK_KEY);
  } catch (e) {}
  renderAll();
}
// null when closed; else { log, state ('ready', 'speaking', 'listening', 'idle'), sorting, quiet }
let talk = null,
  talkRec = null,
  talkLock = null;
// Opened from the Talk button (a tap, so it can speak straight away) or a launcher shortcut
// (it can't: browsers only speak after a tap, so it waits for Start).
function openTalk(tapped) {
  talk = { log: [], state: 'ready', sorting: null, quiet: 0 };
  try {
    navigator.wakeLock.request('screen').then(
      l => (talkLock = l),
      () => {},
    );
  } catch (e) {}
  renderTalk();
  if (tapped) talkSay(talkBrief());
}
function closeTalk() {
  const r = talkRec;
  talk = talkRec = null;
  if (r)
    try {
      r.abort();
    } catch (e) {}
  try {
    speechSynthesis.cancel();
  } catch (e) {}
  if (talkLock) talkLock.release().catch(() => {});
  talkLock = null;
  renderTalk();
}
// Speak, then listen for the answer (or run `after` instead).
function talkSay(text, after) {
  if (!talk) return;
  talk.log.push({ me: false, t: text });
  talk.state = 'speaking';
  renderTalk();
  const u = (talk.u = new SpeechSynthesisUtterance(text));
  u.lang = navigator.language || 'en-GB';
  // Only the latest utterance moves things on (cancelling an earlier one fires its onerror).
  u.onend = u.onerror = () => {
    if (!talk || talk.u !== u) return;
    talk.u = null;
    if (after) after();
    else talkListen();
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function talkListen() {
  if (!talk) return;
  let heard = '';
  try {
    talkRec = new SR();
    talkRec.lang = navigator.language || 'en-GB';
    talkRec.interimResults = false;
    talkRec.continuous = false;
    talkRec.onresult = e => (heard = e.results[e.results.length - 1][0].transcript);
    talkRec.onerror = () => {};
    talkRec.onend = () => {
      talkRec = null;
      if (!talk) return;
      if (heard.trim()) {
        talk.quiet = 0;
        talk.log.push({ me: true, t: heard.trim() });
        return talkHeard(heard.trim());
      }
      // Nothing said: try again once, then wait for a tap.
      if (++talk.quiet < 2) return talkListen();
      talk.state = 'idle';
      renderTalk();
    };
    talkRec.start();
    talk.state = 'listening';
  } catch (e) {
    talk.state = 'idle';
  }
  renderTalk();
}

/* what it says */
const sayMins = m =>
  m >= 60
    ? Math.floor(m / 60) + ' hour' + (m >= 120 ? 's' : '') + (m % 60 ? ' ' + (m % 60) + ' minutes' : '')
    : m + ' minute' + (m === 1 ? '' : 's');
const sayNext = () => {
  const nx = nextStep();
  return nx
    ? 'Next up: ' + nx.n.text + (nx.n !== nx.q ? ', in ' + nx.q.text : '') + '.'
    : S.quests.length
      ? 'Everything on Today is done.'
      : 'Nothing on Today yet.';
};
function talkBrief() {
  const now = new Date(),
    qs = S.quests,
    done = qs.filter(isDone).length,
    planned = qs.reduce((a, q) => a + estLeft(q), 0),
    next = todaysEvents().find(e => !e.allDay && e.start > now.getTime()),
    ch = chaseDue(),
    out = ["It's " + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'];
  const ms = meetingStatus();
  if (ms.startsWith('In a meeting')) out.push(ms + '.');
  if (next) out.push('Next meeting: ' + next.title + ' at ' + hhmm(next.start) + '.');
  if (qs.length) out.push(`${done} of ${qs.length} done.`);
  if (planned) out.push(`${sayMins(planned)} planned, ${sayMins(freeLeft())} free.`);
  out.push(sayNext());
  if (S.inbox.length) out.push(`${S.inbox.length} in the inbox.`);
  if (ch) out.push(`${ch} to chase.`);
  return out.join(' ') + ' What next?';
}
const TALK_HELP =
  'You can say: done, start focus, tomorrow, waiting on a name, add followed by a thought, inbox to sort it, meetings, next, repeat, or stop.';

/* what it understands */
function talkHeard(said) {
  const s = said
      .toLowerCase()
      .replace(/[.,!?]/g, '')
      .trim(),
    is = re => re.test(s);
  if (is(/^(stop|exit|quit|close|bye|goodbye|that's all|thats all|thanks|thank you)\b/))
    return talkSay('Bye.', closeTalk);
  if (talk.sorting) return talkSort(s);
  const nx = nextStep();
  const add = said.match(/^(?:add|capture|note|remember)\s+(?:that\s+)?(.+)/i);
  if (add) {
    capture(add[1]);
    return talkSay('Added to the inbox.');
  }
  const who = said.match(/^(?:it's |its |i'm |im )?waiting (?:on|for)\s+(.+)/i);
  if (who) {
    if (!nx) return talkSay('Nothing to mark waiting.');
    const name = who[1].replace(/[.!?]$/, '').trim();
    setWaiting(nx.n.id, { who: name[0].toUpperCase() + name.slice(1), note: '', due: '' });
    return talkSay(`${nx.n.text} is waiting on ${name}. ${sayNext()}`);
  }
  if (is(/^(done|finished|tick|complete|mark done|did it)\b/)) {
    if (!nx) return talkSay('Nothing to tick off.');
    const bf = snapshot();
    nx.n.done = true;
    settle(bf);
    return talkSay(`Done: ${nx.n.text}. ${sayNext()}`);
  }
  if (is(/^(start|focus|begin)\b/)) {
    if (S.timer) return talkSay('A session is already running.');
    if (!nx) return talkSay('Nothing to focus on.');
    return talkSay(`Starting ${S.mins} minutes on ${nx.n.text}. Talk mode closed.`, () => {
      closeTalk();
      startTimer(nx.n.id);
    });
  }
  if (is(/^(tomorrow|later|not today|skip|push)\b/)) {
    if (!nx) return talkSay('Nothing to move.');
    const name = nx.q.text;
    schedule('q', nx.q.id, shift(today(), 1));
    return talkSay(`Moved ${name} to tomorrow. ${sayNext()}`);
  }
  if (is(/^(inbox|sort|triage)\b/)) return talkSortNext();
  if (is(/^(meetings?|calendar|diary)\b/)) {
    const now = Date.now(),
      evs = todaysEvents().filter(e => e.allDay || e.end > now);
    return talkSay(
      evs.length
        ? evs.map(e => (e.allDay ? 'All day' : hhmm(e.start)) + ', ' + e.title).join('. ') + '.'
        : 'No more meetings today.',
    );
  }
  if (is(/^(what's next|whats next|next|what now)\b/)) return talkSay(sayNext());
  if (is(/^(repeat|again|brief|plan|status|my day)\b/)) return talkSay(talkBrief());
  if (is(/^(help|commands|what can i say)\b/)) return talkSay(TALK_HELP);
  talkSay(`I heard "${said}". Say help for what I understand.`);
}
// Sorting the inbox: each item in turn, answered with today, tomorrow, next week, delete or skip.
function talkSortNext(skip) {
  const ids = S.inbox.map(x => x.id),
    from = skip ? ids.indexOf(skip) + 1 : 0,
    it = S.inbox[from];
  if (!it) {
    talk.sorting = null;
    return talkSay((S.inbox.length ? 'That was the last one.' : 'Inbox clear.') + ' ' + sayNext());
  }
  talk.sorting = it.id;
  talkSay(`${it.text}. Today, tomorrow, next week, delete, or skip?`);
}
function talkSort(s) {
  const id = talk.sorting,
    i = S.inbox.findIndex(x => x.id === id),
    is = re => re.test(s);
  if (i < 0) return talkSortNext();
  if (is(/^(done sorting|finish|enough|that's enough|back)\b/)) {
    talk.sorting = null;
    return talkSay('Stopped sorting. ' + sayNext());
  }
  if (is(/\btoday\b/)) {
    S.quests.push(inboxToNode(S.inbox[i]));
    S.inbox.splice(i, 1);
    save();
    renderAll();
  } else if (is(/\btomorrow\b/)) schedule('i', id, shift(today(), 1));
  else if (is(/\bnext week\b/)) schedule('i', id, nextMonday());
  else if (is(/^(delete|clear|remove|bin|drop)\b/)) {
    S.inbox.splice(i, 1);
    save();
    renderAll();
  } else if (is(/^(skip|keep|leave|pass)\b/)) return talkSortNext(id);
  else return talkSay('Say today, tomorrow, next week, delete, or skip.');
  talkSortNext();
}

function renderTalk() {
  document.body.classList.toggle('talking', !!talk);
  const el = $('#v-talk');
  el.hidden = !talk;
  if (!talk) return (el.innerHTML = '');
  const st = talk.state,
    line = {
      ready: 'Tap Start, then talk.',
      speaking: 'Speaking…',
      listening: 'Listening…',
      idle: "Didn't hear anything.",
    }[st];
  const btn =
    st === 'ready'
      ? '<button class="btn blue big" id="talkgo">Start</button>'
      : st === 'idle'
        ? '<button class="btn blue big" id="talkmic">Tap to speak</button>'
        : '';
  el.innerHTML = `<button class="linkbtn zx" id="talkexit">Exit talk</button><div class="tbody"><p class="tstate${st === 'listening' ? ' on' : ''}" role="status">${line}</p>${btn}<div class="tlog">${talk.log
    .slice(-8)
    .map(x => `<p class="${x.me ? 'me' : ''}">${esc(x.t)}</p>`)
    .join('')}</div><p class="hint">Say "help" for commands.</p></div>`;
}
function renderTalkSettings() {
  let h =
    '<h2 style="margin-top:26px">Talk mode</h2><p class="hint" style="margin:0 0 6px">This device only. Adds a Talk button to the header: the app reads out your day and you answer by voice, for planning with headphones on. Keeps the screen on while open.</p>';
  if (!talkable()) return h + '<p class="hint">This browser can’t speak and listen.</p>';
  const opt = (v, l) =>
    `<button class="chip" data-talkpref="${v}" aria-pressed="${talkPref === (v === 'on')}">${l}</button>`;
  return h + `<div class="chips">${opt('off', 'Off')}${opt('on', 'On')}</div>`;
}
