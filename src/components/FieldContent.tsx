import { useEffect, useState, type ReactNode } from 'react';
import { mediaUrl } from '../lib/media';

function MediaImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    mediaUrl(id).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (missing) return <span className="media-missing">[missing image]</span>;
  if (!url) return <span className="media-loading" aria-hidden="true" />;
  return <img src={url} alt="" className="field-image" loading="lazy" />;
}

/** Inline markdown-lite: **bold**, *italic*, `code`. Returns React nodes (no HTML injection). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = m.index! + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Renders a note field: [img:id] tokens become images, ⟪CLOZE⟫…⟪/CLOZE⟫
 * markers (from cloze rendering) become highlighted spans, newlines become
 * line breaks, plus markdown-lite inline formatting.
 */
export function FieldContent({ text }: { text: string }) {
  const segments = text.split(/(\[img:[a-zA-Z0-9-]+\]|⟪CLOZE⟫[\s\S]*?⟪\/CLOZE⟫)/g);
  const out: ReactNode[] = [];
  segments.forEach((seg, si) => {
    if (!seg) return;
    const img = seg.match(/^\[img:([a-zA-Z0-9-]+)\]$/);
    if (img) {
      out.push(<MediaImage key={`img-${si}`} id={img[1]} />);
      return;
    }
    const cloze = seg.match(/^⟪CLOZE⟫([\s\S]*?)⟪\/CLOZE⟫$/);
    if (cloze) {
      out.push(
        <span key={`cz-${si}`} className="cloze-mark">
          {cloze[1]}
        </span>,
      );
      return;
    }
    const lines = seg.split('\n');
    lines.forEach((line, li) => {
      if (li > 0) out.push(<br key={`br-${si}-${li}`} />);
      out.push(...renderInline(line, `t-${si}-${li}`));
    });
  });
  return <div className="field-content">{out}</div>;
}
