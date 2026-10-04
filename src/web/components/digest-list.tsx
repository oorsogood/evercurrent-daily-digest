import { ArrowUpRight } from 'lucide-react';
import type { DigestItemView, DigestView } from '../../domain/contracts';
import type { Level } from '../../domain/schema';

type Item = DigestItemView;
const LABEL: Record<Level, string> = { high: 'High', medium: 'Medium', low: 'Low' };

function Row({ item, index, onSource }: { item: Item; index: number; onSource: (item: Item) => void }) {
  return (
    <li className="digest-item">
      <span className="item-number" aria-hidden>
        {index}
      </span>
      <div className="item-body">
        <div className="labels">
          <span className={`label level-${item.urgency}`}>Urgency: {LABEL[item.urgency]}</span>
          <span className={`label level-${item.relevance}`}>Relevance: {LABEL[item.relevance]}</span>
        </div>
        <p>{item.text}</p>
      </div>
      <button className="source-link" onClick={() => onSource(item)}>
        Source
        <ArrowUpRight size={13} aria-hidden />
        <span className="sr-only"> for item {index}</span>
      </button>
    </li>
  );
}

export function DigestList({ view, onSource }: { view: DigestView; onSource: (item: Item) => void }) {
  const items = view.digest?.items ?? [];
  const open = items.filter((i) => !i.resolved);
  const resolved = items.filter((i) => i.resolved);
  return (
    <>
      {open.length > 0 && (
        <ol className="digest-items">
          {open.map((item, i) => (
            <Row key={item.pointId} item={item} index={i + 1} onSource={onSource} />
          ))}
        </ol>
      )}
      {resolved.length > 0 && (
        <>
          <h2 className="resolved-heading">Resolved</h2>
          <ol className="digest-items">
            {resolved.map((item, i) => (
              <Row key={item.pointId} item={item} index={open.length + i + 1} onSource={onSource} />
            ))}
          </ol>
        </>
      )}
    </>
  );
}
export type { Item as DigestItem };
