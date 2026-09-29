// questions.js
// Everything about what a question looks like lives here.
//
// The app practises "cards". A card is one small thing to remember, for example
// "what does 你 mean?" or "write the character 好". Each card has a type, and
// each type below knows two things:
//   cards(data)      -> the list of cards this type makes from the HSK 1 data
//   build(card, ctx) -> the question the page shows for one card
//
// To add a new kind of question, add a new entry to TYPES at the bottom.
// Hand-written questions (like exercise-book ones) go in data/extra-questions.json
// and need no code at all.

(function () {
  'use strict';

  // ---------- small helpers ----------

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickSome(list, n, avoid) {
    const out = [];
    for (const x of shuffle(list)) {
      if (out.length >= n) break;
      if (avoid && avoid(x, out)) continue;
      out.push(x);
    }
    return out;
  }

  // "good; well; fine" -> "good; well"
  function shortMeaning(text) {
    return text.split(/;\s*/).slice(0, 2).join('; ');
  }

  // ---------- pinyin ----------

  const TONE_MARKS = { '\u0304': 1, '\u0301': 2, '\u030C': 3, '\u0300': 4 };
  const MARK_FOR_TONE = { 1: '\u0304', 2: '\u0301', 3: '\u030C', 4: '\u0300' };

  // "hǎo" -> 3, "ma" -> 0
  function toneOf(syl) {
    for (const ch of syl.normalize('NFD')) if (TONE_MARKS[ch]) return TONE_MARKS[ch];
    return 0;
  }

  // "hǎo" -> "hao", "nǚ" -> "nü"
  function plain(syl) {
    return syl.normalize('NFD').replace(/[\u0304\u0301\u030C\u0300]/g, '').normalize('NFC');
  }

  // ("hao", 3) -> "hǎo". Rule: a or e takes the mark; in "ou" the o does; otherwise the last vowel.
  function withTone(base, tone) {
    if (!tone) return base;
    const lower = base.toLowerCase();
    let at = lower.search(/[ae]/);
    if (at < 0) at = lower.indexOf('ou');
    if (at < 0) {
      for (let i = lower.length - 1; i >= 0; i--) if ('iouü'.includes(lower[i])) { at = i; break; }
    }
    if (at < 0) return base;
    const marked = (base[at].normalize('NFD') + MARK_FOR_TONE[tone]).normalize('NFC');
    return base.slice(0, at) + marked + base.slice(at + 1);
  }

  // Rewrites a word's pinyin with new tones, keeping its spacing and capitals.
  // ("Nǐ hǎo", ["nǐ","hǎo"], [2,3]) -> "Ní hǎo"
  function retone(pinyin, syllables, tones) {
    let out = '';
    let rest = pinyin;
    syllables.forEach((syl, i) => {
      const at = rest.toLowerCase().indexOf(syl.toLowerCase());
      if (at < 0) return;
      const found = rest.slice(at, at + syl.length);
      let next = withTone(plain(found), tones[i]);
      out += rest.slice(0, at) + next;
      rest = rest.slice(at + syl.length);
    });
    return out + rest;
  }

  // Tidies typed pinyin so different ways of typing compare equal.
  function tidy(s) {
    return s.normalize('NFC').toLowerCase()
      .replace(/u:/g, 'ü').replace(/v/g, 'ü')
      .replace(/[\s'’\-·.,!?，。？！]/g, '');
  }

  // Every accepted way of typing a word: "nǐhǎo", "ni3hao3", neutral tone as nothing, 5 or 0.
  function acceptedTypings(syllableLists) {
    const ok = new Set();
    for (const syls of syllableLists) {
      ok.add(tidy(syls.join('')));
      let forms = [''];
      for (const syl of syls) {
        const base = tidy(plain(syl));
        const t = toneOf(syl);
        const endings = t ? [String(t)] : ['', '5', '0'];
        const next = [];
        for (const f of forms) for (const e of endings) next.push(f + base + e);
        forms = next.slice(0, 200);
      }
      forms.forEach(f => ok.add(f));
    }
    return ok;
  }

  function lettersOnly(s) {
    return tidy(plain(s)).replace(/[0-9]/g, '');
  }

  // ---------- splitting sentences into words ----------

  const PUNCT = /[，。？！、：；“”《》…,.?!]/;

  function tokenize(hanzi, wordSet) {
    const tokens = [];
    let i = 0;
    const chars = Array.from(hanzi);
    while (i < chars.length) {
      if (PUNCT.test(chars[i])) { tokens.push({ text: chars[i], punct: true }); i++; continue; }
      let len = Math.min(4, chars.length - i);
      for (; len > 1; len--) if (wordSet.has(chars.slice(i, i + len).join(''))) break;
      tokens.push({ text: chars.slice(i, i + len).join('') });
      i += len;
    }
    return tokens;
  }

  // ---------- question types ----------
  // ctx gives build() what it needs: ctx.data (hsk1.json), ctx.words (words in the chosen lessons),
  // ctx.wordById, ctx.charInfo, ctx.box(cardId) (how well a card is known, 0-6), ctx.settings.

  function wordCards(type, data) {
    return data.words.map(w => ({ id: type + ':' + w.id, type, lesson: w.lesson, ref: w.id }));
  }

  function explainWord(w) {
    return { hanzi: w.hanzi, pinyin: w.pinyin, english: shortMeaning(w.meaning) };
  }

  function mainPos(w) { return w.pos.split(' / ')[0]; }

  const TYPES = {

    // 你 -> "you"
    meaning: {
      label: 'Character to meaning',
      skill: 'reading',
      cards: data => wordCards('meaning', data),
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const same = ctx.words.filter(x => x.id !== w.id && mainPos(x) === mainPos(w));
        const pool = same.length >= 6 ? same : ctx.words.filter(x => x.id !== w.id);
        const decoys = pickSome(pool, 3, (x, got) =>
          shortMeaning(x.meaning) === shortMeaning(w.meaning) || got.some(g => shortMeaning(g.meaning) === shortMeaning(x.meaning)));
        const options = shuffle([w, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'What does this mean?',
          big: w.hanzi,
          sub: ctx.settings.showPinyin ? w.pinyin : '',
          options: options.map(o => ({ text: shortMeaning(o.meaning) })),
          answer: options.indexOf(w),
          explain: explainWord(w),
        };
      },
    },

    // "you" -> 你
    recall: {
      label: 'Meaning to character',
      skill: 'reading',
      cards: data => wordCards('recall', data),
      requires: card => 'meaning:' + card.ref,
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const same = ctx.words.filter(x => x.id !== w.id && x.hanzi.length === w.hanzi.length);
        const pool = same.length >= 6 ? same : ctx.words.filter(x => x.id !== w.id);
        const decoys = pickSome(pool, 3, (x, got) =>
          shortMeaning(x.meaning) === shortMeaning(w.meaning) || got.some(g => g.hanzi === x.hanzi));
        const options = shuffle([w, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'Which one means this?',
          text: shortMeaning(w.meaning),
          hanziOptions: true,
          options: options.map(o => ({ text: o.hanzi })),
          answer: options.indexOf(w),
          explain: explainWord(w),
        };
      },
    },

    // 好 -> hǎo (choose between tones)
    pinyin: {
      label: 'Pinyin and tones',
      skill: 'pinyin',
      cards: data => wordCards('pinyin', data),
      requires: card => 'meaning:' + card.ref,
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const tones = w.syllables.map(toneOf);
        const seen = new Set([w.pinyin]);
        const options = [w.pinyin];
        const toneable = w.syllables.map(s => /[aeiouü]/i.test(plain(s)));
        let tries = 0;
        if (w.syllables.length === 1) {
          const list = tones[0] === 0 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4];
          for (const t of list) {
            const p = retone(w.pinyin, w.syllables, [t]);
            if (!seen.has(p)) { seen.add(p); options.push(p); }
          }
          options.splice(4);
        } else {
          while (options.length < 4 && tries++ < 60) {
            const next = tones.map((t, i) => {
              if (!toneable[i]) return t;
              return Math.random() < 0.5 ? t : 1 + Math.floor(Math.random() * 4);
            });
            const p = retone(w.pinyin, w.syllables, next);
            if (!seen.has(p)) { seen.add(p); options.push(p); }
          }
        }
        const shuffled = shuffle(options);
        return {
          shape: 'choice',
          instruction: w.syllables.length === 1 ? 'Which tone?' : 'Which pinyin is right?',
          big: w.hanzi,
          sub: shortMeaning(w.meaning),
          pinyinOptions: true,
          options: shuffled.map(p => ({ text: p })),
          answer: shuffled.indexOf(w.pinyin),
          explain: explainWord(w),
        };
      },
    },

    // 你好 -> type "ni3hao3"
    type: {
      label: 'Typing pinyin',
      skill: 'pinyin',
      optional: 'typing',
      cards: data => wordCards('type', data),
      requires: card => 'pinyin:' + card.ref,
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const lists = [w.syllables];
        const chars = Array.from(w.hanzi);
        if (chars.length === w.syllables.length) {
          const citation = chars.map(c => ctx.charInfo[c] && ctx.charInfo[c].pinyin);
          if (citation.every(Boolean)) lists.push(citation);
        }
        const accepted = acceptedTypings(lists);
        const letters = lettersOnly(w.syllables.join(''));
        return {
          shape: 'type',
          instruction: 'Type the pinyin',
          big: w.hanzi,
          sub: shortMeaning(w.meaning),
          placeholder: 'for example ni3 hao3',
          check(input) {
            const t = tidy(input);
            if (!t) return 'empty';
            if (accepted.has(t)) return 'right';
            if (lettersOnly(t) === letters) return 'tones';
            return 'wrong';
          },
          explain: explainWord(w),
        };
      },
    },

    // Write 好 by hand
    write: {
      label: 'Writing characters',
      skill: 'writing',
      optional: 'writing',
      cards: data => data.characters.map(c => ({ id: 'write:' + c.char, type: 'write', lesson: c.lesson, ref: c.char })),
      requires: card => null,
      build(card, ctx) {
        const c = ctx.charInfo[card.ref];
        const word = c.words.map(id => ctx.wordById[id]).find(Boolean);
        return {
          shape: 'write',
          instruction: 'Write this character',
          char: c.char,
          pinyinLine: c.pinyin,
          text: shortMeaning(c.meaning.replace(/,\s*/g, '; ')),
          inWord: word && word.hanzi !== c.char ? word.hanzi.replace(c.char, '＿') + '  ' + word.pinyin : '',
          outline: ctx.box(card.id) < 2,
          explain: { hanzi: c.char, pinyin: c.pinyin, english: c.strokes + ' strokes' + (c.hint ? '. ' + c.hint : '') },
        };
      },
    },

    // Put the words in order to make the sentence
    order: {
      label: 'Sentence order',
      skill: 'sentences',
      cards(data) {
        const out = [];
        for (const p of data.patterns) p.examples.forEach((ex, i) => {
          const words = tokenize(ex.hanzi, wordSetFor(data)).filter(t => !t.punct);
          const inside = tokenize(ex.hanzi, wordSetFor(data)).slice(0, -1).some(t => t.punct);
          if (words.length >= 3 && words.length <= 8 && !inside) out.push({ id: 'order:' + p.id + ':' + i, type: 'order', lesson: p.lesson, ref: p.id, ex: i });
        });
        return out;
      },
      build(card, ctx) {
        const p = ctx.patternById[card.ref];
        const ex = p.examples[card.ex];
        const tokens = tokenize(ex.hanzi, wordSetFor(ctx.data));
        const words = tokens.filter(t => !t.punct).map(t => t.text);
        const end = tokens.length && tokens[tokens.length - 1].punct ? tokens[tokens.length - 1].text : '';
        let pieces = shuffle(words);
        for (let i = 0; i < 5 && pieces.join('') === words.join(''); i++) pieces = shuffle(words);
        return {
          shape: 'order',
          instruction: 'Put the words in order',
          text: ex.english,
          note: p.structure,
          pieces,
          answer: words.join(''),
          ending: end,
          explain: { hanzi: ex.hanzi, pinyin: ex.pinyin, english: ex.english },
        };
      },
    },

    // 我＿＿中国人。 -> 是
    fill: {
      label: 'Fill the gap',
      skill: 'sentences',
      cards(data) {
        const out = [];
        for (const p of data.patterns) p.examples.forEach((ex, i) => {
          const known = tokenize(ex.hanzi, wordSetFor(data)).filter(t => !t.punct && wordByHanzi(data)[t.text]);
          if (known.length >= 2) out.push({ id: 'fill:' + p.id + ':' + i, type: 'fill', lesson: p.lesson, ref: p.id, ex: i });
        });
        return out;
      },
      build(card, ctx) {
        const p = ctx.patternById[card.ref];
        const ex = p.examples[card.ex];
        const byHanzi = wordByHanzi(ctx.data);
        const tokens = tokenize(ex.hanzi, wordSetFor(ctx.data));
        const choices = tokens.map((t, i) => i).filter(i => !tokens[i].punct && byHanzi[tokens[i].text]);
        const gap = choices[Math.floor(Math.random() * choices.length)];
        const w = byHanzi[tokens[gap].text];
        const inSentence = new Set(tokens.map(t => t.text));
        const same = ctx.words.filter(x => mainPos(x) === mainPos(w) && !inSentence.has(x.hanzi) && x.hanzi !== w.hanzi);
        const pool = same.length >= 3 ? same : ctx.words.filter(x => !inSentence.has(x.hanzi));
        const decoys = pickSome(pool, 3, (x, got) => got.some(g => g.hanzi === x.hanzi));
        const options = shuffle([w, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'Choose the missing word',
          sentence: tokens.map((t, i) => (i === gap ? '＿＿' : t.text)).join(''),
          text: ex.english,
          hanziOptions: true,
          options: options.map(o => ({ text: o.hanzi })),
          answer: options.indexOf(w),
          explain: { hanzi: ex.hanzi, pinyin: ex.pinyin, english: ex.english },
        };
      },
    },

    // 我是中国人。 -> "I am Chinese."
    sentence: {
      label: 'Sentence meaning',
      skill: 'reading',
      cards(data) {
        const out = [];
        for (const p of data.patterns) p.examples.forEach((ex, i) => {
          if (isSentence(ex)) out.push({ id: 'sentence:' + p.id + ':' + i, type: 'sentence', lesson: p.lesson, ref: p.id, ex: i });
        });
        return out;
      },
      build(card, ctx) {
        const p = ctx.patternById[card.ref];
        const ex = p.examples[card.ex];
        const bare = s => s.replace(/\s*\(.*?\)/g, '').toLowerCase();
        const lessons = new Set(ctx.words.map(w => w.lesson));
        const all = ctx.data.patterns.flatMap(q => q.examples.map(e => ({ e, lesson: q.lesson })))
          .filter(x => x.e !== ex && isSentence(x.e) && bare(x.e.english) !== bare(ex.english));
        const near = all.filter(x => Math.abs(x.lesson - p.lesson) <= 1);
        const inRange = all.filter(x => lessons.has(x.lesson));
        const decoys = [];
        for (const group of [shuffle(near), shuffle(inRange), shuffle(all)]) {
          for (const x of group) if (decoys.length < 3 && !decoys.some(d => bare(d.english) === bare(x.e.english))) decoys.push(x.e);
        }
        const options = shuffle([ex, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'What does this sentence mean?',
          sentence: ex.hanzi,
          sub: ctx.settings.showPinyin ? ex.pinyin : '',
          options: options.map(o => ({ text: o.english })),
          answer: options.indexOf(ex),
          explain: { hanzi: ex.hanzi, pinyin: ex.pinyin, english: ex.english },
        };
      },
    },

    // 老＿ (teacher) -> 师. The wrong choices share a radical with the right one where they can,
    // so you have to look at the whole character, not only its radical.
    wordchar: {
      label: 'Complete the word',
      skill: 'reading',
      cards: data => data.words.filter(w => Array.from(w.hanzi).length >= 2)
        .map(w => ({ id: 'wordchar:' + w.id, type: 'wordchar', lesson: w.lesson, ref: w.id })),
      requires: card => 'meaning:' + card.ref,
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const chars = Array.from(w.hanzi);
        const spots = chars.map((c, i) => i).filter(i => ctx.charInfo[chars[i]]);
        const at = spots[Math.floor(Math.random() * spots.length)];
        const c = ctx.charInfo[chars[at]];
        const words = new Set(ctx.data.words.map(x => x.hanzi));
        const makesWord = x => words.has(chars.map((y, i) => (i === at ? x.char : y)).join(''));
        const lessons = new Set(ctx.words.map(x => x.lesson));
        const pool = ctx.data.characters.filter(x => x.char !== c.char && !chars.includes(x.char) && !makesWord(x));
        const sameRad = pool.filter(x => x.radical === c.radical);
        const sameSound = pool.filter(x => plain(x.pinyin) === plain(c.pinyin));
        const decoys = [];
        for (const group of [shuffle(sameRad).slice(0, 2), shuffle(sameSound).slice(0, 1), shuffle(pool.filter(x => lessons.has(x.lesson))), shuffle(pool)]) {
          for (const x of group) if (decoys.length < 3 && !decoys.includes(x)) decoys.push(x);
        }
        const options = shuffle([c, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'Which character completes the word?',
          big: chars.map((x, i) => (i === at ? '＿' : x)).join(''),
          sub: w.pinyin + ' · ' + shortMeaning(w.meaning),
          hanziOptions: true,
          options: options.map(o => ({ text: o.char })),
          answer: options.indexOf(c),
          explain: { hanzi: w.hanzi, pinyin: w.pinyin, english: shortMeaning(w.meaning) + ' · ' + c.char + ' has the radical ' + c.radical },
        };
      },
    },

    // Lesson tests only: 猫 = "cat"? 对 or 错 (the exercise book's true/false part, without pictures)
    judge: {
      label: 'True or false',
      skill: 'reading',
      tab: 'test',
      cards: data => data.words.filter(w => w.pos !== 'name').map(w => ({ id: 'judge:' + w.id, type: 'judge', lesson: w.lesson, ref: w.id })),
      build(card, ctx) {
        const w = ctx.wordById[card.ref];
        const truth = Math.random() < 0.5;
        // A wrong meaning must not share any sense with the real one (学 "study" vs 学习 "study; learn").
        const senses = x => new Set(x.meaning.toLowerCase().split(/[;,]\s*/).map(t => t.replace(/\(.*?\)/g, '').trim()));
        const mine = senses(w);
        const differs = x => x.id !== w.id && ![...senses(x)].some(t => mine.has(t));
        const same = ctx.words.filter(x => differs(x) && mainPos(x) === mainPos(w));
        const pool = same.length ? same : ctx.data.words.filter(differs);
        const shown = truth ? w : pool[Math.floor(Math.random() * pool.length)];
        return {
          shape: 'choice',
          instruction: 'Does the meaning match? Choose 对 (right) or 错 (wrong).',
          big: w.hanzi,
          text: '= ' + shortMeaning(shown.meaning),
          options: [{ text: '对  right' }, { text: '错  wrong' }],
          answer: truth ? 0 : 1,
          explain: explainWord(w),
        };
      },
    },

    // ---- Retired: these were the Pinyin tab's questions (the tab was removed 2026-09-28) ----

    // "hǎo" -> which tone is this?
    markread: {
      label: 'Reading tone marks',
      skill: 'pinyin',
      tab: 'retired', // the Pinyin tab was removed; kept in case it comes back
      cards(data) {
        const bySyl = {};
        for (const c of data.characters) {
          const py = c.pinyin.toLowerCase();
          if (!py || !/[aeiouü]/.test(plain(py))) continue;
          if (!bySyl[py]) bySyl[py] = { id: 'markread:' + py, type: 'markread', lesson: c.lesson, ref: py, chars: [] };
          bySyl[py].chars.push(c.char);
          bySyl[py].lesson = Math.min(bySyl[py].lesson, c.lesson);
        }
        return Object.values(bySyl);
      },
      build(card, ctx) {
        const t = toneOf(card.ref);
        const tones = t === 0 ? [1, 2, 3, 4, 0] : [1, 2, 3, 4];
        return {
          shape: 'choice',
          instruction: 'Which tone is this?',
          bigText: card.ref,
          options: tones.map(n => ({ text: toneName(n, ctx.data) })),
          answer: tones.indexOf(t),
          explain: { hanzi: card.chars.join(' '), pinyin: card.ref, english: toneName(t, ctx.data) },
        };
      },
    },

    // "mǎi" -> 买
    py2char: {
      label: 'Pinyin to character',
      skill: 'pinyin',
      tab: 'retired', // the Pinyin tab was removed; kept in case it comes back
      cards: data => data.characters.filter(c => c.pinyin).map(c => ({ id: 'py2char:' + c.char, type: 'py2char', lesson: c.lesson, ref: c.char })),
      build(card, ctx) {
        const c = ctx.charInfo[card.ref];
        const lessons = new Set(ctx.words.map(w => w.lesson));
        const pool = ctx.data.characters.filter(x => x.char !== c.char && x.pinyin && x.pinyin.toLowerCase() !== c.pinyin.toLowerCase() && lessons.has(x.lesson));
        const base = plain(c.pinyin).toLowerCase();
        const initial = s => (plain(s).toLowerCase().match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/) || [''])[0];
        const sameSyl = pool.filter(x => plain(x.pinyin).toLowerCase() === base);
        const sameStart = pool.filter(x => initial(x.pinyin) === initial(c.pinyin) && !sameSyl.includes(x));
        const decoys = [];
        for (const group of [shuffle(sameSyl), shuffle(sameStart), shuffle(pool)]) {
          for (const x of group) if (decoys.length < 3 && !decoys.some(d => d.char === x.char || d.pinyin === x.pinyin)) decoys.push(x);
        }
        const options = shuffle([c, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'Which character is read like this?',
          bigText: c.pinyin,
          hanziOptions: true,
          options: options.map(o => ({ text: o.char })),
          answer: options.indexOf(c),
          explain: { hanzi: c.char, pinyin: c.pinyin, english: shortMeaning(c.meaning.replace(/,\s*/g, '; ')) },
        };
      },
    },

    // 中: zhōng or zōng? (sounds that are easy to mix up)
    initial: {
      label: 'First sounds',
      skill: 'pinyin',
      tab: 'retired', // the Pinyin tab was removed; kept in case it comes back
      cards(data) {
        const lessonOf = {};
        data.characters.forEach(c => (lessonOf[c.char] = c.lesson));
        const out = [];
        data.pinyin.initial_contrasts.forEach((pair, i) => {
          for (const side of ['a', 'b']) for (const entry of pair[side]) {
            const [ch, py] = entry.split(' ');
            if (lessonOf[ch]) out.push({ id: 'initial:' + i + ':' + ch, type: 'initial', lesson: lessonOf[ch], ref: ch, pair: i, side, py });
          }
        });
        return out;
      },
      build(card, ctx) {
        const pair = ctx.data.pinyin.initial_contrasts[card.pair];
        const [x, y] = pair.pair.split(' / ');
        const from = card.side === 'a' ? x : y;
        const to = card.side === 'a' ? y : x;
        const py = card.py;
        const swapped = to + py.slice(from.length);
        const t = toneOf(py);
        const other = [1, 2, 3, 4].filter(n => n !== t)[Math.floor(Math.random() * 3)];
        const opts = [...new Set([py, swapped, withTone(plain(py), other), withTone(plain(swapped), other)])];
        const options = shuffle(opts);
        const c = ctx.charInfo[card.ref];
        return {
          shape: 'choice',
          instruction: 'Which pinyin is right? Watch the first sound and the tone.',
          big: card.ref,
          sub: c ? shortMeaning(c.meaning.replace(/,\s*/g, '; ')) : '',
          note: pair.pair.replace(' / ', ' or '),
          pinyinOptions: true,
          options: options.map(o => ({ text: o })),
          answer: options.indexOf(py),
          explain: { hanzi: card.ref, pinyin: py, english: 'starts with ' + from + ', not ' + to },
        };
      },
    },

    // 不是: bù shì or bú shì? (tone changes)
    tonechange: {
      label: 'Tone changes',
      skill: 'pinyin',
      tab: 'retired', // the Pinyin tab was removed; kept in case it comes back
      cards(data) {
        const lessonOf = {};
        data.characters.forEach(c => (lessonOf[c.char] = c.lesson));
        const out = [];
        for (const rule of data.pinyin.tone_change_rules) {
          if (!['r1', 'r2', 'r3'].includes(rule.id)) continue;
          rule.examples.forEach((ex, i) => {
            const main = ex.split(' (')[0];
            const [left, spoken] = main.split(' → ');
            const hanzi = left.split(' ')[0];
            const written = left.slice(hanzi.length + 1);
            const lesson = Math.max(1, ...Array.from(hanzi).map(ch => lessonOf[ch] || 1));
            out.push({ id: 'tonechange:' + rule.id + ':' + i, type: 'tonechange', lesson, ref: rule.id, hanzi, written, spoken: spoken || written });
          });
        }
        return out;
      },
      build(card, ctx) {
        const rule = ctx.data.pinyin.tone_change_rules.find(r => r.id === card.ref);
        let opts;
        if (card.ref === 'r1') {
          opts = [card.spoken, card.written, changeTone(card.written, 'last'), changeTone(card.written, 'first')];
        } else {
          const re = card.ref === 'r2' ? /b[ùú]/ : /y[īíì]/;
          const forms = card.ref === 'r2' ? ['bù', 'bú'] : ['yī', 'yí', 'yì'];
          opts = forms.map(f => card.spoken.replace(re, f));
        }
        const options = shuffle([...new Set(opts)]);
        return {
          shape: 'choice',
          instruction: card.ref === 'r1' ? 'How is it actually said?' : 'How is it said?',
          big: card.hanzi,
          note: card.ref === 'r1' ? 'Written: ' + card.written : '',
          pinyinOptions: true,
          options: options.map(o => ({ text: o })),
          answer: options.indexOf(card.spoken),
          explain: { hanzi: card.hanzi, pinyin: card.spoken, english: rule.rule },
        };
      },
    },

    // ---- Radicals tab only ----
    // Radicals come from data/radicals.json; only the 108 found in HSK 1 characters are practised.

    // 氵 -> "water"
    radmeaning: {
      label: 'Radical meanings',
      skill: 'radicals',
      tab: 'radicals',
      cards: data => hskRadicals(data).map(r => ({ id: 'radmeaning:' + r.number, type: 'radmeaning', lesson: firstLesson(r), ref: r.number })),
      build(card, ctx) {
        const r = radical(ctx, card.ref);
        const decoys = pickSome(hskRadicals(ctx.data).filter(x => x.number !== r.number), 3,
          (x, got) => x.meaning === r.meaning || got.some(g => g.meaning === x.meaning));
        const options = shuffle([r, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'What does this radical mean?',
          big: r.forms.join(' '),
          sub: r.names.length ? r.names.map(n => n.name).join(' · ') : '',
          options: options.map(o => ({ text: o.meaning })),
          answer: options.indexOf(r),
          explain: radicalExplain(r),
        };
      },
    },

    // 氵 -> which of these characters has it?
    radpick: {
      label: 'Radical to character',
      skill: 'radicals',
      tab: 'radicals',
      // Single-stroke radicals (一 丨 丶 丿 乙 亅) are inside almost everything, so they are left out here.
      cards: data => hskRadicals(data).filter(r => r.number > 6 && r.hsk1.some(h => h.main))
        .map(r => ({ id: 'radpick:' + r.number, type: 'radpick', lesson: firstLesson(r), ref: r.number })),
      requires: card => 'radmeaning:' + card.ref,
      build(card, ctx) {
        const r = radical(ctx, card.ref);
        const lessons = new Set(ctx.words.map(w => w.lesson));
        const has = new Set(r.hsk1.map(h => h.char));
        const main = r.hsk1.filter(h => h.main);
        const pool = main.filter(h => lessons.has(h.lesson));
        const from = pool.length ? pool : main;
        const right = from[Math.floor(Math.random() * from.length)];
        const decoys = pickSome(ctx.data.characters.filter(c => !has.has(c.char) && lessons.has(c.lesson)), 3).map(c => c.char);
        const options = shuffle([right.char, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'Which character has this radical in it?',
          big: r.forms.join(' '),
          sub: r.meaning,
          hanziOptions: true,
          options: options.map(o => ({ text: o })),
          answer: options.indexOf(right.char),
          explain: { hanzi: right.char, pinyin: right.pinyin, english: right.meaning + ' · contains ' + r.forms[0] + ' (' + r.meaning + ')' },
        };
      },
    },

    // 你 -> which radical is it listed under? (亻)
    radfind: {
      label: 'Find the radical',
      skill: 'radicals',
      tab: 'radicals',
      cards(data) {
        const out = [];
        for (const r of hskRadicals(data)) for (const h of r.hsk1) {
          if (h.main && h.char !== r.radical) out.push({ id: 'radfind:' + h.char, type: 'radfind', lesson: h.lesson, ref: h.char, rad: r.number });
        }
        return out;
      },
      requires: card => 'radmeaning:' + card.rad,
      build(card, ctx) {
        const r = radical(ctx, card.rad);
        const h = r.hsk1.find(x => x.char === card.ref);
        // Decoys must not appear anywhere in the character, so only one answer is right.
        const decoys = pickSome(hskRadicals(ctx.data).filter(x => x.number !== r.number && !x.hsk1.some(y => y.char === card.ref)), 3);
        const options = shuffle([r, ...decoys]);
        const form = x => x.forms.slice(0, 2).join(' ');
        return {
          shape: 'choice',
          instruction: 'Which radical is this character listed under?',
          big: h.char,
          sub: h.pinyin + ' · ' + h.meaning,
          hanziOptions: true,
          options: options.map(o => ({ text: form(o) })),
          answer: options.indexOf(r),
          explain: { hanzi: h.char, pinyin: h.pinyin, english: 'radical ' + r.forms.join(' ') + ', ' + r.meaning },
        };
      },
    },

    // 氵 -> 三点水
    radname: {
      label: 'Radical names',
      skill: 'radicals',
      tab: 'radicals',
      cards(data) {
        const out = [];
        for (const r of hskRadicals(data)) for (const n of r.names) out.push({ id: 'radname:' + n.form, type: 'radname', lesson: firstLesson(r), ref: r.number, form: n.form });
        return out;
      },
      requires: card => 'radmeaning:' + card.ref,
      build(card, ctx) {
        const r = radical(ctx, card.ref);
        const n = r.names.find(x => x.form === card.form);
        const all = hskRadicals(ctx.data).flatMap(x => x.names).filter(x => x.form !== n.form);
        const decoys = pickSome(all, 3, (x, got) => got.some(g => g.name === x.name));
        const options = shuffle([n, ...decoys]);
        return {
          shape: 'choice',
          instruction: 'What is this radical called?',
          big: n.form,
          sub: r.meaning,
          options: options.map(o => ({ text: o.name + '  ' + o.pinyin })),
          answer: options.indexOf(n),
          explain: { hanzi: n.form + ' ' + n.name, pinyin: n.pinyin, english: r.meaning },
        };
      },
    },

    // Hand-written questions from data/extra-questions.json
    extra: {
      label: 'Reading questions',
      skill: 'reading',
      cards: data => (data.extra || []).map(q => ({ id: 'extra:' + q.id, type: 'extra', lesson: q.lesson, ref: q.id })),
      build(card, ctx) {
        const q = ctx.extraById[card.ref];
        if (q.shape === 'order') {
          return {
            shape: 'order', instruction: q.instruction || 'Put the words in order', text: q.text || '',
            pieces: shuffle(q.pieces), answer: q.pieces.join(''), ending: q.ending || '', explain: q.explain,
          };
        }
        // keepOrder: for 对 / 错 questions, where the order of the options should stay the same.
        const listed = q.options.map((text, i) => ({ text, right: i === q.answer }));
        const options = q.keepOrder ? listed : shuffle(listed);
        return {
          shape: 'choice',
          instruction: q.instruction || 'Choose the answer',
          passage: q.passage || '',
          sentence: q.sentence || '',
          text: q.text || '',
          hanziOptions: !!q.hanziOptions,
          zhOptions: !!q.zhOptions,
          options: options.map(o => ({ text: o.text })),
          answer: options.findIndex(o => o.right),
          explain: q.explain,
        };
      },
    },
  };

  function toneName(t, data) {
    const names = { 1: '1st tone', 2: '2nd tone', 3: '3rd tone', 4: '4th tone', 0: 'neutral tone' };
    const info = data.pinyin.tones.find(x => x.tone === t);
    return names[t] + (info ? ' · ' + info.description.replace(/ \(.*\)/, '') : '');
  }

  // Turns the first or last 3rd tone in a pinyin string into a 2nd tone: "nǐ hǎo" -> "nǐ háo".
  function changeTone(py, which) {
    const chars = Array.from(py.normalize('NFD'));
    const spots = chars.map((c, i) => (c === '̌' ? i : -1)).filter(i => i >= 0);
    if (!spots.length) return py;
    chars[which === 'first' ? spots[0] : spots[spots.length - 1]] = '́';
    return chars.join('').normalize('NFC');
  }

  // Whole sentences only (not "一个杯子" = "a cup"), so every choice reads as a sentence.
  function isSentence(ex) {
    return Array.from(ex.hanzi).length >= 4 && /[。？！]$/.test(ex.hanzi) && /[.?!)]$/.test(ex.english.trim());
  }

  function hskRadicals(data) {
    return data.radicals ? data.radicals.radicals.filter(r => r.hsk1.length) : [];
  }
  function firstLesson(r) { return Math.min(...r.hsk1.map(h => h.lesson)); }
  function radical(ctx, number) { return ctx.data.radicals.radicals[number - 1]; }
  function radicalExplain(r) {
    const main = r.hsk1.filter(h => h.main).slice(0, 4).map(h => h.char).join(' ');
    return { hanzi: r.forms.join(' '), pinyin: r.pinyin, english: r.meaning + (main ? ' · in ' + main : '') };
  }

  let wordSetCache = null;
  function wordSetFor(data) {
    if (!wordSetCache) wordSetCache = new Set(data.words.map(w => w.hanzi));
    return wordSetCache;
  }
  let byHanziCache = null;
  function wordByHanzi(data) {
    if (!byHanziCache) {
      byHanziCache = {};
      for (const w of data.words) if (!byHanziCache[w.hanzi] && w.pos !== 'name') byHanziCache[w.hanzi] = w;
    }
    return byHanziCache;
  }

  window.HSK = { TYPES, toneName, shuffle, toneOf, plain, withTone, retone, tidy, acceptedTypings, tokenize, shortMeaning };
})();
