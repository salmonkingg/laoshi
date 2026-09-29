// app.js
// Runs the page: loads the data, picks today's questions, shows them one at a time,
// and remembers on this device how well each card is known.

(function () {
  'use strict';

  const { TYPES, shuffle } = window.HSK;
  const STORE_KEY = 'hsk1-practice-v1';

  // How many days to wait before showing a card again, by "box".
  // A right answer moves a card up one box; a wrong one moves it down two.
  const WAIT_DAYS = [0, 1, 3, 7, 14, 30, 60];

  const $ = sel => document.querySelector(sel);
  const main = $('#main');

  // ---------- saved progress ----------

  const defaults = {
    settings: { upTo: 15, size: 15, newPerDay: 2, radicalSize: 10, writing: true, typing: true, showPinyin: false },
    cards: {},  // cardId -> { b: box, d: day it is due, n: times seen, w: times wrong }
    days: {},   // "2026-09-28" -> { q: questions answered, r: right }
    pinyinDays: {}, // the same, for the Pinyin tab
    radicalDays: {}, // and for the Radicals tab
    tests: {},  // lesson number -> { last: score, best: score, of: questions, day: "2026-09-29" }
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return { settings: { ...defaults.settings, ...s.settings }, cards: s.cards || {}, days: s.days || {}, pinyinDays: s.pinyinDays || {}, radicalDays: s.radicalDays || {}, tests: s.tests || {} };
      }
    } catch (e) { /* storage blocked: progress lasts until the page closes */ }
    return JSON.parse(JSON.stringify(defaults));
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function dayKey(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayNumber(d = new Date()) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function box(id) { return state.cards[id] ? state.cards[id].b : 0; }
  function seen(id) { return !!state.cards[id]; }

  function record(card, right, log = 'days') {
    const today = dayNumber();
    const c = state.cards[card.id] || { b: 0, d: today, n: 0, w: 0, f: today };
    c.n++;
    if (right) {
      c.b = Math.min(c.b + 1, WAIT_DAYS.length - 1);
      c.d = today + WAIT_DAYS[c.b];
    } else {
      c.w++;
      c.b = Math.max(0, c.b - 2);
      c.d = today + 1;
    }
    state.cards[card.id] = c;
    const k = dayKey();
    if (!state[log]) state[log] = {};
    const day = state[log][k] || { q: 0, r: 0 };
    day.q++;
    if (right) day.r++;
    state[log][k] = day;
    save();
  }

  // ---------- data ----------

  let data, ctx, allCards, strokes = null;

  // Reads a data file. The one-file USB version carries its data inside the page
  // (window.LAOSHI_FILES), because browsers won't let a page opened from a disk load other files.
  async function getJSON(path) {
    if (window.LAOSHI_FILES && window.LAOSHI_FILES[path]) return window.LAOSHI_FILES[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return res.json();
  }

  async function loadData() {
    data = await getJSON('data/hsk1.json');
    try { data.extra = (await getJSON('data/extra-questions.json')).questions || []; } catch (e) { data.extra = []; }
    try { data.radicals = await getJSON('data/radicals.json'); } catch (e) { data.radicals = null; }

    const wordById = {}, charInfo = {}, patternById = {}, extraById = {};
    data.words.forEach(w => (wordById[w.id] = w));
    data.characters.forEach(c => (charInfo[c.char] = c));
    data.patterns.forEach(p => (patternById[p.id] = p));
    data.extra.forEach(q => (extraById[q.id] = q));
    ctx = { data, wordById, charInfo, patternById, extraById, box, settings: state.settings, words: data.words };

    allCards = [];
    for (const [name, type] of Object.entries(TYPES)) {
      for (const card of type.cards(data)) allCards.push(card);
    }
  }

  async function loadStrokes() {
    if (strokes) return strokes;
    strokes = await getJSON('data/strokes.json');
    return strokes;
  }

  // ---------- choosing questions ----------

  function typeOn(type) {
    const t = TYPES[type];
    if (t.optional === 'writing') return state.settings.writing && !!window.HanziWriter;
    if (t.optional === 'typing') return state.settings.typing;
    return true;
  }

  function unlocked(card) {
    const t = TYPES[card.type];
    const need = t.requires && t.requires(card);
    return !need || seen(need);
  }

  function setWords(lessons) {
    ctx.words = data.words.filter(w => lessons(w.lesson));
    ctx.settings = state.settings;
  }

  // Which question types belong to each tab. Today leaves out the pinyin-only types;
  // the Pinyin tab uses every type whose skill is pinyin.
  const TABS = {
    today: { types: t => !TYPES[t].tab, size: s => s.size, log: 'days' },
    radicals: { types: t => TYPES[t].tab === 'radicals', size: s => s.radicalSize, log: 'radicalDays' },
  };

  // A day's session: cards that are due first, then a few new ones, then older ones to top up.
  function dailySession(tab = 'today') {
    const s = state.settings;
    const size = TABS[tab].size(s);
    const inRange = l => l <= s.upTo;
    setWords(inRange);
    const today = dayNumber();
    const pool = allCards.filter(c => inRange(c.lesson) && typeOn(c.type) && TABS[tab].types(c.type));

    // Cards that are due, in a mixed order. Keep a little room for new cards so you keep moving forward.
    const due = shuffle(pool.filter(c => seen(c.id) && state.cards[c.id].d <= today));
    const keepForNew = Math.min(3, s.newPerDay);
    const picked = due.slice(0, size - keepForNew);

    // New cards, no more than the daily limit for this tab.
    const newToday = countNewToday(tab);
    const room = Math.min(size - picked.length, Math.max(0, s.newPerDay - newToday));
    const fresh = pool.filter(c => !seen(c.id) && unlocked(c));
    if (fresh.length && room > 0) {
      const first = Math.min(...fresh.map(c => c.lesson));
      const nearby = shuffle(fresh.filter(c => c.lesson <= first + 1));
      picked.push(...nearby.slice(0, room));
    }

    // Top up with cards seen before, the least known first.
    if (picked.length < size) {
      const chosen = new Set(picked.map(c => c.id));
      const extra = pool.filter(c => seen(c.id) && !chosen.has(c.id))
        .sort((a, b) => box(a.id) - box(b.id) || state.cards[a.id].d - state.cards[b.id].d);
      picked.push(...extra.slice(0, size - picked.length));
    }
    return spread(shuffle(picked));
  }

  // Card ids start with their type, for example "meaning:w001".
  function countNewToday(tab) {
    const today = dayNumber();
    return Object.entries(state.cards)
      .filter(([id, c]) => c.f === today && TYPES[id.split(':')[0]] && TABS[tab].types(id.split(':')[0])).length;
  }

  // A few questions from one lesson, any type, for "Practise this lesson".
  function lessonSession(lesson) {
    setWords(l => l <= Math.max(lesson, 2));
    const pool = allCards.filter(c => c.lesson === lesson && typeOn(c.type) && TYPES[c.type].tab !== 'retired');
    const weak = pool.slice().sort((a, b) => box(a.id) - box(b.id) || Math.random() - 0.5);
    return spread(shuffle(weak.slice(0, 12)));
  }

  // A short end-of-lesson test: one question of each kind from that lesson, 10 in all.
  // Kinds with nothing in this lesson are topped up with extra word questions.
  const TEST_SIZE = 10;
  const TEST_MIX = ['meaning', 'recall', 'pinyin', 'judge', 'wordchar', 'sentence', 'fill', 'order', 'extra', 'write'];

  function lessonTest(lesson) {
    setWords(l => l <= Math.max(lesson, 2));
    const pool = allCards.filter(c => c.lesson === lesson && typeOn(c.type));
    const picked = [];
    const used = new Set();
    const take = type => {
      const options = shuffle(pool.filter(c => c.type === type && !picked.includes(c)));
      const card = options.find(c => !used.has(c.ref)) || options[0];
      if (card) { picked.push(card); used.add(card.ref); }
      return !!card;
    };
    for (const type of TEST_MIX) if (picked.length < TEST_SIZE) take(type);
    const topUp = ['meaning', 'judge', 'recall', 'sentence', 'extra', 'wordchar', 'fill', 'pinyin'];
    for (let i = 0; picked.length < TEST_SIZE && i < 40; i++) take(topUp[i % topUp.length]);
    return spread(shuffle(picked));
  }

  // The first lesson (up to the one chosen in Settings) whose words have all been met
  // in daily practice but whose test has not been taken yet.
  function testReady() {
    for (const l of data.lessons) {
      if (l.lesson > state.settings.upTo) break;
      if (state.tests[l.lesson]) continue;
      if (l.words.every(id => seen('meaning:' + id))) return l.lesson;
      return null;
    }
    return null;
  }

  function startTest(lesson, back) {
    runSession(lessonTest(lesson), 'Lesson ' + lesson + ' test', 'days', back, { test: lesson });
  }

  // Avoid the same word twice in a row.
  function spread(cards) {
    for (let i = 1; i < cards.length; i++) {
      if (cards[i].ref === cards[i - 1].ref) {
        const j = cards.findIndex((c, k) => k > i && c.ref !== cards[i - 1].ref);
        if (j > 0) [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    return cards;
  }

  // ---------- screens ----------

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  }

  // Like replaceChildren, but skips empty (null) parts.
  function fill(target, ...nodes) {
    target.replaceChildren(...nodes.filter(n => n != null && n !== false));
  }

  function show(...nodes) {
    main.replaceChildren(...nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }

  function setNav(which) {
    document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.go === which ? 'page' : 'false'));
  }

  function knownWords() {
    return data.words.filter(w => box('meaning:' + w.id) >= 3).length;
  }

  function homeScreen() {
    setNav('home');
    const today = state.days[dayKey()];
    const done = today && today.q >= state.settings.size;
    const upTo = state.settings.upTo;
    const lessonLine = upTo >= 15 ? 'All 15 lessons' : 'Lessons 1 to ' + upTo;
    const ready = testReady();
    show(
      el('section', { class: 'home' },
        el('p', { class: 'date' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
        el('h1', { class: 'greeting' }, done ? '今天练好了。' : '今天练习吧。'),
        el('p', { class: 'lede' }, done
          ? `You have practised today: ${today.r} of ${today.q} right. That is enough for today, but you can do a little more if you like.`
          : `About ${state.settings.size} questions on reading, pinyin, writing and sentence order. ${lessonLine}.`),
        el('div', { class: 'actions' },
          el('button', { class: 'primary', id: 'start', onclick: () => runSession(dailySession('today'), 'Today') }, done ? 'Practise a little more' : 'Start today’s practice')),
        ready ? el('div', { class: 'test-ready' },
          el('p', {}, `You have met every word in lesson ${ready}. When you like, there is a short test for it: ${TEST_SIZE} questions.`),
          el('button', { id: 'start-test', onclick: () => startTest(ready, homeScreen) }, `Take the lesson ${ready} test`)) : null,
        el('dl', { class: 'facts' },
          el('div', {}, el('dt', {}, 'Words you know well'), el('dd', {}, `${knownWords()} of ${data.words.length}`)),
          el('div', {}, el('dt', {}, 'Characters written'), el('dd', {}, `${data.characters.filter(c => seen('write:' + c.char)).length} of ${data.characters.length}`)),
        ),
      ),
    );
  }

  // ---------- running a session ----------

  // opts.test = lesson number: a lesson test. Each question is asked once (no second try at the end),
  // the score is saved, and only cards already met in practice have their progress updated.
  function runSession(cards, title, log = 'days', back = homeScreen, opts = {}) {
    if (!cards.length) {
      show(el('section', { class: 'panel' }, el('p', {}, 'Nothing to practise with these settings.'),
        el('button', { onclick: back }, 'Back')));
      return;
    }
    setNav('');
    const queue = cards.slice();
    const retried = new Set();
    const answeredOnce = new Set();
    const results = [];
    let index = 0;
    const total = () => queue.length;

    function next() {
      if (index >= queue.length) return finish();
      const card = queue[index];
      let q;
      try { q = TYPES[card.type].build(card, ctx); } catch (e) { console.error(e); index++; return next(); }
      renderQuestion(q, card, (right) => {
        if (!answeredOnce.has(card.id)) {
          answeredOnce.add(card.id);
          if (!opts.test || seen(card.id)) record(card, right, log);
          results.push({ card, right, q });
        }
        if (!right && !retried.has(card.id) && !opts.test) { retried.add(card.id); queue.push(card); }
        index++;
        next();
      }, index, total(), title, back);
    }

    function finish() {
      const right = results.filter(r => r.right).length;
      const missed = results.filter(r => !r.right);
      let testLine = null;
      if (opts.test) {
        const before = state.tests[opts.test];
        state.tests[opts.test] = { last: right, best: Math.max(right, before ? before.best : 0), of: results.length, day: dayKey() };
        save();
        testLine = el('p', { class: 'quiet' }, before
          ? `Your best for this lesson is ${state.tests[opts.test].best} of ${results.length}. You can take the test again any time from Lessons.`
          : 'Saved. You can take the test again any time from Lessons.');
      }
      show(el('section', { class: 'panel summary' },
        el('h2', {}, opts.test ? title : 'Finished'),
        el('p', { class: 'lede' }, opts.test ? `${right} of ${results.length} right.` : `${right} of ${results.length} right the first time.`),
        testLine,
        missed.length ? el('div', {},
          el('h3', {}, 'To look at again'),
          el('ul', { class: 'review' }, uniqueBy(missed.map(m => m.q.explain).filter(Boolean), e => e.hanzi).map(e =>
            el('li', {}, el('span', { class: 'zh' }, e.hanzi), el('span', { class: 'py' }, e.pinyin), el('span', {}, e.english))))) : null,
        missed.length ? el('p', { class: 'quiet' }, 'These will come back on the days they are due.') : null,
        el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: back }, 'Done')),
      ));
    }
    next();
  }

  function uniqueBy(list, key) {
    const seenKeys = new Set();
    return list.filter(x => (seenKeys.has(key(x)) ? false : seenKeys.add(key(x))));
  }

  function renderQuestion(q, card, done, index, total, title, back) {
    const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': index },
      el('span', { style: `width:${(index / total) * 100}%` }));
    const head = el('div', { class: 'qhead' },
      el('span', {}, title), el('span', { class: 'count' }, `${index + 1} / ${total}`),
      el('button', { class: 'link', onclick: () => back() }, 'Stop'));
    const box = el('section', { class: 'question', 'data-type': card.type });
    box.append(el('p', { class: 'instruction' }, q.instruction));
    if (q.passage) box.append(el('p', { class: 'passage zh' }, q.passage));
    if (q.big) box.append(el('p', { class: 'big zh', lang: 'zh-CN' }, q.big));
    if (q.bigText) box.append(el('p', { class: 'big bigpy' }, q.bigText));
    if (q.sentence) box.append(el('p', { class: 'sentence zh', lang: 'zh-CN' }, q.sentence));
    if (q.sub) box.append(el('p', { class: 'sub' }, q.sub));
    if (q.text) box.append(el('p', { class: 'prompt-text' }, q.text));
    if (q.note) box.append(el('p', { class: 'note' }, q.note));

    const feedback = el('div', { class: 'feedback', 'aria-live': 'polite' });
    const nextBtn = el('button', { class: 'primary', id: 'next', hidden: true }, index + 1 >= total ? 'Finish' : 'Next');
    let answered = null;
    nextBtn.addEventListener('click', () => done(answered));

    function answer(right, message) {
      answered = right;
      fill(feedback,
        el('p', { class: right ? 'verdict right' : 'verdict wrong' }, message || (right ? 'Right.' : 'Not quite.')),
        q.explain ? el('p', { class: 'explain' },
          el('span', { class: 'zh', lang: 'zh-CN' }, q.explain.hanzi), ' ',
          el('span', { class: 'py' }, q.explain.pinyin), ' ',
          el('span', {}, q.explain.english)) : null);
      nextBtn.hidden = false;
      nextBtn.focus();
    }

    if (q.shape === 'choice') box.append(choiceUI(q, answer));
    if (q.shape === 'type') box.append(typeUI(q, answer));
    if (q.shape === 'order') box.append(orderUI(q, answer));
    if (q.shape === 'write') box.append(writeUI(q, answer));

    box.append(feedback, el('div', { class: 'actions' }, nextBtn));
    show(head, bar, box);
  }

  function choiceUI(q, answer) {
    const list = el('div', { class: 'options' + (q.hanziOptions ? ' hanzi' : '') + (q.zhOptions ? ' zhsent' : '') + (q.pinyinOptions ? ' pinyin' : '') });
    q.options.forEach((o, i) => {
      const b = el('button', { class: 'option', lang: q.hanziOptions || q.zhOptions ? 'zh-CN' : null }, o.text);
      b.addEventListener('click', () => {
        list.querySelectorAll('button').forEach(x => (x.disabled = true));
        list.children[q.answer].classList.add('is-right');
        if (i !== q.answer) b.classList.add('is-wrong');
        answer(i === q.answer);
      });
      list.append(b);
    });
    return list;
  }

  function typeUI(q, answer) {
    const input = el('input', { id: 'pinyin-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: q.placeholder, 'aria-label': 'Pinyin' });
    const check = el('button', { type: 'submit' }, 'Check');
    const hint = el('p', { class: 'quiet' }, 'Use numbers for tones: 1 2 3 4, and 5 or nothing for the neutral tone. Type v for ü.');
    const form = el('form', { class: 'typeform' }, input, check);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const r = q.check(input.value);
      if (r === 'empty') return input.focus();
      input.disabled = check.disabled = true;
      if (r === 'right') answer(true);
      else if (r === 'tones') answer(false, 'Right letters, but check the tones.');
      else answer(false);
    });
    setTimeout(() => input.focus(), 50);
    return el('div', {}, form, hint);
  }

  function orderUI(q, answer) {
    const built = el('div', { class: 'built zh', lang: 'zh-CN', 'aria-label': 'Your sentence' });
    const tray = el('div', { class: 'tray zh', lang: 'zh-CN' });
    const chosen = [];
    const check = el('button', { disabled: true }, 'Check');
    const clear = el('button', { class: 'link' }, 'Start again');

    function draw() {
      built.replaceChildren(...chosen.map((p, k) =>
        el('button', { class: 'piece placed', onclick: () => { chosen.splice(k, 1); draw(); } }, p.text)),
      chosen.length === q.pieces.length ? q.ending : '');
      tray.replaceChildren(...q.pieces.map((text, i) =>
        el('button', { class: 'piece', disabled: chosen.some(c => c.i === i), onclick: () => { chosen.push({ i, text }); draw(); } }, text)));
      check.disabled = chosen.length !== q.pieces.length;
    }
    check.addEventListener('click', () => {
      const right = chosen.map(c => c.text).join('') === q.answer;
      built.classList.add(right ? 'is-right' : 'is-wrong');
      [...built.children, ...tray.children, check, clear].forEach(b => (b.disabled = true));
      answer(right);
    });
    clear.addEventListener('click', () => { chosen.length = 0; draw(); });
    draw();
    return el('div', { class: 'order' }, built, tray, el('div', { class: 'row' }, check, clear));
  }

  function writeUI(q, answer) {
    const wrap = el('div', { class: 'write' });
    const info = el('div', { class: 'write-info' },
      el('p', { class: 'py big-py' }, q.pinyinLine),
      q.inWord ? el('p', { class: 'zh inword', lang: 'zh-CN' }, q.inWord) : null);
    const pad = el('div', { class: 'pad', id: 'pad' });
    const help = el('button', { class: 'link' }, 'Show me');
    const skip = el('button', { class: 'link' }, 'I don’t know it');
    const tip = el('p', { class: 'quiet' }, q.outline ? 'Trace over the grey outline, one stroke at a time, in the right order.' : 'Write it from memory, one stroke at a time. A hint appears after three misses.');
    wrap.append(info, pad, el('div', { class: 'row' }, help, skip), tip);

    let finished = false;
    let usedHelp = false;
    loadStrokes().then(all => {
      const size = Math.min(300, pad.clientWidth || 280);
      const css = getComputedStyle(document.documentElement);
      const color = n => css.getPropertyValue(n).trim();
      const writer = window.HanziWriter.create(pad, q.char, {
        width: size, height: size, padding: 12,
        showCharacter: false, showOutline: q.outline,
        strokeColor: color('--ink'), outlineColor: color('--line-strong'),
        drawingColor: color('--ink'), highlightColor: color('--accent'),
        drawingWidth: 18, strokeAnimationSpeed: 1.2, delayBetweenStrokes: 200,
        charDataLoader: (c, onLoad, onError) => (all[c] ? onLoad(all[c]) : onError('missing')),
      });
      const quiz = () => writer.quiz({
        showHintAfterMisses: 3,
        leniency: 1.1,
        onComplete: s => {
          if (finished) return;
          finished = true;
          help.disabled = skip.disabled = true;
          const right = !usedHelp && s.totalMistakes <= 3;
          answer(right, right ? (s.totalMistakes ? `Right, with ${s.totalMistakes} slip${s.totalMistakes > 1 ? 's' : ''}.` : 'Right.') : 'Done. This one will come back soon.');
        },
      });
      quiz();
      help.addEventListener('click', () => {
        usedHelp = true;
        writer.cancelQuiz();
        writer.showOutline();
        writer.animateCharacter({ onComplete: () => { writer.hideCharacter(); quiz(); } });
      });
      skip.addEventListener('click', () => {
        if (finished) return;
        finished = true;
        writer.cancelQuiz();
        help.disabled = skip.disabled = true;
        writer.showCharacter();
        answer(false);
      });
    }).catch(() => {
      pad.replaceChildren(el('p', { class: 'quiet' }, 'The writing pad could not load. Check your connection.'));
      skip.addEventListener('click', () => answer(false));
    });
    return wrap;
  }

  // ---------- lessons ----------

  function lessonsScreen() {
    setNav('lessons');
    const list = el('ol', { class: 'lessons' });
    for (const l of data.lessons) {
      const cards = allCards.filter(c => c.lesson === l.lesson && !TYPES[c.type].tab);
      const test = state.tests[l.lesson];
      const strong = cards.filter(c => box(c.id) >= 3).length;
      const words = l.words.map(id => ctx.wordById[id]);
      const pats = l.patterns.map(id => ctx.patternById[id]);
      const details = el('details', { class: 'lesson' },
        el('summary', {},
          el('span', { class: 'num' }, l.lesson),
          el('span', { class: 'ltitle' }, el('span', { class: 'zh', lang: 'zh-CN' }, l.title), el('span', { class: 'en' }, l.title_english)),
          el('span', { class: 'meter', title: `${strong} of ${cards.length} known well` }, el('span', { style: `width:${cards.length ? (strong / cards.length) * 100 : 0}%` })),
          test ? el('span', { class: 'tscore', title: 'Best test score' }, `${test.best}/${test.of}`) : null),
        el('div', { class: 'lesson-body' },
          el('table', { class: 'words' }, el('tbody', {}, words.map(w =>
            el('tr', {}, el('td', { class: 'zh', lang: 'zh-CN' }, w.hanzi), el('td', { class: 'py' }, w.pinyin), el('td', {}, window.HSK.shortMeaning(w.meaning)))))),
          pats.map(p => el('div', { class: 'pattern' },
            el('p', { class: 'pname' }, p.name, el('span', { class: 'structure' }, p.structure)),
            el('p', { class: 'quiet' }, p.explanation))),
          el('div', { class: 'row' },
            el('button', { onclick: () => runSession(lessonSession(l.lesson), 'Lesson ' + l.lesson, 'days', lessonsScreen) }, 'Practise this lesson'),
            el('button', { onclick: () => startTest(l.lesson, lessonsScreen) }, 'Take the lesson test')),
          el('p', { class: 'quiet' }, test
            ? `Last test: ${test.last} of ${test.of}. Best: ${test.best} of ${test.of}.`
            : `The test is ${TEST_SIZE} questions of different kinds from this lesson, each asked once.`)));
      list.append(el('li', {}, details));
    }
    show(el('section', { class: 'panel' }, el('h2', {}, 'Lessons'),
      el('p', { class: 'quiet' }, 'Tap a lesson to see its words and sentence patterns, practise it, or take its short test. The line shows how much of it you know well, and the number beside it is your best test score.'), list));
  }

  // ---------- radicals ----------
  // All 214 radicals by stroke count. Those found in HSK 1 characters are dark; tap one to see where it appears.

  let radicalsOnlyHsk = true;

  function radicalsScreen() {
    setNav('radicals');
    const R = data.radicals;
    if (!R) return show(el('p', { class: 'panel' }, 'The radicals list could not load. Check your connection and reload the page.'));
    const s = state.settings;
    const today = state.radicalDays[dayKey()];
    const done = today && today.q >= s.radicalSize;
    const start = () => runSession(dailySession('radicals'), 'Radicals', 'radicalDays', radicalsScreen);
    const hskRads = R.radicals.filter(r => r.hsk1.length);
    const knownRads = hskRads.filter(r => box('radmeaning:' + r.number) >= 3).length;
    const detail = el('div', { class: 'rad-detail', id: 'rad-detail', 'aria-live': 'polite' },
      el('p', { class: 'quiet' }, 'Tap a radical to see its meaning and the HSK 1 characters it appears in.'));
    const onlyHsk = el('input', { id: 'rad-only-hsk', type: 'checkbox', checked: radicalsOnlyHsk });
    const grid = el('div', { class: 'rad-groups' });

    const charRow = h => el('li', {},
      el('span', { class: 'zh', lang: 'zh-CN' }, h.char), el('span', { class: 'py' }, h.pinyin),
      el('span', {}, h.meaning), el('span', { class: 'quiet' }, 'L' + h.lesson));

    function pick(r, btn) {
      grid.querySelectorAll('.is-picked').forEach(b => b.classList.remove('is-picked'));
      btn.classList.add('is-picked');
      const main = r.hsk1.filter(h => h.main);
      const inside = r.hsk1.filter(h => !h.main);
      detail.replaceChildren(...[
        el('div', { class: 'rad-head' },
          el('span', { class: 'rad-big zh', lang: 'zh-CN' }, r.forms.join(' ')),
          el('div', {},
            el('p', { class: 'rad-meaning' }, r.meaning, r.pinyin ? el('span', { class: 'py' }, ' ' + r.pinyin) : null),
            el('p', { class: 'quiet' }, `Radical ${r.number} · ${r.strokes} stroke${r.strokes > 1 ? 's' : ''}`),
            r.names.map(n => el('p', { class: 'quiet' }, el('span', { class: 'zh', lang: 'zh-CN' }, n.form + ' ' + n.name), ' ' + n.pinyin)))),
        main.length ? el('div', {}, el('h4', {}, `The radical of ${main.length} HSK 1 character${main.length > 1 ? 's' : ''}`), el('ul', { class: 'rad-chars' }, main.map(charRow))) : null,
        inside.length ? el('div', {}, el('h4', {}, `Also inside ${inside.length} more`), el('ul', { class: 'rad-chars' }, inside.map(charRow))) : null,
        !r.hsk1.length ? el('p', { class: 'quiet' }, 'Not used in any HSK 1 character.') : null,
        r.other.length ? el('p', { class: 'other' }, el('span', { class: 'quiet' }, `Found in about ${r.characters_total} characters. Common ones outside HSK 1: `),
          r.other.map(o => el('span', { class: 'o' }, el('span', { class: 'zh', lang: 'zh-CN' }, o.char), ' ', el('span', { class: 'py' }, o.pinyin)))) : null,
      ].filter(Boolean));
      detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function draw() {
      radicalsOnlyHsk = onlyHsk.checked;
      const byStroke = {};
      for (const r of R.radicals) {
        if (radicalsOnlyHsk && !r.hsk1.length) continue;
        (byStroke[r.strokes] = byStroke[r.strokes] || []).push(r);
      }
      grid.replaceChildren(...Object.keys(byStroke).map(n => el('div', { class: 'rad-group' },
        el('p', { class: 'rad-count' }, n + (n === '1' ? ' stroke' : ' strokes')),
        el('div', { class: 'rad-grid' }, byStroke[n].map(r => {
          const b = el('button', { class: 'rad' + (r.hsk1.length ? ' in-hsk' : ''), lang: 'zh-CN', title: r.meaning, onclick: () => pick(r, b) },
            el('span', { class: 'zh' }, r.radical),
            r.forms.length > 1 ? el('small', { class: 'zh' }, r.forms.slice(1).join('')) : null);
          return b;
        })))));
    }
    onlyHsk.addEventListener('change', draw);
    draw();
    const c = R.counts;
    show(el('section', { class: 'home' },
      el('h1', { class: 'greeting', lang: 'zh-CN' }, '部首'),
      el('p', { class: 'lede' }, done
        ? `Radicals done for today: ${today.r} of ${today.q} right. You can do a little more if you like.`
        : `About ${s.radicalSize} questions on radicals: what they mean, what they are called, which characters have them, and which radical a character is listed under.`),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', id: 'start-radicals', onclick: start }, done ? 'Practise a little more' : 'Start radical practice')),
      el('dl', { class: 'facts' },
        el('div', {}, el('dt', {}, 'Radicals you know well'), el('dd', {}, `${knownRads} of ${hskRads.length}`)),
        el('div', {}, el('dt', {}, 'Radicals answered today'), el('dd', {}, String(today ? today.q : 0)))),
      el('h3', {}, 'All radicals'),
      el('p', { class: 'quiet' }, `There are ${c.radicals} radicals. ${c.radicals_in_hsk1} of them appear in HSK 1 characters, and ${c.radicals_main_in_hsk1} are the main radical of at least one. Small grey shapes are the forms a radical takes on the side of a character, like 氵 for 水.`),
      el('label', { class: 'toggle' }, onlyHsk, ' Only radicals found in HSK 1'),
      detail, grid));
  }

  // ---------- settings ----------

  function settingsScreen() {
    setNav('settings');
    const s = state.settings;
    const field = (label, control, help) => el('div', { class: 'field' }, el('label', { for: control.id }, label), control, help ? el('p', { class: 'quiet' }, help) : null);
    const select = (id, value, options, onchange) => {
      const e = el('select', { id }, options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
      e.addEventListener('change', () => { onchange(e.value); save(); });
      return e;
    };
    const check = (id, value, onchange) => {
      const e = el('input', { id, type: 'checkbox', checked: value });
      e.addEventListener('change', () => { onchange(e.checked); save(); });
      return e;
    };

    const backup = el('textarea', { id: 'backup', rows: 4, spellcheck: 'false', placeholder: 'Your progress code appears here, or paste one to load it.' });
    const backupMsg = el('p', { class: 'quiet', 'aria-live': 'polite' });
    const resetArea = el('div', {});

    function askReset() {
      resetArea.replaceChildren(el('p', {}, 'This clears all progress on this device. It cannot be undone.'),
        el('div', { class: 'row' },
          el('button', { class: 'danger', onclick: () => { state.cards = {}; state.days = {}; state.pinyinDays = {}; state.radicalDays = {}; state.tests = {}; save(); resetArea.replaceChildren(el('p', { class: 'quiet' }, 'Progress cleared.')); } }, 'Clear progress'),
          el('button', { class: 'link', onclick: () => resetArea.replaceChildren(resetBtn) }, 'Keep it')));
    }
    const resetBtn = el('button', { class: 'link', onclick: askReset }, 'Clear all progress…');
    resetArea.append(resetBtn);

    show(el('section', { class: 'panel settings' },
      el('h2', {}, 'Settings'),
      field('Practise lessons', select('upto', s.upTo, data.lessons.map(l => [l.lesson, l.lesson === 1 ? 'Lesson 1 only' : `Lessons 1 to ${l.lesson}`]), v => (s.upTo = +v))),
      field('Questions per day', select('size', s.size, [[10, '10'], [15, '15'], [20, '20'], [30, '30']], v => (s.size = +v))),
      field('Radical questions per day', select('radicalsize', s.radicalSize, [[5, '5'], [10, '10'], [15, '15'], [20, '20']], v => (s.radicalSize = +v))),
      field('New cards per day', select('newper', s.newPerDay, [[2, '2'], [4, '4'], [8, '8'], [12, '12'], [20, '20']], v => (s.newPerDay = +v)), 'Cards you have not seen before, for each tab. Everything else comes back when it is due.'),
      el('div', { class: 'checks' },
        el('label', {}, check('writing', s.writing, v => (s.writing = v)), ' Writing characters by hand'),
        el('label', {}, check('typing', s.typing, v => (s.typing = v)), ' Typing pinyin'),
        el('label', {}, check('showpinyin', s.showPinyin, v => (s.showPinyin = v)), ' Show pinyin under characters')),
      el('h3', {}, 'Move progress to another device'),
      el('p', { class: 'quiet' }, 'Progress is saved on this device only. To move it, copy the code here and paste it into the app on your other device.'),
      backup,
      el('div', { class: 'row' },
        el('button', { onclick: async () => {
          backup.value = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
          backup.select();
          try { await navigator.clipboard.writeText(backup.value); backupMsg.textContent = 'Copied. Paste it on your other device.'; }
          catch (e) { backupMsg.textContent = 'Select the code above and copy it.'; }
        } }, 'Copy my progress'),
        el('button', { onclick: () => {
          try {
            const s2 = JSON.parse(decodeURIComponent(escape(atob(backup.value.trim()))));
            if (!s2.cards) throw new Error();
            state = { settings: { ...defaults.settings, ...s2.settings }, cards: s2.cards, days: s2.days || {}, pinyinDays: s2.pinyinDays || {}, radicalDays: s2.radicalDays || {}, tests: s2.tests || {} };
            save();
            backupMsg.textContent = 'Progress loaded.';
          } catch (e) { backupMsg.textContent = 'That code did not work. Copy the whole code and try again.'; }
        } }, 'Load pasted progress')),
      backupMsg,
      el('h3', {}, 'Start over'),
      resetArea,
      el('p', { class: 'quiet credits' }, 'Stroke data from Make Me a Hanzi. Writing pad by Hanzi Writer.'),
    ));
  }

  // ---------- start ----------

  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
    ({ home: homeScreen, radicals: radicalsScreen, lessons: lessonsScreen, settings: settingsScreen })[b.dataset.go]();
  }));

  loadData().then(homeScreen).catch(err => {
    console.error(err);
    show(el('p', { class: 'panel' }, 'The lesson data could not load. Check your connection and reload the page.'));
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* not available here */ }
  }
})();
