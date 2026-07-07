import type { CardRecord, Deck, Note } from '../types';
import { CardState } from '../types';

// Anki-style browser search: space-separated terms are ANDed; supports
// deck:Name (incl. subdecks), tag:x, is:new|learn|review|due|suspended|buried,
// flag:0-4, note:basic|basicReversed|cloze, "quoted phrases", -negation.

interface SearchContext {
  now: number;
  dayEndMs: number;
  /** deckId -> full path name, lowercase, "parent::child" */
  deckPath: Map<string, string>;
}

export interface SearchableRow {
  card: CardRecord;
  note: Note;
}

type Predicate = (row: SearchableRow, ctx: SearchContext) => boolean;

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /-?(?:[a-zA-Z]+:)?"[^"]*"|\S+/g;
  for (const m of query.matchAll(re)) tokens.push(m[0]);
  return tokens;
}

function unquote(s: string): string {
  return s.replace(/^"|"$/g, '').replace(/^([a-zA-Z]+:)"(.*)"$/, '$1$2');
}

function termPredicate(raw: string): Predicate {
  let term = raw;
  let negate = false;
  if (term.startsWith('-') && term.length > 1) {
    negate = true;
    term = term.slice(1);
  }
  const colonIdx = term.indexOf(':');
  let pred: Predicate;

  if (colonIdx > 0) {
    const key = term.slice(0, colonIdx).toLowerCase();
    const value = unquote(term.slice(colonIdx + 1)).toLowerCase();
    switch (key) {
      case 'deck':
        pred = (row, ctx) => {
          const path = ctx.deckPath.get(row.card.deckId) ?? '';
          return path === value || path.startsWith(value + '::') || path.split('::').pop() === value;
        };
        break;
      case 'tag':
        pred = (row) =>
          value === 'none'
            ? row.note.tags.length === 0
            : row.note.tags.some((t) => t.toLowerCase() === value || t.toLowerCase().startsWith(value + '::'));
        break;
      case 'is':
        pred = (row, ctx) => {
          const c = row.card;
          const buried = c.buriedUntil != null && c.buriedUntil > ctx.now;
          switch (value) {
            case 'new':
              return c.state === CardState.New;
            case 'learn':
              return c.state === CardState.Learning || c.state === CardState.Relearning;
            case 'review':
              return c.state === CardState.Review;
            case 'due':
              return (
                c.state !== CardState.New && c.due < ctx.dayEndMs && !c.suspended && !buried
              );
            case 'suspended':
              return c.suspended === 1;
            case 'buried':
              return buried;
            default:
              return false;
          }
        };
        break;
      case 'flag': {
        const flagNum = parseInt(value, 10);
        pred = (row) => row.card.flag === flagNum;
        break;
      }
      case 'note':
        pred = (row) => row.note.type.toLowerCase() === value;
        break;
      case 'prop': {
        // prop:reps>3, prop:lapses>=2, prop:ivl>=10
        const m = value.match(/^(reps|lapses|ivl)(<=|>=|=|<|>)(\d+)$/);
        if (!m) {
          pred = () => false;
        } else {
          const [, field, op, numStr] = m;
          const num = parseInt(numStr, 10);
          pred = (row) => {
            const v =
              field === 'reps'
                ? row.card.reps
                : field === 'lapses'
                  ? row.card.lapses
                  : row.card.scheduled_days;
            switch (op) {
              case '<': return v < num;
              case '<=': return v <= num;
              case '>': return v > num;
              case '>=': return v >= num;
              default: return v === num;
            }
          };
        }
        break;
      }
      default:
        // unknown key — treat the whole term as free text
        pred = freeTextPredicate(term.toLowerCase());
    }
  } else {
    pred = freeTextPredicate(unquote(term).toLowerCase());
  }

  return negate ? (row, ctx) => !pred(row, ctx) : pred;
}

function freeTextPredicate(needle: string): Predicate {
  return (row) =>
    row.note.front.toLowerCase().includes(needle) ||
    row.note.back.toLowerCase().includes(needle) ||
    row.note.tags.some((t) => t.toLowerCase().includes(needle));
}

export function buildDeckPaths(decks: Deck[]): Map<string, string> {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const paths = new Map<string, string>();
  const pathOf = (d: Deck): string => {
    const cached = paths.get(d.id);
    if (cached) return cached;
    const parent = d.parentId ? byId.get(d.parentId) : undefined;
    const path = parent ? `${pathOf(parent)}::${d.name.toLowerCase()}` : d.name.toLowerCase();
    paths.set(d.id, path);
    return path;
  };
  decks.forEach(pathOf);
  return paths;
}

export function compileSearch(
  query: string,
  decks: Deck[],
  now: number,
  dayEndMs: number,
): (row: SearchableRow) => boolean {
  const ctx: SearchContext = { now, dayEndMs, deckPath: buildDeckPaths(decks) };
  const tokens = tokenize(query.trim());
  if (tokens.length === 0) return () => true;
  const preds = tokens.map(termPredicate);
  return (row) => preds.every((p) => p(row, ctx));
}
