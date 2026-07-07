import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus } from 'lucide-react';
import { db } from '../db';
import type { NoteType } from '../types';
import { addNote, allTags, findDuplicate } from '../lib/notes';
import { clozeIndices } from '../lib/cloze';
import { FieldEditor } from './NoteFields';
import { DeckPicker } from './DeckPicker';
import { TagInput, useToast } from './ui';

export function AddNoteView({
  defaultDeckId,
  onDeckUsed,
  onAdded,
  originDeckId,
  onBack,
}: {
  defaultDeckId: string;
  onDeckUsed: (deckId: string) => void;
  onAdded: () => void;
  /** set when the user arrived via "Add note here" — enables the Go-back button */
  originDeckId?: string | null;
  onBack?: (deckId: string) => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<NoteType>('basic');
  const [deckId, setDeckId] = useState(defaultDeckId);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [dupWarn, setDupWarn] = useState(false);
  const suggestions = useLiveQuery(() => allTags(), []) ?? [];
  const originDeck = useLiveQuery(
    async () => (originDeckId ? await db.decks.get(originDeckId) : undefined),
    [originDeckId],
  );

  useEffect(() => {
    setDeckId(defaultDeckId);
  }, [defaultDeckId]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      setDupWarn(front.trim() ? !!(await findDuplicate(type, front)) : false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [front, type]);

  const isCloze = type === 'cloze';
  const clozeCount = isCloze ? clozeIndices(front).length : 0;

  const save = async () => {
    if (!front.trim()) {
      toast.push('error', 'The front field cannot be empty.');
      return;
    }
    if (isCloze && clozeCount === 0) {
      toast.push('error', 'Add at least one cloze deletion: select text and press the cloze button (or Ctrl+Shift+C).');
      return;
    }
    await addNote(deckId, type, front, back, tags);
    onDeckUsed(deckId);
    onAdded();
    const cardCount = type === 'basicReversed' ? 2 : isCloze ? clozeCount : 1;
    toast.push('success', `Added — ${cardCount} card${cardCount === 1 ? '' : 's'} created.`);
    setFront('');
    setBack('');
    // keep type, deck, and tags for rapid entry (Anki behavior)
  };

  // Ctrl+Enter saves
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="view-pad add-view anim-in">
      <div className="view-head">
        {originDeck && onBack && (
          <button
            className="btn btn-sm btn-secondary add-back-btn"
            onClick={() => onBack(originDeck.id)}
            title={`Back to the "${originDeck.name}" folder`}
          >
            <ArrowLeft size={14} /> Back to {originDeck.name}
          </button>
        )}
        <h2>Add note</h2>
      </div>
      <div className="card-panel add-panel">
        <div className="add-selectors">
          <label>
            <span className="field-label">Type</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as NoteType)}>
              <option value="basic">Basic</option>
              <option value="basicReversed">Basic (and reversed card)</option>
              <option value="cloze">Cloze</option>
            </select>
          </label>
          <label>
            <span className="field-label">Deck</span>
            <DeckPicker value={deckId} onChange={setDeckId} />
          </label>
        </div>

        <FieldEditor
          label={isCloze ? 'Text (use {{c1::…}} for deletions)' : 'Front'}
          value={front}
          onChange={setFront}
          clozeButton={isCloze}
          placeholder={
            isCloze
              ? 'The mitochondria is the {{c1::powerhouse}} of the cell — paste screenshots too'
              : 'Question — paste screenshots directly into this field'
          }
          autoFocus
        />
        {dupWarn && <div className="dup-warning">A note of this type with the same front already exists.</div>}
        {isCloze && clozeCount > 0 && (
          <div className="tooltip-hint" style={{ marginTop: -8, marginBottom: 10 }}>
            {clozeCount} cloze deletion{clozeCount === 1 ? '' : 's'} → {clozeCount} card{clozeCount === 1 ? '' : 's'}
          </div>
        )}
        <FieldEditor
          label={isCloze ? 'Extra (shown on the back)' : 'Back'}
          value={back}
          onChange={setBack}
          placeholder={isCloze ? 'Optional extra context' : 'Answer'}
        />
        <span className="field-label">Tags</span>
        <TagInput tags={tags} onChange={setTags} suggestions={suggestions} />
        <div className="add-actions">
          <span className="tooltip-hint">Ctrl+Enter to add quickly</span>
          <button className="btn btn-primary" onClick={() => void save()}>
            <Plus size={16} /> Add note
          </button>
        </div>
      </div>
    </div>
  );
}
