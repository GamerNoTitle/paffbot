/**
 * RoundedPolygon → SVG path（Material 3 Expressive 形状）
 *
 * 顶点/圆角数据取自 androidx.compose.material3.MaterialShapes（Apache-2.0）：
 * 多边形 + 每个顶点的圆角比例，重复/镜像后生成平滑路径。
 * 圆角用圆弧的三次贝塞尔近似（k = 4/3·tan(θ/4)）。
 */

const CENTER = { x: 0.5, y: 0.5 };

function vertex(x, y, r = 0) {
  return { x, y, r };
}

/** 对应 Kotlin 的 doRepeat：reps 次重复，可选镜像。 */
function repeat(points, reps, mirroring) {
  if (mirroring) {
    const angles = points.map((p) => (Math.atan2(p.y - CENTER.y, p.x - CENTER.x) * 180) / Math.PI);
    const distances = points.map((p) => Math.hypot(p.x - CENTER.x, p.y - CENTER.y));
    const total = reps * 2;
    const section = 360 / total;
    const out = [];

    for (let it = 0; it < total; it += 1) {
      for (let index = 0; index < points.length; index += 1) {
        const i = it % 2 === 0 ? index : points.length - 1 - index;
        if (i > 0 || it % 2 === 0) {
          const angle =
            section * it + (it % 2 === 0 ? angles[i] : section - angles[i] + 2 * angles[0]);
          const rad = (angle * Math.PI) / 180;
          out.push({
            x: Math.cos(rad) * distances[i] + CENTER.x,
            y: Math.sin(rad) * distances[i] + CENTER.y,
            r: points[i].r,
          });
        }
      }
    }
    return out;
  }

  const n = points.length;
  const out = [];
  for (let it = 0; it < n * reps; it += 1) {
    const point = points[it % n];
    const angle = (((it / n) * 360) / reps) * (Math.PI / 180);
    const dx = point.x - CENTER.x;
    const dy = point.y - CENTER.y;
    out.push({
      x: dx * Math.cos(angle) - dy * Math.sin(angle) + CENTER.x,
      y: dx * Math.sin(angle) + dy * Math.cos(angle) + CENTER.y,
      r: point.r,
    });
  }
  return out;
}

function normalize(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return points.map((p) => ({
    x: (p.x - cx) / size + CENTER.x,
    y: (p.y - cy) / size + CENTER.y,
    r: p.r,
  }));
}

const round = (n) => Math.round(n * 1000) / 1000;

/** 生成 path：每条边 → 直线到切点，顶点处用贝塞尔圆弧过渡。 */
function toPath(points, size) {
  const pts = points.map((p) => ({ x: p.x * size, y: p.y * size, r: p.r }));
  const n = pts.length;
  const segments = [];

  for (let i = 0; i < n; i += 1) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];

    const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y);
    const radius = cur.r * Math.min(lenIn, lenOut) * 0.5;

    if (radius < 0.01) {
      segments.push({ type: "line", to: { x: cur.x, y: cur.y } });
      continue;
    }

    // 切点：沿两条边各退 radius
    const tIn = radius / lenIn;
    const tOut = radius / lenOut;
    const start = { x: cur.x + (prev.x - cur.x) * tIn, y: cur.y + (prev.y - cur.y) * tIn };
    const end = { x: cur.x + (next.x - cur.x) * tOut, y: cur.y + (next.y - cur.y) * tOut };

    // 圆弧近似：控制点沿切线方向偏移
    const k = 0.5523;
    const c1 = { x: start.x + (cur.x - start.x) * k, y: start.y + (cur.y - start.y) * k };
    const c2 = { x: end.x + (cur.x - end.x) * k, y: end.y + (cur.y - end.y) * k };

    segments.push({ type: "corner", start, c1, c2, end });
  }

  let d = "";
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const nextSeg = segments[(i + 1) % segments.length];
    if (seg.type === "corner") {
      if (i === 0) d += `M${round(seg.start.x)} ${round(seg.start.y)}`;
      else d += `L${round(seg.start.x)} ${round(seg.start.y)}`;
      d += `C${round(seg.c1.x)} ${round(seg.c1.y)} ${round(seg.c2.x)} ${round(seg.c2.y)} ${round(seg.end.x)} ${round(seg.end.y)}`;
    } else if (nextSeg.type === "corner") {
      if (i === 0) d += `M${round(seg.to.x)} ${round(seg.to.y)}`;
      else d += `L${round(seg.to.x)} ${round(seg.to.y)}`;
    }
  }
  return `${d}Z`;
}

function build(points, reps = 1, mirroring = false, size = 100) {
  return toPath(normalize(repeat(points, reps, mirroring)), size);
}

const R = {
  r15: 0.15,
  r20: 0.2,
  r30: 0.3,
  r50: 0.5,
  r100: 1,
};

/* ---------------------------------------------------------------- 形状定义 */

