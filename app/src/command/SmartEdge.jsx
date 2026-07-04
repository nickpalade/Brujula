import { useMemo } from 'react';
import { BaseEdge, getBezierPath, useNodes } from '@xyflow/react';

// Edge that routes around node cards with a smooth curve.
//
// Fast path: if the plain bezier misses every card, use it as-is. Otherwise
// run an A* grid search around the inflated card rectangles, pull the path
// tight with line-of-sight simplification, and render it as a Catmull-Rom
// spline so the detour stays one flowing curve instead of 90° elbows. If the
// grid is boxed in, it retries with half the clearance before giving up.

const CELL = 24; // grid resolution in px — smaller is prettier but slower
const INFLATE = 20; // clearance kept around every card
const MARGIN = 140; // extra routing space around the endpoints
const MAX_CELLS = 80000; // bail out to a plain bezier on huge spans
const TURN_PENALTY = 2; // in cells — favors straight runs over staircases
const SPLINE_SLACK = 10; // spline may dip this far into the clearance zone
const FALLBACK_RADIUS = 20; // corner radius of the orthogonal fallback

function inflateRect(node, amount) {
  const width = node.measured?.width ?? node.width ?? 300;
  const height = node.measured?.height ?? node.height ?? 160;
  return {
    x1: node.position.x - amount,
    y1: node.position.y - amount,
    x2: node.position.x + width + amount,
    y2: node.position.y + height + amount,
  };
}

function shrinkRect(rect, amount) {
  return { x1: rect.x1 + amount, y1: rect.y1 + amount, x2: rect.x2 - amount, y2: rect.y2 - amount };
}

function pointInRect(x, y, rect) {
  return x > rect.x1 && x < rect.x2 && y > rect.y1 && y < rect.y2;
}

// Approximates the default React Flow bezier (horizontal handles) closely
// enough for a hit test.
function bezierCrossesRects(sx, sy, tx, ty, rects) {
  const pull = Math.max(Math.abs(tx - sx) / 2, 60);
  for (let i = 1; i < 32; i++) {
    const t = i / 32;
    const mt = 1 - t;
    const x =
      mt * mt * mt * sx +
      3 * mt * mt * t * (sx + pull) +
      3 * mt * t * t * (tx - pull) +
      t * t * t * tx;
    const y = mt * mt * mt * sy + 3 * mt * mt * t * sy + 3 * mt * t * t * ty + t * t * t * ty;
    if (rects.some((rect) => pointInRect(x, y, rect))) return true;
  }
  return false;
}

function segmentHitsRect(x1, y1, x2, y2, rect) {
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true;
  if (Math.max(x1, x2) < rect.x1 || Math.min(x1, x2) > rect.x2) return false;
  if (Math.max(y1, y2) < rect.y1 || Math.min(y1, y2) > rect.y2) return false;
  // Sample-based check is robust enough at card scale.
  const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 12));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointInRect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rect)) return true;
  }
  return false;
}

function segmentClear(x1, y1, x2, y2, rects) {
  return !rects.some((rect) => segmentHitsRect(x1, y1, x2, y2, rect));
}

// 4-direction A* over a coarse grid with a turn penalty. Returns grid-cell
// waypoints or null when no route exists.
function astar(cols, rows, blocked, start, goal) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const stateKey = (x, y, dir) => (y * cols + x) * 5 + dir + 1;
  const gScore = new Map();
  const cameFrom = new Map();
  const open = [
    { x: start[0], y: start[1], dir: -1, g: 0, f: Math.abs(start[0] - goal[0]) + Math.abs(start[1] - goal[1]) },
  ];
  gScore.set(stateKey(start[0], start[1], -1), 0);

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const current = open.splice(best, 1)[0];
    if (current.x === goal[0] && current.y === goal[1]) {
      const points = [];
      let cursor = current;
      while (cursor) {
        points.push([cursor.x, cursor.y]);
        cursor = cameFrom.get(stateKey(cursor.x, cursor.y, cursor.dir));
      }
      return points.reverse();
    }
    for (let d = 0; d < 4; d++) {
      const nx = current.x + dirs[d][0];
      const ny = current.y + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (blocked[ny * cols + nx]) continue;
      const g = current.g + 1 + (current.dir !== -1 && current.dir !== d ? TURN_PENALTY : 0);
      const key = stateKey(nx, ny, d);
      if (g >= (gScore.get(key) ?? Infinity)) continue;
      gScore.set(key, g);
      cameFrom.set(key, current);
      open.push({ x: nx, y: ny, dir: d, g, f: g + Math.abs(nx - goal[0]) + Math.abs(ny - goal[1]) });
    }
  }
  return null;
}

// String pulling: drop every waypoint the straight line to the next kept
// point can skip without touching a card. Turns the grid staircase into a
// handful of true corner points.
function lineOfSightSimplify(points, rects) {
  const result = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let reach = anchor + 1;
    for (let i = points.length - 1; i > anchor + 1; i--) {
      const [ax, ay] = points[anchor];
      const [bx, by] = points[i];
      if (segmentClear(ax, ay, bx, by, rects)) {
        reach = i;
        break;
      }
    }
    result.push(points[reach]);
    anchor = reach;
  }
  return result;
}

