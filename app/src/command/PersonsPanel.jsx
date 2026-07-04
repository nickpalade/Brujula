import { useMemo } from 'react';
import Panel from '../shared/Panel.jsx';
import Badge from '../shared/Badge.jsx';
import Icon from '../shared/Icon.jsx';

// PersonsPanel — missing-persons registry with counts and list.
// Shows missing/found/safe with highlight when matched.

function PersonsPanel({ persons }) {
  const counts = useMemo(() => {
    const missing = persons.filter((p) => p.status === 'missing').length;
    const found = persons.filter((p) => p.status === 'found').length;
    const safe = persons.filter((p) => p.status === 'safe').length;
    return { missing, found, safe };
  }, [persons]);

  const matchedMissing = useMemo(
    () => persons.filter((p) => p.status === 'missing' && p.matched),
    [persons],
  );

  return (
    <Panel
      title="Personas"
      icon={<Icon name="people" />}
      className="cmd-rail__panel"
      actions={
        <div className="cmd-persons__counts">
          {counts.missing > 0 && (
            <Badge variant="critical" dot>
              {counts.missing} missing
            </Badge>
          )}
          {counts.found + counts.safe > 0 && (
            <Badge variant="ok" dot>
              {counts.found + counts.safe} accounted
            </Badge>
          )}
        </div>
      }
    >
      {persons.length === 0 ? (
        <div className="bru-empty">
          <span>No persons registered.</span>
        </div>
      ) : (
        <div className="cmd-persons">
          {persons.map((p) => (
            <div
              key={p.id}
              className={`cmd-persons__item${p.matched ? ' cmd-persons__item--matched' : ''}`}
            >
              <div className="cmd-persons__head">
                <span className="cmd-persons__name">{p.name}</span>
                <Badge
                  variant={p.status === 'missing' ? 'critical' : 'ok'}
                  dot
                >
                  {p.status.toUpperCase()}
                </Badge>
              </div>
              {p.detail && (
                <p className="cmd-persons__detail">
                  {p.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default PersonsPanel;