const DEFS = {
  squircle: () => build([vertex(0, 0, R.r30), vertex(1, 0, R.r30), vertex(1, 1, R.r30), vertex(0, 1, R.r30)]),
  pill: () => build([vertex(0, 0, 1), vertex(1, 0, 1), vertex(1, 1, 1), vertex(0, 1, 1)]),
  diamond: () =>
    build(
      [vertex(0.5, 1.096, 0.151), vertex(0.04, 0.5, 0.159)],
      2,
      false,
    ),
  sunny: () =>
    build(
      [
        vertex(0.5, 0.0, R.r15),
        vertex(0.5 + 0.8 * 0.5, 0.5 - 0.8 * 0.29, R.r15),
        vertex(0.5 + 0.8 * 0.87, 0.5 - 0.8 * 0.5, R.r15),
        vertex(0.5 + 0.8, 0.5, R.r15),
        vertex(0.5 + 0.8 * 0.87, 0.5 + 0.8 * 0.5, R.r15),
        vertex(0.5 + 0.8 * 0.5, 0.5 + 0.8 * 0.87, R.r15),
        vertex(0.5, 0.5 + 0.8, R.r15),
        vertex(0.5 - 0.8 * 0.5, 0.5 + 0.8 * 0.87, R.r15),
        vertex(0.5 - 0.8 * 0.87, 0.5 + 0.8 * 0.5, R.r15),
        vertex(0.5 - 0.8, 0.5, R.r15),
        vertex(0.5 - 0.8 * 0.87, 0.5 - 0.8 * 0.5, R.r15),
        vertex(0.5 - 0.8 * 0.5, 0.5 - 0.8 * 0.87, R.r15),
        vertex(0.5, 0.5 - 0.8, R.r15),
      ],
      1,
      false,
    ),
  cookie4: () => build([vertex(1.237, 1.236, 0.258), vertex(0.5, 0.918, 0.233)], 4, false),
  cookie6: () => build([vertex(0.723, 0.884, 0.394), vertex(0.5, 1.099, 0.398)], 6, false),
  cookie9: () =>
    build(
      Array.from({ length: 9 }, (_, i) => {
        const outer = (i / 9) * Math.PI * 2 - Math.PI / 2;
        const inner = outer + Math.PI / 9;
        return [
          vertex(0.5 + Math.cos(outer) * 0.5, 0.5 + Math.sin(outer) * 0.5, R.r50),
          vertex(0.5 + Math.cos(inner) * 0.4, 0.5 + Math.sin(inner) * 0.4, R.r50),
        ];
      }).flat(),
      1,
      false,
    ),
  cookie12: () =>
    build(
      Array.from({ length: 12 }, (_, i) => {
        const outer = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const inner = outer + Math.PI / 12;
        return [
          vertex(0.5 + Math.cos(outer) * 0.5, 0.5 + Math.sin(outer) * 0.5, R.r50),
          vertex(0.5 + Math.cos(inner) * 0.4, 0.5 + Math.sin(inner) * 0.4, R.r50),
        ];
      }).flat(),
      1,
      false,
    ),
  flower: () =>
    build(
      [
        vertex(0.37, 0.187, 0),
        vertex(0.416, 0.049, 0.381),
        vertex(0.479, 0.001, 0.095),
      ],
      8,
      true,
    ),
  heart: () =>
    build(
      [
        vertex(0.5, 0.268, 0.016),
        vertex(0.792, -0.066, 0.958),
        vertex(1.064, 0.276, 1),
        vertex(0.501, 0.946, 0.129),
      ],
      1,
      true,
    ),
  clover4: () =>
    build([vertex(0.5, 0.074, 0), vertex(0.725, -0.099, 0.476)], 4, true),
  arch: () => build([vertex(0, 0, R.r100), vertex(1, 0, R.r100), vertex(1, 1, R.r20), vertex(0, 1, R.r20)]),
  bun: () =>
    build(
      [
        vertex(0.796, 0.5, 0),
        vertex(0.853, 0.518, 1),
        vertex(0.992, 0.631, 1),
        vertex(0.968, 1, 1),
      ],
      2,
      true,
    ),
};

const cache = new Map();

/** 形状在 100×100 视口内的 path。 */
export function shapePath(name) {
  if (!cache.has(name)) {
    const def = DEFS[name];
    if (!def) throw new Error(`unknown shape: ${name}`);
    cache.set(name, def());
  }
  return cache.get(name);
}

/** 直接给 <svg> 用的内联标记。 */
export function shapeSvg(name, { size = 64, color = "currentColor", rotate = 0, className = "" } = {}) {
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="${className}" aria-hidden="true" style="transform:rotate(${rotate}deg)"><path d="${shapePath(name)}" fill="${color}"/></svg>`;
}

/** 用作 CSS mask 的 data URI（形状本身是白色，颜色由元素背景决定）。 */
export function shapeMask(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${shapePath(name)}" fill="#fff"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const SHAPE_NAMES = Object.keys(DEFS);
