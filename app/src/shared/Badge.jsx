import { URGENCY_LABEL } from './urgency.js';

/*
 * Badge — compact status/label pill.
 * Generic tone via `variant`: "default"|"ok"|"warn"|"accent"|"muted"|"critical".
 * For incident urgency pass `urgency` — it colors via [data-urgency] tokens and
 * (optionally) pulses for critical.
 */
function Badge({
  variant,
  urgency,
  pulse = false,
  dot = false,
  className = '',
  children,
  ...rest
}) {
  const isUrgency = Boolean(urgency);
  const classes = [
    'bru-badge',
    isUrgency && 'bru-badge--urgency',
    variant && `bru-badge--${variant}`,
    pulse && 'bru-badge--pulse',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      data-urgency={isUrgency ? urgency : undefined}
      {...rest}
    >
      {dot &&
        (isUrgency ? (
          <span className="bru-badge__glyph" data-urgency={urgency} aria-hidden="true" />
        ) : (
          <span className="bru-badge__dot" aria-hidden="true" />
        ))}
      {children ?? (isUrgency ? URGENCY_LABEL[urgency] ?? urgency : null)}
    </span>
  );
}

export default Badge;
