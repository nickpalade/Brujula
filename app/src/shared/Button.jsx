/*
 * Button — generic action button for both stations.
 * variant: "default" | "primary" | "confirm" | "danger" | "ghost"
 * size:    "sm" | "md" | "lg"
 */
function Button({
  variant = 'default',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'bru-btn',
    variant !== 'default' && `bru-btn--${variant}`,
    size !== 'md' && `bru-btn--${size}`,
    block && 'bru-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

export default Button;
