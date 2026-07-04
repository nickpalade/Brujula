import { useEffect, useState } from 'react';
import Panel from '../shared/Panel.jsx';
import Icon from '../shared/Icon.jsx';

// TrendsPanel — displays category and location trends over the past 2 hours.
// Fetches api.getTrends(120) on mount + every 60s.
// Shows current count and delta direction.

function TrendsPanel({ getTrends }) {
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTrends(120);
      setTrends(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 60000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <Panel
        title="Tendencias (2h)"
        icon={<Icon name="trend" />}
        className="cmd-rail__panel"
      >
        <div className="bru-empty">
          <span>Sin datos</span>
        </div>
      </Panel>
    );
  }

  if (loading || !trends) {
    return (
      <Panel
        title="Tendencias (2h)"
        icon={<Icon name="trend" />}
        className="cmd-rail__panel"
      >
        <div style={{ color: 'var(--bru-text-dim)', fontSize: '13px' }}>Cargando{'…'}</div>
      </Panel>
    );
  }

  const renderDelta = (delta) => {
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const value = delta > 0 ? `+${delta}` : delta;
    return <span className={`cmd-trend__delta cmd-trend__delta--${direction}`}>{value}</span>;
  };

  return (
    <Panel
      title="Tendencias (2h)"
      icon={<Icon name="trend" />}
      className="cmd-rail__panel"
    >
      <div className="cmd-trend">
        {trends.categories && trends.categories.length > 0 && (
          <div className="cmd-trend__section">
            <div className="cmd-trend__label">
              CATEGORÍAS (Top 3)
            </div>
            <div className="cmd-trend__list">
              {trends.categories.slice(0, 3).map((cat) => (
                <div key={cat.category} className="cmd-trend__row">
                  <span className="cmd-trend__name">{cat.category}</span>
                  <div className="cmd-trend__value">
                    <span>{cat.current}</span>
                    {renderDelta(cat.delta)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {trends.locations && trends.locations.length > 0 && (
          <div className="cmd-trend__section">
            <div className="cmd-trend__label">
              UBICACIONES (Top 3)
            </div>
            <div className="cmd-trend__list">
              {trends.locations.slice(0, 3).map((loc) => (
                <div key={loc.location} className="cmd-trend__row">
                  <span className="cmd-trend__name">{loc.location}</span>
                  <div className="cmd-trend__value">
                    <span>{loc.current}</span>
                    {renderDelta(loc.delta)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default TrendsPanel;
