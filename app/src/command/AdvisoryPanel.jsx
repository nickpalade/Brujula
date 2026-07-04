import Panel from '../shared/Panel.jsx';
import Badge from '../shared/Badge.jsx';
import Icon from '../shared/Icon.jsx';

/*
 * AdvisoryPanel — renders the protocol Advisory (CONTRACTS §2/§3):
 * steps + source_label + cautions. Shows a "protocols pending" empty state
 * when none is available (KB/Rares late or offline) so the panel never breaks.
 */
function AdvisoryPanel({ advisory, loading, error }) {
  return (
    <Panel
      title="Protocol Advisory"
      icon={<Icon name="protocol" />}
      className="cmd-advisory"
      actions={
        advisory?.source_label ? (
          <Badge variant="muted">{advisory.source_label}</Badge>
        ) : null
      }
    >
      {loading ? (
        <div className="cmd-sitrep-loading">
          <span className="cmd-spinner" aria-hidden="true" />
          Retrieving protocol from local knowledge base…
        </div>
      ) : error ? (
        <div className="bru-empty">
          <strong>Advisory unavailable</strong>
          <span>{error}</span>
        </div>
      ) : !advisory ? (
        <div className="bru-empty">
          <span className="cmd-advisory__pending-icon" aria-hidden="true">
            ◌
          </span>
          <strong>Protocols pending</strong>
          <span>No advisory returned for this incident type yet.</span>
        </div>
      ) : (
        <>
          <ol className="cmd-advisory__steps">
            {advisory.steps?.map((step, i) => (
              <li key={i} className="cmd-advisory__step">
                <span className="cmd-advisory__step-num">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {advisory.cautions?.length > 0 && (
            <div className="cmd-advisory__cautions">
              <span className="cmd-advisory__cautions-label">
                <Icon name="caution" />
                CAUTIONS
              </span>
              <ul>
                {advisory.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export default AdvisoryPanel;
