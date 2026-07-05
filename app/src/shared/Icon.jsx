const ICON_PATHS = {
  alert: (
    <>
      <path d="M12 3 3.8 17.2a1.6 1.6 0 0 0 1.4 2.4h13.6a1.6 1.6 0 0 0 1.4-2.4L12 3Z" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  caution: (
    <>
      <path d="M4 19h16L12 5 4 19Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  check: (
    <path d="m5 12 4 4L19 6" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  ),
  dispatch: (
    <>
      <path d="M4 7h9" />
      <path d="m10 4 3 3-3 3" />
      <path d="M20 17h-9" />
      <path d="m14 14-3 3 3 3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 19h14" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14 7 3 3" />
    </>
  ),
  expand: (
    <>
      <path d="M8 3H3v5" />
      <path d="m3 3 6 6" />
      <path d="M16 3h5v5" />
      <path d="m21 3-6 6" />
      <path d="M8 21H3v-5" />
      <path d="m3 21 6-6" />
      <path d="M16 21h5v-5" />
      <path d="m21 21-6-6" />
    </>
  ),
  collapse: (
    <>
      <path d="M9 3v6H3" />
      <path d="m9 9-6-6" />
      <path d="M15 3v6h6" />
      <path d="m15 9 6-6" />
      <path d="M9 21v-6H3" />
      <path d="m9 15-6 6" />
      <path d="M15 21v-6h6" />
      <path d="m15 15 6 6" />
    </>
  ),
  feed: (
    <>
      <path d="M5 5h14v4H5z" />
      <path d="M5 13h9v6H5z" />
      <path d="M17 13h2v6h-2z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.2 2.4 3.2 5.3 3.2 9s-1 6.6-3.2 9" />
      <path d="M12 3C9.8 5.4 8.8 8.3 8.8 12s1 6.6 3.2 9" />
    </>
  ),
  lab: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v5.5L5.5 17a2.8 2.8 0 0 0 2.5 4h8a2.8 2.8 0 0 0 2.5-4L14 8.5V3" />
      <path d="M8 16h8" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </>
  ),
  people: (
    <>
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M17 11.5a2.5 2.5 0 1 0 0-5" />
      <path d="M16.5 15c2.2.3 4 1.9 4 4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M10 18h4" />
    </>
  ),
  photo: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M8 6 9.5 4h5L16 6" />
      <circle cx="12" cy="12.5" r="3" />
    </>
  ),
  protocol: (
    <>
      <path d="M7 3h8l3 3v15H7z" />
      <path d="M14 3v4h4" />
      <path d="M10 11h5" />
      <path d="M10 15h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M18 12a6 6 0 0 0-10.5-4" />
      <path d="M6 12a6 6 0 0 0 10.5 4" />
    </>
  ),
  resource: (
    <>
      <path d="M4 8h16v10H4z" />
      <path d="M7 8V6h10v2" />
      <path d="M4 12h16" />
      <path d="M9 15h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.7a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </>
  ),
  sitrep: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m6 7 1 13h10l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </>
  ),
  trend: (
    <>
      <path d="M4 18h16" />
      <path d="M6 15l4-4 3 3 5-7" />
      <path d="M15 7h3v3" />
    </>
  ),
};

function Icon({ name, size = 18, title, className = '', strokeWidth = 1.8, ...rest }) {
  const paths = ICON_PATHS[name] ?? ICON_PATHS.protocol;
  const classes = ['bru-icon', className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {paths}
    </svg>
  );
}

export default Icon;
