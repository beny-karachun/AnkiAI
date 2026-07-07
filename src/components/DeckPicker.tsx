import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { buildDeckTree, flattenTree } from '../lib/decks';

/** Hierarchical deck <select>. Self-corrects when value is empty or refers to a deleted deck. */
export function DeckPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (deckId: string) => void;
  id?: string;
}) {
  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const rows = decks ? flattenTree(buildDeckTree(decks, new Map())) : null;

  // Autoselect must match the option the <select> visually shows first.
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    if (!value || !rows.some((r) => r.deck.id === value)) {
      onChange(rows[0].deck.id);
    }
  }, [rows, value, onChange]);

  if (!rows) return <select className="select" disabled />;
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {rows.map((n) => (
        <option key={n.deck.id} value={n.deck.id}>
          {' '.repeat(n.depth * 3)}
          {n.deck.name}
        </option>
      ))}
    </select>
  );
}
