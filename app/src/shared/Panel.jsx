/*
 * Panel — titled region with a header (title + optional actions) and a
 * scrollable body. Used for the action feed, advisory, detail sections.
 */
function Panel({
  title,
  icon,
  actions,
  flush = false,
  className = '',
  bodyClassName = '',
  children,
  ...rest
}) {
  const classes = ['bru-panel', className].filter(Boolean).join(' ');
  const bodyClasses = [
    'bru-panel__body',
    flush && 'bru-panel__body--flush',
    bodyClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} {...rest}>
      {(title || actions) && (
        <header className="bru-panel__head">
          <span className="bru-panel__title">
            {icon}
            {title}
          </span>
          {actions}
        </header>
      )}
      <div className={bodyClasses}>{children}</div>
    </section>
  );
}

export default Panel;
