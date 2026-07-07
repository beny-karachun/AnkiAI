// Anki-style cloze deletion: {{c1::hidden text}} or {{c1::hidden text::hint}}

const CLOZE_RE = /\{\{c(\d+)::((?:[^:]|:(?!:))*?)(?:::((?:[^:]|:(?!:))*?))?\}\}/g;

export interface ClozeMatch {
  index: number;
  text: string;
  hint?: string;
}

/** All cloze indices present in a text, sorted ascending. */
export function clozeIndices(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) {
    found.add(parseInt(m[1], 10));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Render the front of a cloze card: the active cloze index becomes [...] (or
 * [hint]), every other cloze is shown filled in (Anki default behavior).
 */
export function renderClozeFront(text: string, activeIndex: number): string {
  return text.replace(CLOZE_RE, (_all, idx: string, content: string, hint?: string) => {
    if (parseInt(idx, 10) === activeIndex) {
      return `⟪CLOZE⟫${hint || '...'}⟪/CLOZE⟫`;
    }
    return content;
  });
}

/** Render the back: all clozes filled, the active one marked for highlighting. */
export function renderClozeBack(text: string, activeIndex: number): string {
  return text.replace(CLOZE_RE, (_all, idx: string, content: string) => {
    if (parseInt(idx, 10) === activeIndex) {
      return `⟪CLOZE⟫${content}⟪/CLOZE⟫`;
    }
    return content;
  });
}

/** Strip cloze markup entirely (for plain-text previews / AI prompts). */
export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_all, _idx, content: string) => content);
}

/** The hidden text of the active cloze(s) — what the answer actually is. */
export function clozeAnswers(text: string, activeIndex: number): string[] {
  const answers: string[] = [];
  for (const m of text.matchAll(CLOZE_RE)) {
    if (parseInt(m[1], 10) === activeIndex) answers.push(m[2]);
  }
  return answers;
}

/**
 * Find the next free cloze index for "add cloze" in the editor
 * (Anki's Ctrl+Shift+C behavior).
 */
export function nextClozeIndex(text: string): number {
  const idx = clozeIndices(text);
  return idx.length === 0 ? 1 : Math.max(...idx) + 1;
}

/** Wrap the given selection in a new cloze deletion. */
export function wrapInCloze(text: string, selStart: number, selEnd: number, index: number): { text: string; caret: number } {
  const before = text.slice(0, selStart);
  const sel = text.slice(selStart, selEnd);
  const after = text.slice(selEnd);
  const wrapped = `{{c${index}::${sel}}}`;
  return { text: before + wrapped + after, caret: selStart + wrapped.length - 2 };
}
