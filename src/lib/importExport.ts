import { db } from '../db';
import type { CardRecord, Deck, MediaRecord, Note, ReviewLogRecord, Settings } from '../types';
import { addNote, findDuplicate } from './notes';

interface ExportedMedia {
  id: string;
  mime: string;
  /** base64, no data: prefix */
  data: string;
}

export interface CollectionExport {
  app: 'ankiai';
  version: 1;
  exportedAt: number;
  decks: Deck[];
  notes: Note[];
  cards: CardRecord[];
  revlog: ReviewLogRecord[];
  media: ExportedMedia[];
  settings?: Omit<Settings, 'apiKey'>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Export the whole collection (or a deck subtree) as a JSON blob. */
export async function exportCollection(deckIds?: string[]): Promise<Blob> {
  const allDecks = await db.decks.toArray();
  const decks = deckIds ? allDecks.filter((d) => deckIds.includes(d.id)) : allDecks;
  const includeDeck = new Set(decks.map((d) => d.id));
  const notes = (await db.notes.toArray()).filter((n) => !deckIds || includeDeck.has(n.deckId));
  const noteIds = new Set(notes.map((n) => n.id));
  const cards = (await db.cards.toArray()).filter((c) => noteIds.has(c.noteId));
  const cardIds = new Set(cards.map((c) => c.id));
  const revlog = (await db.revlog.toArray()).filter((r) => cardIds.has(r.cardId));

  const mediaIds = new Set<string>();
  const tokenRe = /\[img:([a-zA-Z0-9-]+)\]/g;
  for (const n of notes) {
    for (const m of n.front.matchAll(tokenRe)) mediaIds.add(m[1]);
    for (const m of n.back.matchAll(tokenRe)) mediaIds.add(m[1]);
  }
  const media: ExportedMedia[] = [];
  for (const id of mediaIds) {
    const rec = await db.media.get(id);
    if (rec) media.push({ id, mime: rec.mime, data: await blobToBase64(rec.blob) });
  }

  const settings = await db.settings.get('app');
  const exported: CollectionExport = {
    app: 'ankiai',
    version: 1,
    exportedAt: Date.now(),
    decks,
    notes,
    cards,
    revlog,
    media,
    ...(deckIds
      ? {}
      : settings
        ? { settings: (({ apiKey: _apiKey, ...rest }) => rest)(settings) }
        : {}),
  };
  return new Blob([JSON.stringify(exported)], { type: 'application/json' });
}

export interface ImportResult {
  decks: number;
  notes: number;
  cards: number;
  media: number;
}

/** Import a collection export. Existing rows with the same id are overwritten. */
export async function importCollection(json: string): Promise<ImportResult> {
  let data: CollectionExport;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (data.app !== 'ankiai' || !Array.isArray(data.decks)) {
    throw new Error('Not an AnkiAI export file.');
  }
  // Orphaned parentIds (deck-subtree exports) become root decks.
  const deckIds = new Set(data.decks.map((d) => d.id));
  const existingDeckIds = new Set(await db.decks.toCollection().primaryKeys());
  const decks = data.decks.map((d) =>
    d.parentId && !deckIds.has(d.parentId) && !existingDeckIds.has(d.parentId)
      ? { ...d, parentId: null }
      : d,
  );
  const mediaRecords: MediaRecord[] = (data.media ?? []).map((m) => ({
    id: m.id,
    mime: m.mime,
    blob: base64ToBlob(m.data, m.mime),
    createdAt: Date.now(),
  }));

  await db.transaction('rw', db.decks, db.notes, db.cards, db.revlog, db.media, async () => {
    await db.decks.bulkPut(decks);
    await db.notes.bulkPut(data.notes ?? []);
    await db.cards.bulkPut(data.cards ?? []);
    await db.revlog.bulkPut(data.revlog ?? []);
    await db.media.bulkPut(mediaRecords);
  });

  return {
    decks: decks.length,
    notes: data.notes?.length ?? 0,
    cards: data.cards?.length ?? 0,
    media: mediaRecords.length,
  };
}

/** Import TSV/CSV text: front<TAB>back[<TAB>tags space-separated]. */
export async function importTSV(
  text: string,
  deckId: string,
  type: 'basic' | 'basicReversed',
): Promise<{ added: number; skipped: number }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let added = 0;
  let skipped = 0;
  for (const line of lines) {
    const sep = line.includes('\t') ? '\t' : ';';
    const [front = '', back = '', tagsRaw = ''] = line.split(sep);
    if (!front.trim()) {
      skipped++;
      continue;
    }
    if (await findDuplicate(type, front)) {
      skipped++;
      continue;
    }
    await addNote(deckId, type, front.trim(), back.trim(), tagsRaw.trim() ? tagsRaw.trim().split(/\s+/) : []);
    added++;
  }
  return { added, skipped };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
