// Pure maze-graph logic — no THREE, no DOM. Grid cells with N/E/S/W walls,
// generated as a perfect maze (randomized DFS): every cell reachable, exactly
// one path between any two cells, so it's always solvable but has real dead
// ends and branches to get lost in.

export const DIRS = ["N", "E", "S", "W"];
const DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }; // [dcol, drow]
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" };

// heading in degrees: 0=N, 90=E, 180=S, 270=W
export const HEADING_DIR = { 0: "N", 90: "E", 180: "S", 270: "W" };
export const DIR_HEADING = { N: 0, E: 90, S: 180, W: 270 };

export function normalizeHeading(h) {
  return ((h % 360) + 360) % 360;
}

function inBounds(size, row, col) {
  return row >= 0 && row < size && col >= 0 && col < size;
}

export function step(row, col, dir) {
  const [dc, dr] = DELTA[dir];
  return { row: row + dr, col: col + dc };
}

export function generateMaze(size, rng = Math.random) {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ N: false, E: false, S: false, W: false }))
  );
  const visited = Array.from({ length: size }, () => Array(size).fill(false));

  // Iterative DFS (stack of {row, col}) so maze size isn't bounded by call-stack depth.
  function carve(startRow, startCol) {
    const stack = [{ row: startRow, col: startCol }];
    visited[startRow][startCol] = true;
    while (stack.length) {
      const { row, col } = stack[stack.length - 1];
      const dirs = [...DIRS].sort(() => rng() - 0.5);
      let carved = false;
      for (const d of dirs) {
        const { row: nr, col: nc } = step(row, col, d);
        if (!inBounds(size, nr, nc) || visited[nr][nc]) continue;
        cells[row][col][d] = true;
        cells[nr][nc][OPPOSITE[d]] = true;
        visited[nr][nc] = true;
        stack.push({ row: nr, col: nc });
        carved = true;
        break;
      }
      if (!carved) stack.pop();
    }
  }

  const start = { row: 0, col: Math.floor(size / 2) };
  carve(start.row, start.col);

  // Exit = the cell farthest from start by graph distance (BFS), so the
  // route out is always a real journey, not a coin-flip away.
  const exit = farthestCell(cells, size, start);

  return { size, cells, start, exit };
}

function bfsDistances(cells, size, from) {
  const dist = Array.from({ length: size }, () => Array(size).fill(-1));
  dist[from.row][from.col] = 0;
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      if (!cells[cur.row][cur.col][d]) continue;
      const { row: nr, col: nc } = step(cur.row, cur.col, d);
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[cur.row][cur.col] + 1;
      queue.push({ row: nr, col: nc });
    }
  }
  return dist;
}

function farthestCell(cells, size, from) {
  const dist = bfsDistances(cells, size, from);
  let best = from;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (dist[r][c] > dist[best.row][best.col]) best = { row: r, col: c };
    }
  }
  return best;
}

// The first direction a fresh maze opens up from its start cell (deterministic).
export function startingHeading(cell) {
  for (const d of DIRS) {
    if (cell[d]) return DIR_HEADING[d];
  }
  return 0;
}

// Open exits from `cell`, excluding the direction you just arrived from,
// classified relative to `heading`: 'straight' | 'left' | 'right'. If the
// only option is back the way you came, returns a single 'back' entry.
export function junctionOptions(cell, heading) {
  const cameFrom = OPPOSITE[HEADING_DIR[normalizeHeading(heading)]];
  const options = [];
  for (const d of DIRS) {
    if (!cell[d] || d === cameFrom) continue;
    const dh = normalizeHeading(DIR_HEADING[d] - heading);
    const rel = dh === 0 ? "straight" : dh === 90 ? "right" : "left";
    options.push({ rel, dir: d });
  }
  if (options.length === 0) return [{ rel: "back", dir: cameFrom }];
  return options;
}

// Next step toward the exit from `from` (shortest path via BFS), expressed
// relative to `heading` — used for the hands-up hint reveal.
export function hintDirection(mazeData, from, heading) {
  const dist = bfsDistances(mazeData.cells, mazeData.size, mazeData.exit);
  const curDist = dist[from.row][from.col];
  if (curDist === 0) return null; // already at the exit
  let best = null;
  for (const d of DIRS) {
    if (!mazeData.cells[from.row][from.col][d]) continue;
    const { row: nr, col: nc } = step(from.row, from.col, d);
    if (dist[nr][nc] === curDist - 1) {
      best = d;
      break;
    }
  }
  const dh = normalizeHeading(DIR_HEADING[best] - heading);
  const rel = dh === 0 ? "straight" : dh === 90 ? "right" : "left";
  return { rel, dir: best, remaining: curDist };
}

export { OPPOSITE };
