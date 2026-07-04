// Layered crossing minimisation behind the Organise button.
//
// Nodes live in fixed left-to-right columns; only the vertical order inside
// each column is searched. Starting from the caller's warm-start order, the
// algorithm alternates barycenter sweeps with adjacent pairwise swaps and
// keeps the best ordering seen, iterating until the straight-line edge
// crossing count reaches zero or stops improving (zero is impossible for
// non-planar graphs, so a stall counter bounds the loop). A final isotonic
// relaxation pulls connected cards level without reintroducing overlaps.

const MAX_SWEEPS = 40;
const STALL_LIMIT = 4;
const SWAP_ROUNDS = 6;
const RELAX_PASSES = 8;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const orientation = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const segmentsIntersect = (s, t) => {
  const d1 = orientation(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1);
  const d2 = orientation(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2);
  const d3 = orientation(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1);
  const d4 = orientation(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

const shareEndpoint = (s, t) =>
  s.source === t.source || s.source === t.target || s.target === t.source || s.target === t.target;

// Minimise Σ(y_i − desired_i)² subject to y_{i+1} − y_i ≥ sep_i.
// Substituting z_i = y_i − Σsep turns it into isotonic regression, solved
// with pool-adjacent-violators.
function constrainedPlacement(desired, seps) {
  const prefix = [0];
  for (const sep of seps) prefix.push(prefix[prefix.length - 1] + sep);
  const blocks = [];
  desired.forEach((value, index) => {
    let block = { sum: value - prefix[index], count: 1 };
    while (
      blocks.length > 0 &&
      blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count >= block.sum / block.count
    ) {
      const prev = blocks.pop();
      block = { sum: prev.sum + block.sum, count: prev.count + block.count };
    }
    blocks.push(block);
  });
  const result = [];
  for (const block of blocks) {
    const value = block.sum / block.count;
    for (let i = 0; i < block.count; i++) result.push(value + prefix[result.length]);
  }
  return result;
}

export function computeOrganisedLayout({ columns, edgePairs, heightOf, widthOf, gapY, gutterX }) {
  const columnList = columns.filter((column) => column.ids.length > 0);
  const columnKeyOf = new Map();
  for (const column of columnList) {
    for (const id of column.ids) columnKeyOf.set(id, column.key);
  }

  // Fixed x per column, sized by the widest card it holds.
  const columnX = {};
  let cursorX = 0;
  for (const column of columnList) {
    columnX[column.key] = cursorX;
    cursorX += Math.max(...column.ids.map(widthOf)) + gutterX;
  }

  // Deduped edges between column members (styling variants collapse to one).
  const seenPairs = new Set();
  const edges = [];
  for (const [source, target] of edgePairs) {
    if (!columnKeyOf.has(source) || !columnKeyOf.has(target) || source === target) continue;
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    edges.push([source, target]);
  }

  const neighbors = new Map();
  const edgeIndicesOf = new Map();
  edges.forEach(([source, target], index) => {
    if (!neighbors.has(source)) neighbors.set(source, []);
    if (!neighbors.has(target)) neighbors.set(target, []);
    neighbors.get(source).push(target);
    neighbors.get(target).push(source);
    if (!edgeIndicesOf.has(source)) edgeIndicesOf.set(source, []);
    if (!edgeIndicesOf.has(target)) edgeIndicesOf.set(target, []);
    edgeIndicesOf.get(source).push(index);
    edgeIndicesOf.get(target).push(index);
  });

  // Node centers for an ordering: columns stacked and vertically centered
  // against the tallest one, mirroring the final placement geometry.
  const centersFor = (orderings) => {
    const heights = orderings.map(
      (ids) => ids.reduce((sum, id) => sum + heightOf(id), 0) + Math.max(0, ids.length - 1) * gapY,
    );
    const tallest = Math.max(...heights, 0);
    const centers = new Map();
    orderings.forEach((ids, index) => {
      let y = (tallest - heights[index]) / 2;
      for (const id of ids) {
        centers.set(id, y + heightOf(id) / 2);
        y += heightOf(id) + gapY;
      }
    });
    return centers;
  };

  const segmentFor = ([source, target], centers) => ({
    source,
    target,
    x1: columnX[columnKeyOf.get(source)] + widthOf(source),
    y1: centers.get(source),
    x2: columnX[columnKeyOf.get(target)],
    y2: centers.get(target),
  });

  const countAll = (centers) => {
    const segments = edges.map((edge) => segmentFor(edge, centers));
    let total = 0;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (shareEndpoint(segments[i], segments[j])) continue;
        if (segmentsIntersect(segments[i], segments[j])) total++;
      }
    }
    return total;
  };

  let orders = columnList.map((column) => [...column.ids]);

  // Barycenter pass: sort each column by the median center of its neighbors.
  const sweepOnce = (direction) => {
    for (let step = 0; step < orders.length; step++) {
      const column = direction > 0 ? step : orders.length - 1 - step;
      const centers = centersFor(orders);
      const keyed = orders[column].map((id) => {
        const links = neighbors.get(id);
        const key =
          links && links.length > 0 ? median(links.map((other) => centers.get(other))) : centers.get(id);
        return { id, key };
      });
      keyed.sort((a, b) => a.key - b.key);
      orders[column] = keyed.map((entry) => entry.id);
    }
  };

  // Greedy adjacent swaps with local crossing recount (only edges touching
  // the swapped pair can change), so each candidate costs O(local × E).
  const swapPass = () => {
    let improved = false;
    const centers = centersFor(orders);
    const segments = edges.map((edge) => segmentFor(edge, centers));
    const refresh = (id) => {
      for (const index of edgeIndicesOf.get(id) ?? []) segments[index] = segmentFor(edges[index], centers);
    };
    const countTouching = (indexSet) => {
      let total = 0;
      for (const i of indexSet) {
        for (let j = 0; j < segments.length; j++) {
          if (j === i || (indexSet.has(j) && j <= i)) continue;
          if (shareEndpoint(segments[i], segments[j])) continue;
          if (segmentsIntersect(segments[i], segments[j])) total++;
        }
      }
      return total;
    };
    for (const ids of orders) {
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i];
        const b = ids[i + 1];
        const touched = new Set([...(edgeIndicesOf.get(a) ?? []), ...(edgeIndicesOf.get(b) ?? [])]);
        if (touched.size === 0) continue;
        const before = countTouching(touched);
        const top = centers.get(a) - heightOf(a) / 2;
        const oldA = centers.get(a);
        const oldB = centers.get(b);
        centers.set(b, top + heightOf(b) / 2);
        centers.set(a, top + heightOf(b) + gapY + heightOf(a) / 2);
        refresh(a);
        refresh(b);
        if (countTouching(touched) < before) {
          ids[i] = b;
          ids[i + 1] = a;
          improved = true;
        } else {
          centers.set(a, oldA);
          centers.set(b, oldB);
          refresh(a);
          refresh(b);
        }
      }
    }
    return improved;
  };

  // Iterate until zero crossings or no improvement for STALL_LIMIT rounds.
  let bestCount = countAll(centersFor(orders));
  let bestOrders = orders.map((ids) => [...ids]);
  let stall = 0;
  for (let sweep = 0; sweep < MAX_SWEEPS && bestCount > 0; sweep++) {
    sweepOnce(sweep % 2 === 0 ? 1 : -1);
    for (let round = 0; round < SWAP_ROUNDS && swapPass(); round++);
    const count = countAll(centersFor(orders));
    if (count < bestCount) {
      bestCount = count;
      bestOrders = orders.map((ids) => [...ids]);
      stall = 0;
    } else {
      stall++;
      if (stall >= STALL_LIMIT) break;
    }
  }
  orders = bestOrders;

  // Coordinate relaxation: pull every card toward the average height of its
  // neighbors while keeping the found order and minimum gaps (isotonic fit).
  const centers = centersFor(orders);
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (const ids of orders) {
      const desired = ids.map((id) => {
        const links = neighbors.get(id);
        if (!links || links.length === 0) return centers.get(id);
        return links.reduce((sum, other) => sum + centers.get(other), 0) / links.length;
      });
      const seps = ids.slice(1).map((id, index) => (heightOf(ids[index]) + heightOf(id)) / 2 + gapY);
      const placed = constrainedPlacement(desired, seps);
      ids.forEach((id, index) => centers.set(id, placed[index]));
    }
  }

  let minTop = Infinity;
  for (const [id, center] of centers) minTop = Math.min(minTop, center - heightOf(id) / 2);
  const positions = {};
  for (const [id, center] of centers) {
    positions[id] = { x: columnX[columnKeyOf.get(id)], y: center - heightOf(id) / 2 - (minTop === Infinity ? 0 : minTop) };
  }
  return { positions, columnX, crossings: bestCount };
}
