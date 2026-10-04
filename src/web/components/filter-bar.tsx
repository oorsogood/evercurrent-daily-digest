import { Play } from 'lucide-react';
import type { AppContext } from '../../domain/contracts';
import type { Filters, Focus } from '../../domain/schema';

const FOCUS: { id: Focus; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'validation', label: 'Validation' },
  { id: 'supply', label: 'Supply' },
];

export function FilterBar({
  context,
  filters,
  onChange,
  onRun,
  running,
}: {
  context: AppContext;
  filters: Filters;
  onChange: (f: Filters) => void;
  onRun: () => void;
  running: boolean;
}) {
  const user = context.users.find((u) => u.id === filters.userId)!;
  const defaultRelationship = (userId: string, projectId: string) =>
    projectId === 'all'
      ? null
      : (context.users.find((u) => u.id === userId)?.relationships[projectId] ?? 'follower');
  return (
    <div className="filter-bar" role="group" aria-label="Digest filters">
      <div className="field">
        <label htmlFor="filter-user">User</label>
        <select
          id="filter-user"
          value={filters.userId}
          onChange={(e) =>
            onChange({
              ...filters,
              userId: e.target.value,
              relationship: defaultRelationship(e.target.value, filters.projectId),
            })
          }
        >
          {context.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-project">Project</label>
        <select
          id="filter-project"
          value={filters.projectId}
          onChange={(e) =>
            onChange({
              ...filters,
              projectId: e.target.value,
              relationship: defaultRelationship(filters.userId, e.target.value),
            })
          }
        >
          <option value="all">All Projects</option>
          {context.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-relationship">Relationship</label>
        <select
          id="filter-relationship"
          value={filters.relationship ?? 'default'}
          disabled={filters.projectId === 'all'}
          title={
            filters.projectId === 'all'
              ? `Select one project to change ${user.name.split(' ')[0]}'s relationship.`
              : undefined
          }
          onChange={(e) => onChange({ ...filters, relationship: e.target.value as 'owner' | 'follower' })}
        >
          {filters.projectId === 'all' ? (
            <option value="default">Per project</option>
          ) : (
            <>
              <option value="owner">Owner</option>
              <option value="follower">Follower</option>
            </>
          )}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-focus">Focus</label>
        <select
          id="filter-focus"
          value={filters.focus}
          onChange={(e) => onChange({ ...filters, focus: e.target.value as Focus })}
        >
          {FOCUS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <button className="run-button" onClick={onRun} disabled={running}>
        <Play size={14} aria-hidden />
        Run Digest
      </button>
    </div>
  );
}
