import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ImagePlus, Brackets } from 'lucide-react';
import { imageFilesFrom, storeImage } from '../lib/media';
import { nextClozeIndex, wrapInCloze } from '../lib/cloze';
import type { NoteType } from '../types';
import { FieldContent } from './FieldContent';
import { renderClozeFront } from '../lib/cloze';
import { useToast } from './ui';

interface FieldEditorProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clozeButton?: boolean;
  autoFocus?: boolean;
}

export function FieldEditor({ label, value, onChange, placeholder, clozeButton, autoFocus }: FieldEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);

  const insertAtCursor = (snippet: string) => {
    const ta = ref.current;
    if (!ta) {
      onChange(value + snippet);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleImages = async (files: File[]) => {
    for (const file of files) {
      try {
        const id = await storeImage(file);
        insertAtCursor(`\n[img:${id}]\n`);
      } catch {
        toast.push('error', 'Could not store the image.');
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      void handleImages(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(e.dataTransfer);
    setDragOver(false);
    if (files.length > 0) {
      e.preventDefault();
      void handleImages(files);
    }
  };

  const addCloze = () => {
    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const idx = nextClozeIndex(value);
    const { text, caret } = wrapInCloze(value, start, end, idx);
    onChange(text);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(start === end ? caret : caret, caret);
    });
  };

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      if (input.files) void handleImages(Array.from(input.files));
    };
    input.click();
  };

  return (
    <div className="field-editor">
      <div className="field-editor-head">
        <label className="field-label">{label}</label>
        <div className="field-tools">
          {clozeButton && (
            <button
              type="button"
              className="icon-btn"
              title="Wrap selection in a cloze deletion (Ctrl+Shift+C)"
              aria-label="Add cloze deletion"
              onClick={addCloze}
            >
              <Brackets size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Attach image (or just paste a screenshot)"
            aria-label="Attach image"
            onClick={pickFile}
          >
            <ImagePlus size={16} />
          </button>
        </div>
      </div>
      <textarea
        ref={ref}
        className={`textarea ${dragOver ? 'drag-over' : ''}`}
        value={value}
        placeholder={placeholder ?? 'Type here — paste screenshots directly'}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onKeyDown={(e) => {
          if (clozeButton && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            addCloze();
          }
        }}
        rows={3}
        autoFocus={autoFocus}
      />
      {/\[img:/.test(value) && (
        <div className="field-preview">
          <FieldContent text={value} />
        </div>
      )}
    </div>
  );
}

export function notePreview(type: NoteType, front: string): string {
  if (type === 'cloze') return renderClozeFront(front, 1);
  return front;
}
