import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

// ---------- Toasts ----------

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (kind: ToastKind, message: string, action?: Toast['action']) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let toastSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string, action?: Toast['action']) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, action ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind} anim-in`}>
            {t.kind === 'success' && <CheckCircle2 size={17} />}
            {t.kind === 'error' && <AlertTriangle size={17} />}
            {t.kind === 'info' && <Info size={17} />}
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal-panel anim-in"
        style={wide ? { maxWidth: 760 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- Confirm dialog ----------

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  }, []);

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)}>
          <p style={{ marginTop: 0 }}>{state.message}</p>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => close(false)}>
              Cancel
            </button>
            <button
              className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => close(true)}
              autoFocus
            >
              {state.confirmLabel ?? 'OK'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// ---------- Tag input ----------

export function TagInput({
  tags,
  onChange,
  suggestions,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, '_');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };

  const matching = draft
    ? suggestions.filter((s) => s.toLowerCase().startsWith(draft.toLowerCase()) && !tags.includes(s)).slice(0, 5)
    : [];

  return (
    <div className="tag-input">
      <div className="tag-row">
        {tags.map((t) => (
          <span key={t} className="badge tag-badge">
            {t}
            <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="tag-field"
          placeholder={tags.length ? '' : 'Add tags…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {matching.length > 0 && (
        <div className="tag-suggest">
          {matching.map((s) => (
            <button key={s} onMouseDown={(e) => { e.preventDefault(); add(s); }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
