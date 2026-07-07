import Dexie, { type Table } from 'dexie';
import type {
  CardRecord,
  Deck,
  MediaRecord,
  Note,
  ReviewLogRecord,
  Settings,
} from './types';
import { DEFAULT_DECK_CONFIG, DEFAULT_SETTINGS } from './types';

export class AnkiDB extends Dexie {
  decks!: Table<Deck, string>;
  notes!: Table<Note, string>;
  cards!: Table<CardRecord, string>;
  revlog!: Table<ReviewLogRecord, string>;
  media!: Table<MediaRecord, string>;
  settings!: Table<Settings, string>;

  constructor() {
    // Original app name; renaming the IndexedDB database would orphan existing user data.
    super('ankiai');
    this.version(1).stores({
      decks: 'id, parentId, name',
      notes: 'id, deckId, *tags, createdAt',
      cards: 'id, noteId, deckId, due, state, [deckId+state]',
      revlog: 'id, cardId, deckId, review',
      media: 'id',
      settings: 'id',
    });
  }
}

export const db = new AnkiDB();

export function uid(): string {
  return crypto.randomUUID();
}

/** Ensure a default deck and settings row exist; ask for persistent storage. */
export async function initDB(): Promise<void> {
  const deckCount = await db.decks.count();
  if (deckCount === 0) {
    await db.decks.add({
      id: uid(),
      name: 'Default',
      parentId: null,
      config: { ...DEFAULT_DECK_CONFIG },
      collapsed: 0,
      createdAt: Date.now(),
    });
  }
  const settings = await db.settings.get('app');
  if (!settings) {
    await db.settings.put({ ...DEFAULT_SETTINGS });
  }
  // Ask the browser not to evict our data under storage pressure.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'app' });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
