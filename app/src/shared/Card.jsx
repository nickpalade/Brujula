/*
 * Card — surface for a single incident/resource/dispatch.
 * - urgency: sets the left spine + --u-* tokens (optional).
 * - accented: show the urgency spine.
 * - alarm: pulsing red glow (live-victim / critical).
 * - interactive/selected: clickable feed cards.
 */
function Card({
  urgency,
  accented = false,
  alarm = false,
  interactive = false,
  selected = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'bru-card',
    accented && 'bru-card--accented',
    alarm && 'bru-card--alarm',
    interactive && 'bru-card--interactive',
    selected && 'bru-card--selected',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-urgency={urgency} {...rest}>
      {children}
    </div>
  );
}

export default Card;
