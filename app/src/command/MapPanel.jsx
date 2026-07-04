// Offline incident map — plots every incident that has coordinates (phone GPS
// or the hub's gazetteer fallback) on pre-downloaded OSM tiles served by the
// hub at /tiles/{z}/{x}/{y}.png (fetched once with `npm run fetch:tiles`).
// Zero network at demo time: tiles, Leaflet (bundled), and data are all local.
//
// Plain Leaflet managed through refs (no react-leaflet): one map instance for
// the component's life, markers reconciled on every sync tick. Circle markers
// (not icon markers) so no image assets are needed and urgency color is a
// simple stroke/fill.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Panel from '../shared/Panel.jsx';
import Badge from '../shared/Badge.jsx';
import { CATEGORY_LABEL, URGENCY_LABEL } from '../shared/urgency.js';

// Mirror of the urgency palette in shared/tokens.css (Leaflet paints SVG
// strokes/fills directly, so CSS variables don't reach it).
const URGENCY_COLOR = {
  critical: '#ff3b47',
  high: '#ff8c26',
  medium: '#f5c518',
  low: '#4da3ff',
};

// Demo region default view (Vargas coast) — used until incidents give us
// bounds to fit. Zooms and bounds match what scripts/fetch-tiles.mjs
// prefetches; panning is clamped so the coordinator can't scroll into
// un-downloaded blank space.
const DEFAULT_CENTER = [10.6, -66.93];
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 11;
const MAX_ZOOM = 16;
const REGION_BOUNDS = L.latLngBounds([10.55, -67.05], [10.65, -66.75]);

function hasCoords(incident) {
  return Number.isFinite(incident?.lat) && Number.isFinite(incident?.lon);
}

// Build popup content as DOM nodes (textContent) so summaries can never
// inject HTML into the map.
function popupContent(incident) {
  const root = document.createElement('div');
  root.className = 'cmd-map__popup';

  const head = document.createElement('strong');
  head.textContent = `${CATEGORY_LABEL[incident.category] ?? incident.category} · ${URGENCY_LABEL[incident.urgency] ?? incident.urgency}`;
  root.appendChild(head);

  if (incident.location) {
    const loc = document.createElement('div');
    loc.className = 'cmd-map__popup-loc';
    loc.textContent = incident.location;
    root.appendChild(loc);
  }

  if (incident.summary) {
    const sum = document.createElement('div');
    sum.textContent = incident.summary;
    root.appendChild(sum);
  }

  return root;
}

function MapPanel({ incidents = [], onSelect }) {
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // incident id -> L.circleMarker
  const didFitRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const plotted = incidents.filter(hasCoords);
  const unplotted = incidents.length - plotted.length;

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: REGION_BOUNDS.pad(0.15),
      maxBoundsViscosity: 0.8,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO (tiles pre-downloaded)',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = new Map();
    };
  }, []);

  // Reconcile markers on every sync tick: add new, update changed, drop gone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set();

    for (const inc of plotted) {
      seen.add(inc.id);
      const color = URGENCY_COLOR[inc.urgency] ?? URGENCY_COLOR.low;
      const dispatched = inc.status !== 'open';
      const style = {
        radius: inc.urgency === 'critical' ? 11 : 8,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: dispatched ? 0.25 : 0.65,
        opacity: dispatched ? 0.5 : 1,
      };
      let marker = markers.get(inc.id);
      if (!marker) {
        marker = L.circleMarker([inc.lat, inc.lon], style)
          .addTo(map)
          .on('click', () => onSelectRef.current?.(inc.id));
        markers.set(inc.id, marker);
      } else {
        marker.setLatLng([inc.lat, inc.lon]);
        marker.setStyle(style);
      }
      marker.bindPopup(popupContent(inc));
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Fit the board once, the first time we have pins — after that the
    // coordinator owns the viewport (a poll must never yank the map around).
    if (!didFitRef.current && plotted.length > 0) {
      didFitRef.current = true;
      const bounds = L.latLngBounds(plotted.map((i) => [i.lat, i.lon]));
      map.fitBounds(bounds.pad(0.25), { maxZoom: 14 });
    }
  }, [plotted]);

  // Leaflet measures its container at init; re-measure when re-expanded.
  useEffect(() => {
    if (!collapsed && mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
    }
  }, [collapsed]);

  return (
    <Panel
      title="Incident Map"
      icon={<span aria-hidden="true">◎</span>}
      className="cmd-map"
      flush
      actions={
        <div className="cmd-map__actions">
          {unplotted > 0 && (
            <Badge variant="muted" title="Incidents without coordinates (no GPS and no gazetteer match)">
              {unplotted} sin ubicación
            </Badge>
          )}
          <Badge variant="muted">{plotted.length} pinned</Badge>
          <button
            type="button"
            className="cmd-map__toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="cmd-map__canvas"
        style={{ display: collapsed ? 'none' : undefined }}
      />
    </Panel>
  );
}

export default MapPanel;
