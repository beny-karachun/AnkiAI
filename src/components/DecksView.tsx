import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  FolderPlus,
  FolderTree,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Scissors,
  Settings2,
  Trash2,
} from 'lucide-react';
import { db, saveSettings } from '../db';
import type { Deck, DeckConfig, DeckTreeNode, Settings } from '../types';
import {
  buildDeckTree,
  copyDeckSubtree,
  countCardsInSubtree,
  createDeck,
  deleteDeckSubtree,
  moveDeck,
  renameDeck,
  setDeckConfig,
} from '../lib/decks';
import { allDeckCounts, descendantIds, isDescendant } from '../lib/scheduler';
import { exportCollection, downloadBlob } from '../lib/importExport';
import { Modal, useConfirm, useToast } from './ui';

type Clipboard = { op: 'cut' | 'copy'; ids: string[] } | null;
type CtxMenu = { x: number; y: number; deckId: string | null } | null;

export function DecksView({
  onStudy,
  settings,
  refreshKey,
  onSettingsChanged,
}: {
  onStudy: (deckId: string) => void;
  settings: Settings;
  refreshKey: number;
  onSettingsChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const mode = settings.deckViewMode ?? 'manager';
  const isManager = mode === 'manager';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameModalDeck, setRenameModalDeck] = useState<Deck | null>(null);
  const [optionsFor, setOptionsFor] = useState<Deck | null>(null);
  const [addingUnder, setAddingUnder] = useState<{ parentId: string | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropRoot, setDropRoot] = useState(false);
  const draggingIds = useRef<string[]>([]);

  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const counts = useLiveQuery(async () => {
    const allDecks = await db.decks.toArray();
    return allDeckCounts(allDecks, Date.now(), settings.dayStartHour);
  }, [settings.dayStartHour, refreshKey]);

  const tree = useMemo(() => (decks && counts ? buildDeckTree(decks, counts) : null), [decks, counts]);
  const rows = useMemo(() => (tree ? visibleRows(tree) : []), [tree]);

  /** Drop ids whose ancestor is also in the set (they move/copy with the ancestor). */
  const topMost = useCallback(
    (ids: string[]): string[] => {
      if (!decks) return ids;
      return ids.filter((id) => !ids.some((other) => other !== id && isDescendant(decks, id, other)));
    },
    [decks],
  );

  // ---------- operations ----------

  const performMove = useCallback(
    async (ids: string[], targetId: string | null) => {
      let moved = 0;
      let skipped = 0;
      for (const id of topMost(ids)) {
        (await moveDeck(id, targetId)) ? moved++ : skipped++;
      }
      if (moved) toast.push('success', `Moved ${moved} deck${moved === 1 ? '' : 's'}.`);
      if (skipped) toast.push('info', `${skipped} skipped (a folder can't move into itself).`);
    },
    [topMost, toast],
  );

  const performCopy = useCallback(
    async (ids: string[], targetId: string | null) => {
      const top = topMost(ids);
      for (const id of top) {
        await copyDeckSubtree(id, targetId);
      }
      toast.push('success', `Pasted ${top.length} deck${top.length === 1 ? '' : 's'} (cards included).`);
    },
    [topMost, toast],
  );

  const paste = useCallback(
    async (targetId: string | null) => {
      if (!clipboard || !decks) return;
      const ids = clipboard.ids.filter((id) => decks.some((d) => d.id === id));
      if (ids.length === 0) {
        setClipboard(null);
        return;
      }
      if (clipboard.op === 'cut') {
        await performMove(ids, targetId);
        setClipboard(null);
      } else {
        await performCopy(ids, targetId);
      }
    },
    [clipboard, decks, performMove, performCopy],
  );

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      const top = topMost(ids);
      if (top.length === 0 || !decks) return;
      let cardCount = 0;
      for (const id of top) cardCount += await countCardsInSubtree(id);
      const names = top
        .map((id) => decks.find((d) => d.id === id)?.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      const ok = await confirm({
        title: `Delete ${top.length === 1 ? `"${names}"` : `${top.length} decks`}?`,
        message: `This deletes ${top.length === 1 ? 'the deck' : `${names}${top.length > 3 ? '…' : ''}`}, all subdecks, and ${cardCount} card${cardCount === 1 ? '' : 's'}. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      for (const id of top) await deleteDeckSubtree(id);
      setSelected(new Set());
      toast.push('success', 'Deleted.');
    },
    [topMost, decks, confirm, toast],
  );

  const handleExport = useCallback(
    async (deckId: string) => {
      if (!decks) return;
      const ids = descendantIds(decks, deckId);
      const blob = await exportCollection(ids);
      const name = decks.find((d) => d.id === deckId)?.name ?? 'deck';
      downloadBlob(blob, `${name.replace(/[^\w-]+/g, '_')}.ankiai.json`);
      toast.push('success', 'Deck exported.');
    },
    [decks, toast],
  );

  const setMode = async (m: 'manager' | 'simple') => {
    await saveSettings({ deckViewMode: m });
    setSelected(new Set());
    setClipboard(null);
    setCtxMenu(null);
    onSettingsChanged();
  };

  // ---------- selection ----------

  const selectRow = (id: string, e: React.MouseEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && lastClicked) {
      const ids = rows.map((r) => r.deck.id);
      const a = ids.indexOf(lastClicked);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }
    setSelected(next);
    setLastClicked(id);
  };

  // ---------- keyboard ----------

  useEffect(() => {
    if (!isManager) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (renamingId || renameModalDeck || optionsFor || addingUnder) return;
      const sel = [...selected];
      if (e.key === 'Escape') {
        setCtxMenu(null);
        if (clipboard) setClipboard(null);
        else setSelected(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(rows.map((r) => r.deck.id)));
        return;
      }
      if (sel.length > 0 && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        setClipboard({ op: 'cut', ids: sel });
        return;
      }
      if (sel.length > 0 && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setClipboard({ op: 'copy', ids: sel });
        return;
      }
      if (clipboard && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const target = sel.length === 1 && !clipboard.ids.includes(sel[0]) ? sel[0] : null;
        void paste(target);
        return;
      }
      if (sel.length > 0 && e.key === 'Delete') {
        e.preventDefault();
        void bulkDelete(sel);
        return;
      }
      if (sel.length === 1 && e.key === 'F2') {
        e.preventDefault();
        setRenamingId(sel[0]);
        return;
      }
      if (sel.length === 1 && e.key === 'Enter') {
        e.preventDefault();
        onStudy(sel[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isManager, selected, clipboard, rows, renamingId, renameModalDeck, optionsFor, addingUnder, paste, bulkDelete, onStudy]);

  // close the context menu on any click / scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  if (!decks || !counts || !tree) return <div className="view-pad">Loading…</div>;

  const totals = tree.reduce(
    (acc, n) => ({
      newCount: acc.newCount + n.totalCounts.newCount,
      learnCount: acc.learnCount + n.totalCounts.learnCount,
      reviewCount: acc.reviewCount + n.totalCounts.reviewCount,
    }),
    { newCount: 0, learnCount: 0, reviewCount: 0 },
  );

  const openCtxForRow = (deckId: string, x: number, y: number) => {
    if (isManager && !selected.has(deckId)) {
      setSelected(new Set([deckId]));
      setLastClicked(deckId);
    }
    setCtxMenu({ x, y, deckId });
  };

  return (
    <div className="view-pad decks-view anim-in">
      <div className="view-head">
        <h2>Decks</h2>
        <div className="decks-toolbar">
          <div className="seg-control" role="group" aria-label="Decks view mode">
            <button
              className={isManager ? 'active' : ''}
              onClick={() => void setMode('manager')}
              title="File manager: select, drag & drop, cut/copy/paste"
            >
              <FolderTree size={13} /> Manager
            </button>
            <button
              className={!isManager ? 'active' : ''}
              onClick={() => void setMode('simple')}
              title="Simple list: click a deck to study"
            >
              <List size={13} /> Simple
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setAddingUnder({ parentId: null })}>
            <Plus size={16} /> New deck
          </button>
        </div>
      </div>

      {isManager && (
        <p className="tooltip-hint manager-hint">
          Click to select · double-click to study · drag to move into a folder · Ctrl+X/C/V cut, copy, paste ·
          F2 rename · Del delete · right-click for more
        </p>
      )}

      <div
        className={`card-panel deck-table ${dropRoot ? 'drop-root' : ''}`}
        onClick={(e) => {
          if (isManager && !(e.target as HTMLElement).closest('.deck-row')) {
            setSelected(new Set());
          }
        }}
        onContextMenu={(e) => {
          if (!isManager) return;
          if (!(e.target as HTMLElement).closest('.deck-row')) {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, deckId: null });
          }
        }}
        onDragOver={(e) => {
          if (!isManager || draggingIds.current.length === 0) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropRoot(true);
          setDropTarget(null);
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDropRoot(false);
        }}
        onDrop={(e) => {
          if (!isManager || draggingIds.current.length === 0) return;
          e.preventDefault();
          setDropRoot(false);
          void performMove(draggingIds.current, null);
          draggingIds.current = [];
        }}
      >
        <div className="deck-row deck-row-head" aria-hidden="true">
          <span />
          <span className="deck-count-head">New</span>
          <span className="deck-count-head">Learn</span>
          <span className="deck-count-head">Due</span>
          <span />
        </div>
        {rows.map((node) => (
          <DeckRow
            key={node.deck.id}
            node={node}
            manager={isManager}
            selected={isManager && selected.has(node.deck.id)}
            cut={clipboard?.op === 'cut' && clipboard.ids.includes(node.deck.id)}
            dropping={dropTarget === node.deck.id}
            renaming={renamingId === node.deck.id}
            onStudy={onStudy}
            onSelect={(e) => selectRow(node.deck.id, e)}
            onContextMenu={(x, y) => openCtxForRow(node.deck.id, x, y)}
            onRenamed={async (name) => {
              if (name.trim() && name.trim() !== node.deck.name) {
                await renameDeck(node.deck.id, name);
              }
              setRenamingId(null);
            }}
            onDragStart={(e) => {
              const ids = selected.has(node.deck.id) ? [...selected] : [node.deck.id];
              if (!selected.has(node.deck.id)) {
                setSelected(new Set([node.deck.id]));
                setLastClicked(node.deck.id);
              }
              draggingIds.current = topMost(ids);
              e.dataTransfer.setData('text/plain', ids.join(','));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOverRow={(e) => {
              if (draggingIds.current.length === 0) return;
              const invalid =
                draggingIds.current.includes(node.deck.id) ||
                draggingIds.current.some((id) => isDescendant(decks, node.deck.id, id));
              if (invalid) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setDropTarget(node.deck.id);
              setDropRoot(false);
            }}
            onDragLeaveRow={() => {
              setDropTarget((cur) => (cur === node.deck.id ? null : cur));
            }}
            onDropRow={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(null);
              setDropRoot(false);
              void performMove(draggingIds.current, node.deck.id);
              draggingIds.current = [];
            }}
            onDragEnd={() => {
              draggingIds.current = [];
              setDropTarget(null);
              setDropRoot(false);
            }}
          />
        ))}
        <div className="deck-row deck-row-total">
          <span>Total</span>
          <span className="deck-count count-new">{totals.newCount}</span>
          <span className="deck-count count-learn">{totals.learnCount}</span>
          <span className="deck-count count-due">{totals.reviewCount}</span>
          <span />
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          manager={isManager}
          clipboard={clipboard}
          selectedCount={selected.size || 1}
          onAction={(action) => {
            const id = ctxMenu.deckId;
            setCtxMenu(null);
            const deck = id ? decks.find((d) => d.id === id) : undefined;
            switch (action) {
              case 'study':
                if (id) onStudy(id);
                break;
              case 'newDeck':
                setAddingUnder({ parentId: null });
                break;
              case 'addSub':
                setAddingUnder({ parentId: id });
                break;
              case 'rename':
                if (!deck) break;
                if (isManager) setRenamingId(deck.id);
                else setRenameModalDeck(deck);
                break;
              case 'cut':
                setClipboard({ op: 'cut', ids: selected.has(id!) ? [...selected] : [id!] });
                break;
              case 'copy':
                setClipboard({ op: 'copy', ids: selected.has(id!) ? [...selected] : [id!] });
                break;
              case 'paste':
                void paste(id);
                break;
              case 'options':
                if (deck) setOptionsFor(deck);
                break;
              case 'export':
                if (id) void handleExport(id);
                break;
              case 'delete':
                void bulkDelete(id && selected.has(id) ? [...selected] : id ? [id] : []);
                break;
            }
          }}
        />
      )}

      {renameModalDeck && (
        <RenameModal
          deck={renameModalDeck}
          onClose={() => setRenameModalDeck(null)}
          onSave={async (name) => {
            await renameDeck(renameModalDeck.id, name);
            setRenameModalDeck(null);
          }}
        />
      )}
      {addingUnder && (
        <AddDeckModal
          parentId={addingUnder.parentId}
          decks={decks}
          onClose={() => setAddingUnder(null)}
          onCreate={async (name) => {
            await createDeck(name, addingUnder.parentId);
            setAddingUnder(null);
            toast.push('success', `Deck "${name}" created.`);
          }}
        />
      )}
      {optionsFor && (
        <DeckOptionsModal
          deck={optionsFor}
          onClose={() => setOptionsFor(null)}
          onSave={async (config, subtree) => {
            await setDeckConfig(optionsFor.id, config, subtree);
            setOptionsFor(null);
            toast.push('success', 'Deck options saved.');
          }}
        />
      )}
    </div>
  );
}

function visibleRows(tree: DeckTreeNode[]): DeckTreeNode[] {
  const out: DeckTreeNode[] = [];
  const walk = (n: DeckTreeNode) => {
    out.push(n);
    if (!n.deck.collapsed) n.children.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}

// ---------- row ----------

function DeckRow({
  node,
  manager,
  selected,
  cut,
  dropping,
  renaming,
  onStudy,
  onSelect,
  onContextMenu,
  onRenamed,
  onDragStart,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  onDragEnd,
}: {
  node: DeckTreeNode;
  manager: boolean;
  selected: boolean;
  cut: boolean;
  dropping: boolean;
  renaming: boolean;
  onStudy: (deckId: string) => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number) => void;
  onRenamed: (name: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOverRow: (e: React.DragEvent) => void;
  onDragLeaveRow: () => void;
  onDropRow: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { deck, children, depth, totalCounts } = node;
  const hasWork = totalCounts.newCount + totalCounts.learnCount + totalCounts.reviewCount > 0;

  return (
    <div
      className={`deck-row ${selected ? 'row-selected-deck' : ''} ${cut ? 'row-cut' : ''} ${dropping ? 'drop-target' : ''}`}
      draggable={manager && !renaming}
      onClick={(e) => manager && onSelect(e)}
      onDoubleClick={() => manager && onStudy(deck.id)}
      onContextMenu={(e) => {
        if (!manager) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOverRow}
      onDragLeave={onDragLeaveRow}
      onDrop={onDropRow}
      onDragEnd={onDragEnd}
    >
      <span className="deck-name-cell" style={{ paddingLeft: depth * 22 }}>
        {children.length > 0 ? (
          <button
            className="icon-btn chevron-btn"
            aria-label={deck.collapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              void db.decks.update(deck.id, { collapsed: deck.collapsed ? 0 : 1 });
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {deck.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}
        {renaming ? (
          <input
            className="input rename-inline"
            defaultValue={deck.name}
            autoFocus
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenamed((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') onRenamed(deck.name);
            }}
            onBlur={(e) => onRenamed(e.target.value)}
          />
        ) : manager ? (
          <span className="deck-name deck-name-static">{deck.name}</span>
        ) : (
          <button className="deck-name" onClick={() => onStudy(deck.id)} title="Study this deck">
            {deck.name}
          </button>
        )}
      </span>
      <span className={`deck-count count-new ${totalCounts.newCount ? '' : 'count-zero'}`}>
        {totalCounts.newCount}
      </span>
      <span className={`deck-count count-learn ${totalCounts.learnCount ? '' : 'count-zero'}`}>
        {totalCounts.learnCount}
      </span>
      <span className={`deck-count count-due ${totalCounts.reviewCount ? '' : 'count-zero'}`}>
        {totalCounts.reviewCount}
      </span>
      <span className="deck-actions">
        {hasWork && (
          <button
            className="btn btn-sm btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              onStudy(deck.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Play size={13} /> Study
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={`Options for ${deck.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onContextMenu(rect.left, rect.bottom + 4);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={17} />
        </button>
      </span>
    </div>
  );
}

// ---------- context menu ----------

function ContextMenu({
  menu,
  manager,
  clipboard,
  selectedCount,
  onAction,
}: {
  menu: { x: number; y: number; deckId: string | null };
  manager: boolean;
  clipboard: Clipboard;
  selectedCount: number;
  onAction: (action: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  const onDeck = menu.deckId != null;
  const multi = selectedCount > 1;

  const items: { key: string; label: string; icon: React.ReactNode; disabled?: boolean; danger?: boolean }[] = onDeck
    ? [
        { key: 'study', label: 'Study', icon: <Play size={15} /> },
        { key: 'addSub', label: 'Add subdeck', icon: <FolderPlus size={15} /> },
        { key: 'rename', label: 'Rename', icon: <Pencil size={15} /> },
        ...(manager
          ? [
              { key: 'cut', label: multi ? `Cut ${selectedCount} decks` : 'Cut', icon: <Scissors size={15} /> },
              { key: 'copy', label: multi ? `Copy ${selectedCount} decks` : 'Copy', icon: <Copy size={15} /> },
              {
                key: 'paste',
                label: 'Paste into this deck',
                icon: <ClipboardPaste size={15} />,
                disabled: !clipboard,
              },
            ]
          : []),
        { key: 'options', label: 'Options', icon: <Settings2 size={15} /> },
        { key: 'export', label: 'Export', icon: <Download size={15} /> },
        {
          key: 'delete',
          label: multi ? `Delete ${selectedCount} decks` : 'Delete',
          icon: <Trash2 size={15} />,
          danger: true,
        },
      ]
    : [
        { key: 'newDeck', label: 'New deck', icon: <Plus size={15} /> },
        {
          key: 'paste',
          label: 'Paste here (top level)',
          icon: <ClipboardPaste size={15} />,
          disabled: !clipboard,
        },
      ];

  return (
    <div
      ref={ref}
      className="ctx-menu anim-in"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          role="menuitem"
          className={it.danger ? 'menu-danger' : ''}
          disabled={it.disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (it.disabled) return;
            onAction(it.key);
          }}
        >
          {it.icon} {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------- modals ----------

function RenameModal({
  deck,
  onClose,
  onSave,
}: {
  deck: Deck;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(deck.name);
  return (
    <Modal title="Rename deck" onClose={onClose}>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        autoFocus
      />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
          Rename
        </button>
      </div>
    </Modal>
  );
}

function AddDeckModal({
  parentId,
  decks,
  onClose,
  onCreate,
}: {
  parentId: string | null;
  decks: Deck[];
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const parent = parentId ? decks.find((d) => d.id === parentId) : null;
  return (
    <Modal title={parent ? `New subdeck of "${parent.name}"` : 'New deck'} onClose={onClose}>
      <input
        className="input"
        placeholder="Deck name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate(name.trim())}
        autoFocus
      />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
          Create
        </button>
      </div>
    </Modal>
  );
}

function DeckOptionsModal({
  deck,
  onClose,
  onSave,
}: {
  deck: Deck;
  onClose: () => void;
  onSave: (config: DeckConfig, applyToSubtree: boolean) => void;
}) {
  const [cfg, setCfg] = useState<DeckConfig>({ ...deck.config });
  const [subtree, setSubtree] = useState(false);
  const [learningSteps, setLearningSteps] = useState(deck.config.learningStepsMin.join(' '));
  const [relearningSteps, setRelearningSteps] = useState(deck.config.relearningStepsMin.join(' '));

  const parseSteps = (s: string): number[] =>
    s
      .split(/[\s,]+/)
      .map((x) => parseFloat(x))
      .filter((n) => !Number.isNaN(n) && n > 0);

  const save = () => {
    const ls = parseSteps(learningSteps);
    const rs = parseSteps(relearningSteps);
    onSave(
      {
        ...cfg,
        learningStepsMin: ls.length ? ls : [1, 10],
        relearningStepsMin: rs.length ? rs : [10],
      },
      subtree,
    );
  };

  return (
    <Modal title={`Options — ${deck.name}`} onClose={onClose}>
      <div className="options-grid">
        <label>
          <span className="field-label">New cards / day</span>
          <input
            className="input"
            type="number"
            min={0}
            value={cfg.newPerDay}
            onChange={(e) => setCfg({ ...cfg, newPerDay: Math.max(0, parseInt(e.target.value) || 0) })}
          />
        </label>
        <label>
          <span className="field-label">Max reviews / day</span>
          <input
            className="input"
            type="number"
            min={0}
            value={cfg.reviewsPerDay}
            onChange={(e) => setCfg({ ...cfg, reviewsPerDay: Math.max(0, parseInt(e.target.value) || 0) })}
          />
        </label>
        <label>
          <span className="field-label">Learning steps (minutes)</span>
          <input
            className="input"
            value={learningSteps}
            onChange={(e) => setLearningSteps(e.target.value)}
            placeholder="1 10"
          />
        </label>
        <label>
          <span className="field-label">Relearning steps (minutes)</span>
          <input
            className="input"
            value={relearningSteps}
            onChange={(e) => setRelearningSteps(e.target.value)}
            placeholder="10"
          />
        </label>
        <label className="options-span">
          <span className="field-label">
            Desired retention — {Math.round(cfg.desiredRetention * 100)}%
          </span>
          <input
            type="range"
            min={0.7}
            max={0.98}
            step={0.01}
            value={cfg.desiredRetention}
            onChange={(e) => setCfg({ ...cfg, desiredRetention: parseFloat(e.target.value) })}
          />
          <span className="tooltip-hint">
            Higher retention = shorter intervals = more daily reviews. FSRS default is 90%.
          </span>
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={subtree} onChange={(e) => setSubtree(e.target.checked)} />
        Apply to all subdecks
      </label>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
