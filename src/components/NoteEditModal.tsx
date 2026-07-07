import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Note } from '../types';
import { updateNote, allTags, findDuplicate } from '../lib/notes';
import { Modal, TagInput, useToast } from './ui';
import { FieldEditor } from './NoteFields';
import { DeckPicker } from './DeckPicker';

const TYPE_LABELS: Record<Note['type'], string> = {
  basic: 'Basic',
  basicReversed: 'Basic (and reversed card)',
  cloze: 'Cloze',
};

export function NoteEditModal({
  noteId,
  onClose,
  onSaved,
}: {
  noteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState<Note | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [deckId, setDeckId] = useState('');
  const [dupWarn, setDupWarn] = useState(false);
  const suggestions = useLiveQuery(() => allTags(), []) ?? [];

  useEffect(() => {
    void db.notes.get(noteId).then((n) => {
      if (!n) {
        onClose();
        return;
      }
      setNote(n);
      setFront(n.front);
      setBack(n.back);
      setTags(n.tags);
      setDeckId(n.deckId);
    });
  }, [noteId, onClose]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(async () => {
      const dup = await findDuplicate(note.type, front, note.id);
      setDupWarn(!!dup);
    }, 400);
    return () => window.clearTimeout(t);
  }, [front, note]);

  if (!note) return null;

  const isCloze = note.type === 'cloze';

  const save = async () => {
    if (!front.trim()) {
      toast.push('error', 'The front field cannot be empty.');
      return;
    }
    await updateNote(note.id, { front, back, tags, deckId });
    toast.push('success', 'Note saved.');
    onSaved();
  };

  return (
    <Modal title={`Edit note — ${TYPE_LABELS[note.type]}`} onClose={onClose} wide>
      <div className="edit-note-grid">
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
        autoFocus
      />
      {dupWarn && <div className="dup-warning">Another note of this type has the same front.</div>}
      <FieldEditor label={isCloze ? 'Extra (shown on the back)' : 'Back'} value={back} onChange={setBack} />
      <span className="field-label">Tags</span>
      <TagInput tags={tags} onChange={setTags} suggestions={suggestions} />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}
