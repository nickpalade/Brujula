/*
 * Panel — titled region with a header (title + optional actions) and a
 * scrollable body. Used for the action feed, advisory, detail sections.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

function Panel({
  title,
  icon,
  actions,
  flush = false,
  className = '',
  bodyClassName = '',
  expandable = true,
  children,
  ...rest
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef(null);
  const wasExpandedRef = useRef(false);
  const classes = ['bru-panel', expanded && 'bru-panel--expanded', className].filter(Boolean).join(' ');
  const bodyClasses = [
    'bru-panel__body',
    flush && 'bru-panel__body--flush',
    bodyClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const toggleExpanded = useCallback(() => {
    const update = () => setExpanded((value) => !value);
    if (document.startViewTransition) document.startViewTransition(update);
    else update();
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') toggleExpanded();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded, toggleExpanded]);

  useEffect(() => {
    if (!expanded && wasExpandedRef.current) expandButtonRef.current?.focus();
    wasExpandedRef.current = expanded;
  }, [expanded]);

  return (
    <section className={classes} aria-label={title} {...rest}>
      {(title || actions) && (
        <header className="bru-panel__head">
          <span className="bru-panel__title">
            {icon}
            {title}
          </span>
          <div className="bru-panel__actions">
            {actions}
            {expandable && (
              <button
                ref={expandButtonRef}
                type="button"
                className="bru-panel__expand"
                onClick={toggleExpanded}
                aria-label={`${expanded ? 'Exit fullscreen' : 'Open fullscreen'}: ${title || 'panel'}`}
                aria-pressed={expanded}
                title={expanded ? 'Exit fullscreen (Esc)' : 'Open fullscreen'}
              >
                <Icon name={expanded ? 'collapse' : 'expand'} size={16} />
              </button>
            )}
          </div>
        </header>
      )}
      <div className={bodyClasses}>{children}</div>
    </section>
  );
}

export default Panel;