// Catmull-Rom spline through the waypoints, emitted as cubic beziers — one
// continuous curve with no hard corners.
function splinePath(points) {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// Checks the spline stays out of the (slightly shrunk) card rects — the
// curve is allowed to dip into the clearance zone but never into a card.
function splineClear(points, rects) {
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let s = 1; s < 8; s++) {
      const t = s / 8;
      const mt = 1 - t;
      const x = mt * mt * mt * p1[0] + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p2[0];
      const y = mt * mt * mt * p1[1] + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p2[1];
      if (rects.some((rect) => pointInRect(x, y, rect))) return false;
    }
  }
  return true;
}

// Orthogonal fallback with rounded corners — guaranteed collision-free
// because it follows the raw grid path.
function roundedPath(points) {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const inLen = Math.hypot(x1 - x0, y1 - y0);
    const outLen = Math.hypot(x2 - x1, y2 - y1);
    const radius = Math.min(FALLBACK_RADIUS, inLen / 2, outLen / 2);
    const inX = x1 - ((x1 - x0) / inLen) * radius;
    const inY = y1 - ((y1 - y0) / inLen) * radius;
    const outX = x1 + ((x2 - x1) / outLen) * radius;
    const outY = y1 + ((y2 - y1) / outLen) * radius;
    d += ` L ${inX} ${inY} Q ${x1} ${y1} ${outX} ${outY}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d} L ${lx} ${ly}`;
}

function routeAround(sx, sy, tx, ty, baseRects, inflateBy) {
  const rects = baseRects.map((rect) => shrinkRect(rect, INFLATE - inflateBy));
  let minX = Math.min(sx, tx) - MARGIN;
  let maxX = Math.max(sx, tx) + MARGIN;
  let minY = Math.min(sy, ty) - MARGIN;
  let maxY = Math.max(sy, ty) + MARGIN;
  const cols = Math.ceil((maxX - minX) / CELL) + 1;
  const rows = Math.ceil((maxY - minY) / CELL) + 1;
  if (cols * rows > MAX_CELLS) return null;

  const blocked = new Uint8Array(cols * rows);
  for (const rect of rects) {
    const c1 = Math.max(0, Math.floor((rect.x1 - minX) / CELL));
    const c2 = Math.min(cols - 1, Math.ceil((rect.x2 - minX) / CELL));
    const r1 = Math.max(0, Math.floor((rect.y1 - minY) / CELL));
    const r2 = Math.min(rows - 1, Math.ceil((rect.y2 - minY) / CELL));
    for (let ry = r1; ry <= r2; ry++) {
      for (let cx = c1; cx <= c2; cx++) blocked[ry * cols + cx] = 1;
    }
  }

  const clampCell = (value, limit) => Math.min(limit - 1, Math.max(0, value));
  const start = [clampCell(Math.round((sx - minX) / CELL), cols), clampCell(Math.round((sy - minY) / CELL), rows)];
  const goal = [clampCell(Math.round((tx - minX) / CELL), cols), clampCell(Math.round((ty - minY) / CELL), rows)];
  // Clear a 3×3 pocket around both endpoints so a handle sitting flush
  // against a neighbouring card's clearance zone is never boxed in.
  for (const [px, py] of [start, goal]) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = px + dx;
        const cy = py + dy;
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 0;
      }
    }
  }

  const cells = astar(cols, rows, blocked, start, goal);
  if (!cells || cells.length < 2) return null;

  const gridPoints = cells.map(([cx, cy]) => [minX + cx * CELL, minY + cy * CELL]);
  gridPoints[0] = [sx, sy];
  gridPoints[gridPoints.length - 1] = [tx, ty];

  // Tighten, then smooth. The spline check uses card rects shrunk by the
  // slack so a gentle dip into the clearance zone still passes.
  const slackRects = rects.map((rect) => shrinkRect(rect, SPLINE_SLACK));
  const corners = lineOfSightSimplify(gridPoints, slackRects);
  if (splineClear(corners, slackRects)) return splinePath(corners);
  return roundedPath(corners);
}

function SmartEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}) {
  const nodes = useNodes();

  const smartPath = useMemo(() => {
    const rects = nodes
      .filter((node) => node.type !== 'sectionLabel' && !node.hidden)
      .map((node) => inflateRect(node, INFLATE))
      // Never treat the cards this edge plugs into as obstacles.
      .filter(
        (rect) =>
          !pointInRect(sourceX, sourceY, rect) && !pointInRect(targetX, targetY, rect),
      );
    if (!bezierCrossesRects(sourceX, sourceY, targetX, targetY, rects)) return null;
    return (
      routeAround(sourceX, sourceY, targetX, targetY, rects, INFLATE) ??
      // Boxed in at full clearance — try again hugging the cards closer.
      routeAround(sourceX, sourceY, targetX, targetY, rects, Math.floor(INFLATE / 2))
    );
  }, [nodes, sourceX, sourceY, targetX, targetY]);

  const path =
    smartPath ??
    getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];

  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}

export default SmartEdge;
