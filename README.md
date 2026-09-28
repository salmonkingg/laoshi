# Laoshi (老师)

A quiet daily HSK 1 practice: reading, pinyin, handwriting, sentence order and radicals.

Open it at https://salmonkingg.github.io/laoshi/


## Files

| File | What it does |
|---|---|
| `index.html` | The page itself: top bar and an empty area the app fills in. |
| `style.css` | The look: colours (light and dark), fonts, layout. |
| `questions.js` | Every kind of question, and the pinyin helpers. Add new question types here. |
| `app.js` | Picks today's questions, shows them, saves progress on the device. |
| `data/hsk1.json`, `data/strokes.json` | Copies of the HSK 1 content set from `../hsk1/`. Copy them again if that set changes. |
| `data/radicals.json` | The 214 radicals and the HSK 1 characters each one appears in. Built in `../radicals/`. Shown in the Radicals tab. |
| `data/extra-questions.json` | Hand-written reading questions. Add more here, no code needed (format at the top of the file). |
| `lib/hanzi-writer.min.js` | Hanzi Writer 3.7.3 (MIT licence), the handwriting pad. |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable and work offline once it has a permanent web address. |
| `make-preview.py` | Builds the one-page version used for the claude.ai preview link. |
| `make-offline.py` | Builds `Laoshi.html` (give it an output path), one file with all data inside, for USB sticks and offline use. Re-run after any change. |

## How the daily session works

Each question is a "card" (for example "what does 你 mean?"). Every card sits in a box from 0 to 6.
A right answer moves it up a box and it comes back after 1, 3, 7, 14, 30 or 60 days.
A wrong answer moves it down two boxes and it comes back tomorrow, and once more at the end of the session.
Each day's session takes the cards that are due, a few new ones (2 a day by default, set in Settings), and tops up with cards seen before.
The Radicals tab works the same way with only radical questions, and keeps its own daily count and new-card limit.
Some cards wait until an easier one has been seen: pinyin and meaning-to-character come after character-to-meaning, and typing comes after pinyin.

Question types now: character to meaning, meaning to character, pinyin and tones, typing pinyin, writing characters,
sentence order, fill the gap, and hand-written reading questions.
A type marked `tab: 'retired'` in questions.js is not used (the old Pinyin tab's questions).
Radicals tab: radical meanings, radical names (三点水), radical to character, and which radical a character is listed under. Types marked `tab: 'radicals'`.

## Try it on a computer

In a terminal, in this folder: `python3 -m http.server 8000`, then open http://localhost:8000 in a browser.
