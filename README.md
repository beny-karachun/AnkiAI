# AnkiAI

A local-first spaced-repetition study app (Anki-style) with **AI grading of your understanding** via the Gemini API. Instead of only flipping cards and self-grading, you can type an answer in your own words — including for cards that contain **pasted screenshots** — and the AI scores how well you actually understand the material, then suggests the Again/Hard/Good/Easy rating.

Everything is stored locally in your browser (IndexedDB — the browser's high-capacity local storage; screenshots and decks stay on your machine). The only network calls are to the Gemini API with your own key.

## Run it

```bash
npm install
npm run dev        # then open the printed http://localhost:5173
```

Production build: `npm run build`, then `npm run preview` (or serve `dist/` with any static server).

## Set up AI grading

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. In the app: **Settings → AI grading** — paste the key, press **Test**.
3. Pick a model:
   - **Gemini 3.1 Flash-Lite** (default) — fastest/cheapest, great for everyday grading
   - **Gemini 3.5 Flash** — stronger reasoning
   - **Gemini 3.5 Flash — Thinking (high)** — same model with `thinkingLevel: "high"` for the deepest reasoning
4. Choose grading strictness (lenient / moderate / strict) and your default answer mode.

The key is stored only in this browser's database and is sent only to `generativelanguage.googleapis.com`. It is deliberately excluded from exports.

## Features

- **Scheduling: FSRS-6** (the algorithm modern Anki uses) via `ts-fsrs` — learning steps (default 1m → 10m), relearning steps, per-deck daily new/review limits, desired-retention slider, 4 AM day rollover (configurable), learn-ahead, leech detection (auto-suspend + `leech` tag), exact interval previews on the answer buttons.
- **Deck folders with a file-manager UI (default)** — the Decks page works like a file explorer: click to select (Ctrl/Shift multi-select), double-click or Enter to study, **drag & drop** decks into/out of folders, **Ctrl+X/C/V** cut, copy, and paste (copy deep-clones a subtree with its notes and cards; review history stays with the original), F2 inline rename, Del to delete, right-click context menu, Esc to clear. A **Simple** toggle switches back to a plain list where clicking a deck studies it. Due counts roll up through folders, studying a parent studies the whole subtree, and per-deck options can apply to all subdecks.
- **Note types** — Basic, Basic + reversed, Cloze (`{{c1::text}}` / `{{c1::text::hint}}`, one card per cloze index, editor button or Ctrl+Shift+C).
- **Screenshots as content** — paste or drag images into any field; they're compressed to WebP, stored locally, rendered on cards, and sent to the AI as part of the card when grading.
- **Study** — classic flip mode or AI mode; keyboard-first (Space/Enter flip, 1–4 rate, U undo, E edit, `-` bury, `@` suspend, Ctrl+1–4 flags, `?` help); edit-during-review; multi-step undo.
- **Browser** — search syntax: free text, `deck:`, `tag:`, `is:new/learn/review/due/suspended/buried`, `flag:1-4`, `note:basic/cloze`, `prop:reps>3`, `"quoted phrases"`, `-negation`. Bulk suspend/bury/move/flag/reset/delete.
- **Stats** — today's summary, future-due forecast, year review heatmap with streaks, answer-button breakdown by maturity, card counts, true retention, AI-graded average.
- **Import/export** — full-collection or per-deck JSON backups (images included), TSV/CSV text import, "clean unused media" tool.
- Light/dark/system theme, responsive down to phone width.

## Storage notes

Data lives in IndexedDB under this origin. The app requests persistent storage so the browser won't evict it; current usage is shown in Settings. Export a JSON backup before clearing browser data — "site data" wipes include IndexedDB.

## Testing

`scripts/e2e.mjs` is a puppeteer-core smoke test (uses your installed Chrome) covering deck creation, note adding, image paste, study/rating/undo, search, stats, settings, persistence, and the Gemini error path:

```bash
npm run dev -- --port 5199 --strictPort   # in one terminal
node scripts/e2e.mjs                      # in another
```
