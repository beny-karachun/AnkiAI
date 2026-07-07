import { db, uid } from '../db';
import type { Deck, DeckConfig, DeckTreeNode, StudyCounts } from '../types';
import { DEFAULT_DECK_CONFIG } from '../types';
import { descendantIds } from './scheduler';
import { pruneOrphanMedia } from './media';

export async function createDeck(name: string, parentId: string | null): Promise<Deck> {
  const parent = parentId ? await db.decks.get(parentId) : undefined;
  const deck: Deck = {
    id: uid(),
    name: name.trim(),
    parentId,
    config: parent ? { ...parent.config } : { ...DEFAULT_DECK_CONFIG },
    collapsed: 0,
    createdAt: Date.now(),
  };
  await db.decks.add(deck);
  return deck;
}

export async function renameDeck(deckId: string, name: string): Promise<void> {
  await db.decks.update(deckId, { name: name.trim() });
}

export async function setDeckConfig(deckId: string, config: DeckConfig, applyToSubtree: boolean): Promise<void> {
  const decks = await db.decks.toArray();
  const ids = applyToSubtree ? descendantIds(decks, deckId) : [deckId];
  await db.transaction('rw', db.decks, async () => {
    for (const id of ids) {
      await db.decks.update(id, { config: { ...config } });
    }
  });
}

export async function moveDeck(deckId: string, newParentId: string | null): Promise<void> {
  await db.decks.update(deckId, { parentId: newParentId });
}

/** Delete a deck, all its subdecks, and every note/card inside. Returns card count deleted. */
export async function deleteDeckSubtree(deckId: string): Promise<number> {
  const decks = await db.decks.toArray();
  const ids = descendantIds(decks, deckId);
  let deleted = 0;
  await db.transaction('rw', db.decks, db.notes, db.cards, db.revlog, async () => {
    for (const id of ids) {
      const cards = await db.cards.where('deckId').equals(id).toArray();
      deleted += cards.length;
      await db.cards.bulkDelete(cards.map((c) => c.id));
      await db.revlog.where('deckId').equals(id).delete();
      await db.notes.where('deckId').equals(id).delete();
      await db.decks.delete(id);
    }
    // notes that lost all their cards (e.g. moved cards) — clean up
    const orphanNotes: string[] = [];
    await db.notes.each((n) => {
      orphanNotes.push(n.id);
    });
    for (const nid of orphanNotes) {
      const count = await db.cards.where('noteId').equals(nid).count();
      if (count === 0) await db.notes.delete(nid);
    }
  });
  pruneOrphanMedia().catch(() => {});
  return deleted;
}

export async function countCardsInSubtree(deckId: string): Promise<number> {
  const decks = await db.decks.toArray();
  const ids = descendantIds(decks, deckId);
  let n = 0;
  for (const id of ids) {
    n += await db.cards.where('deckId').equals(id).count();
  }
  return n;
}

function capCounts(counts: StudyCounts, config: DeckConfig): StudyCounts {
  return {
    newCount: Math.min(counts.newCount, config.newPerDay),
    learnCount: counts.learnCount,
    reviewCount: Math.min(counts.reviewCount, config.reviewsPerDay),
  };
}

function addCounts(a: StudyCounts, b: StudyCounts): StudyCounts {
  return {
    newCount: a.newCount + b.newCount,
    learnCount: a.learnCount + b.learnCount,
    reviewCount: a.reviewCount + b.reviewCount,
  };
}

/**
 * Build the display tree. A parent's totals are the sum of its own counts and
 * its children's totals, capped by the parent's own daily limits (Anki
 * semantics).
 */
export function buildDeckTree(decks: Deck[], counts: Map<string, StudyCounts>): DeckTreeNode[] {
  const byParent = new Map<string | null, Deck[]>();
  for (const d of decks) {
    const list = byParent.get(d.parentId) ?? [];
    list.push(d);
    byParent.set(d.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const build = (deck: Deck, depth: number): DeckTreeNode => {
    const children = (byParent.get(deck.id) ?? []).map((c) => build(c, depth + 1));
    const own = counts.get(deck.id) ?? { newCount: 0, learnCount: 0, reviewCount: 0 };
    const total = capCounts(
      children.reduce((acc, c) => addCounts(acc, c.totalCounts), own),
      deck.config,
    );
    return { deck, children, depth, counts: own, totalCounts: total };
  };
  return (byParent.get(null) ?? []).map((d) => build(d, 0));
}

export function deckPathName(decks: Deck[], deckId: string): string {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const parts: string[] = [];
  let cur = byId.get(deckId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(' :: ');
}

export function flattenTree(nodes: DeckTreeNode[]): DeckTreeNode[] {
  const out: DeckTreeNode[] = [];
  const walk = (n: DeckTreeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
