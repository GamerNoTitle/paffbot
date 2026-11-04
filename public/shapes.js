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
    // Kotlin 里 `it / n` 是整除，这里必须 floor，否则每个点都会被额外旋转
    const angle = ((Math.floor(it / n) * 360) / reps) * (Math.PI / 180);
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

/**
 * 生成 path：每条边 → 直线到切点，顶点处用三次贝塞尔拟合圆弧。
 *
 * 关键是把切线长度夹在相邻边长的一半以内，否则相邻顶点的切点会互相越过、
 * 在轮廓上扎出尖刺（之前 cookie9 的毛刺就是这么来的）。
 */
function toPath(points, size) {
  const pts = points.map((p) => ({ x: p.x * size, y: p.y * size, r: p.r }));
  const n = pts.length;
  const segments = [];

  for (let i = 0; i < n; i += 1) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];

    const l1 = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;

    const u1 = { x: (prev.x - cur.x) / l1, y: (prev.y - cur.y) / l1 };
    const u2 = { x: (next.x - cur.x) / l2, y: (next.y - cur.y) / l2 };

    // 内角
    const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    const angle = Math.acos(cos);

    // 切线长度：不超过两侧边长的一半（留 5% 余量），转角趋近平角时收缩为 0
    const maxT = 0.45 * Math.min(l1, l2);
    const t = cur.r <= 0 ? 0 : Math.min(cur.r * Math.min(l1, l2) * 0.5, maxT, maxT / Math.max(0.2, Math.tan(angle / 2)));

    if (t < 0.05) {
      segments.push({ type: "line", to: { x: cur.x, y: cur.y } });
      continue;
    }

    const start = { x: cur.x + u1.x * t, y: cur.y + u1.y * t };
    const end = { x: cur.x + u2.x * t, y: cur.y + u2.y * t };

    // 圆弧 → 三次贝塞尔：控制点沿切线方向偏移 k
    const sweep = Math.PI - angle;
    const k = (4 / 3) * Math.tan(Math.max(0.001, sweep) / 4);
    const c1 = { x: start.x + (cur.x - start.x) * k, y: start.y + (cur.y - start.y) * k };
    const c2 = { x: end.x + (cur.x - end.x) * k, y: end.y + (cur.y - end.y) * k };

    segments.push({ type: "corner", start, c1, c2, end });
  }

  let d = "";
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg.type === "corner") {
      d += `${i === 0 ? "M" : "L"}${round(seg.start.x)} ${round(seg.start.y)}`;
      d += `C${round(seg.c1.x)} ${round(seg.c1.y)} ${round(seg.c2.x)} ${round(seg.c2.y)} ${round(seg.end.x)} ${round(seg.end.y)}`;
    } else {
      d += `${i === 0 ? "M" : "L"}${round(seg.to.x)} ${round(seg.to.y)}`;
    }
  }
  return `${d}Z`;
}

function build(points, reps = 1, mirroring = false, size = 100) {
  return toPath(normalize(repeat(points, reps, mirroring)), size);
}

/**
 * 星形/花瓣这类尖角密度高的形状，用闭合 Catmull-Rom 过点平滑，
 * 视觉上就是 M3 的「饼干/花朵」；用圆角切线法反而会在内凹处打结出毛刺。
 */

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
  sunny: () => {
    const pts = [];
    for (let i = 0; i < 8; i += 1) {
      const outer = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const inner = outer + Math.PI / 8;
      pts.push(vertex(0.5 + Math.cos(outer) * 0.5, 0.5 + Math.sin(outer) * 0.5, 0.15));
      pts.push(vertex(0.5 + Math.cos(inner) * 0.4, 0.5 + Math.sin(inner) * 0.4, 0.15));
    }
    return build(pts);
  },
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
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="${className}" aria-hidden="true" style="transform:rotate(${rotate}deg);fill:${color}"><path d="${shapePath(name)}"/></svg>`;
}

/** 用作 CSS mask 的 data URI（形状本身是白色，颜色由元素背景决定）。 */
export function shapeMask(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${shapePath(name)}" fill="#fff"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const SHAPE_NAMES = Object.keys(DEFS);
