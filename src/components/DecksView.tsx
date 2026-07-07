import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Settings2,
  Trash2,
  Download,
} from 'lucide-react';
import { db } from '../db';
import type { Deck, DeckConfig, DeckTreeNode } from '../types';
import {
  buildDeckTree,
  countCardsInSubtree,
  createDeck,
  deleteDeckSubtree,
  flattenTree,
  renameDeck,
  setDeckConfig,
} from '../lib/decks';
import { allDeckCounts } from '../lib/scheduler';
import { exportCollection, downloadBlob } from '../lib/importExport';
import { Modal, useConfirm, useToast } from './ui';

export function DecksView({
  onStudy,
  dayStartHour,
  refreshKey,
}: {
  onStudy: (deckId: string) => void;
  dayStartHour: number;
  refreshKey: number;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Deck | null>(null);
  const [optionsFor, setOptionsFor] = useState<Deck | null>(null);
  const [addingUnder, setAddingUnder] = useState<{ parentId: string | null } | null>(null);

  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const counts = useLiveQuery(
    async () => {
      const allDecks = await db.decks.toArray();
      return allDeckCounts(allDecks, Date.now(), dayStartHour);
    },
    [dayStartHour, refreshKey],
  );

  if (!decks || !counts) return <div className="view-pad">Loading…</div>;

  const tree = buildDeckTree(decks, counts);
  const rows = visibleRows(tree);
  const totals = tree.reduce(
    (acc, n) => ({
      newCount: acc.newCount + n.totalCounts.newCount,
      learnCount: acc.learnCount + n.totalCounts.learnCount,
      reviewCount: acc.reviewCount + n.totalCounts.reviewCount,
    }),
    { newCount: 0, learnCount: 0, reviewCount: 0 },
  );

  const handleDelete = async (deck: Deck) => {
    const cardCount = await countCardsInSubtree(deck.id);
    const ok = await confirm({
      title: `Delete "${deck.name}"?`,
      message: `This deletes the deck, all its subdecks, and ${cardCount} card${cardCount === 1 ? '' : 's'}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteDeckSubtree(deck.id);
    toast.push('success', `Deleted "${deck.name}".`);
  };

  const handleExport = async (deck: Deck) => {
    const ids = flattenTree(tree)
      .filter((n) => n.deck.id === deck.id || isInSubtree(tree, deck.id, n.deck.id))
      .map((n) => n.deck.id);
    const blob = await exportCollection(ids);
    downloadBlob(blob, `${deck.name.replace(/[^\w-]+/g, '_')}.ankiai.json`);
    toast.push('success', 'Deck exported.');
  };

  return (
    <div className="view-pad decks-view anim-in">
      <div className="view-head">
        <h2>Decks</h2>
        <button className="btn btn-primary" onClick={() => setAddingUnder({ parentId: null })}>
          <Plus size={16} /> New deck
        </button>
      </div>

      <div className="card-panel deck-table">
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
            onStudy={onStudy}
            menuOpen={menuFor === node.deck.id}
            onToggleMenu={() =>
              setMenuFor(menuFor === node.deck.id ? null : node.deck.id)
            }
            onRename={() => {
              setMenuFor(null);
              setRenaming(node.deck);
            }}
            onOptions={() => {
              setMenuFor(null);
              setOptionsFor(node.deck);
            }}
            onAddSub={() => {
              setMenuFor(null);
              setAddingUnder({ parentId: node.deck.id });
            }}
            onDelete={() => {
              setMenuFor(null);
              void handleDelete(node.deck);
            }}
            onExport={() => {
              setMenuFor(null);
              void handleExport(node.deck);
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

      {renaming && (
        <RenameModal
          deck={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            await renameDeck(renaming.id, name);
            setRenaming(null);
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

function isInSubtree(tree: DeckTreeNode[], rootId: string, candidateId: string): boolean {
  const find = (nodes: DeckTreeNode[]): DeckTreeNode | undefined => {
    for (const n of nodes) {
      if (n.deck.id === rootId) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return undefined;
  };
  const root = find(tree);
  if (!root) return false;
  return flattenTree([root]).some((n) => n.deck.id === candidateId);
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

function DeckRow({
  node,
  onStudy,
  menuOpen,
  onToggleMenu,
  onRename,
  onOptions,
  onAddSub,
  onDelete,
  onExport,
}: {
  node: DeckTreeNode;
  onStudy: (deckId: string) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onRename: () => void;
  onOptions: () => void;
  onAddSub: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const { deck, children, depth, totalCounts } = node;
  const hasWork =
    totalCounts.newCount + totalCounts.learnCount + totalCounts.reviewCount > 0;

  return (
    <div className="deck-row">
      <span className="deck-name-cell" style={{ paddingLeft: depth * 22 }}>
        {children.length > 0 ? (
          <button
            className="icon-btn chevron-btn"
            aria-label={deck.collapsed ? 'Expand' : 'Collapse'}
            onClick={() => db.decks.update(deck.id, { collapsed: deck.collapsed ? 0 : 1 })}
          >
            {deck.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}
        <button className="deck-name" onClick={() => onStudy(deck.id)} title="Study this deck">
          {deck.name}
        </button>
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
          <button className="btn btn-sm btn-primary" onClick={() => onStudy(deck.id)}>
            <Play size={13} /> Study
          </button>
        )}
        <span className="deck-menu-wrap">
          <button className="icon-btn" aria-label={`Options for ${deck.name}`} onClick={onToggleMenu}>
            <MoreHorizontal size={17} />
          </button>
          {menuOpen && (
            <div className="menu-pop anim-in" onMouseLeave={onToggleMenu}>
              <button onClick={onAddSub}>
                <FolderPlus size={15} /> Add subdeck
              </button>
              <button onClick={onRename}>
                <Pencil size={15} /> Rename
              </button>
              <button onClick={onOptions}>
                <Settings2 size={15} /> Options
              </button>
              <button onClick={onExport}>
                <Download size={15} /> Export
              </button>
              <button className="menu-danger" onClick={onDelete}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}
        </span>
      </span>
    </div>
  );
}

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
