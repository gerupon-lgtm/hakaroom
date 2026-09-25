/**
 * 写真方式の幾何計算（純粋関数）。
 *
 * カメラ座標系: x=画像の右, y=画像の下, z=前方（光軸）。
 * 方式A（傾き＋焦点距離）: 重力方向(up)と焦点距離から、水平面上の点を「カメラ高さ=1」の単位で
 *   平面座標に変換する。縮尺（実寸）は、同じ写真内の既知長の線分から与える。
 * 方式B（A4等の4隅）: 4隅の対応からホモグラフィを求め、画像→平面(mm)に変換する。
 */
export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface CameraModel {
  widthPx: number;
  heightPx: number;
  focalPx: number;
}

const DIAGONAL_35MM = Math.hypot(36, 24);

/** 35mm換算焦点距離(mm)をピクセル単位の焦点距離へ（対角基準）。 */
export function focalPxFrom35mm(focal35mm: number, widthPx: number, heightPx: number): number {
  return (focal35mm / DIAGONAL_35MM) * Math.hypot(widthPx, heightPx);
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const normalize = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

/**
 * 撮影時の仰角・ロール（src/photo/tilt.ts と同じ定義）から、カメラ座標系での「上向き」ベクトルを返す。
 * rotationDegは、画像が端末の縦持ち姿勢に対して何度回っているか（0/90/180/270）。
 * 縦持ちで撮った画像は0。横持ちの場合の符号は実機で確認する（ガイド線で目視確認できる）。
 */
export function upVectorInCamera(elevationDeg: number, rollDeg: number, rotationDeg = 0): Vec3 {
  const e = (elevationDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  const ux = Math.cos(e) * Math.sin(r);
  const uy = Math.cos(e) * Math.cos(r);
  const uz = -Math.sin(e);
  // 端末座標(x右,y上,z手前) → カメラ座標(x右,y下,z前)
  const x0 = ux;
  const y0 = -uy;
  const z0 = -uz;
  const t = (rotationDeg * Math.PI) / 180;
  return { x: x0 * Math.cos(t) - y0 * Math.sin(t), y: x0 * Math.sin(t) + y0 * Math.cos(t), z: z0 };
}

/** 画素→カメラ座標系の視線ベクトル(z=1)。主点は画像中心と仮定する。 */
export function pixelRay(p: Vec2, cam: CameraModel): Vec3 {
  return { x: (p.x - cam.widthPx / 2) / cam.focalPx, y: (p.y - cam.heightPx / 2) / cam.focalPx, z: 1 };
}

/**
 * 水平面上の点を平面座標(カメラ高さ=1の単位)へ。視線が水平面より上(地平線以上)ならnull。
 * 平面座標の原点はカメラ直下、軸はupに垂直な面内の直交基底（前方の水平成分が第1軸）。
 */
export function projectToGroundPlane(pixel: Vec2, cam: CameraModel, up: Vec3): Vec2 | null {
  const d = pixelRay(pixel, cam);
  const denom = dot(d, up);
  if (denom >= -1e-9) return null;
  const point = scale(d, -1 / denom);
  const forward: Vec3 = { x: 0, y: 0, z: 1 };
  let e1 = sub(forward, scale(up, dot(forward, up)));
  if (norm(e1) < 1e-6) e1 = { x: 1, y: 0, z: 0 };
  e1 = normalize(e1);
  const e2 = cross(up, e1);
  return { x: dot(point, e1), y: dot(point, e2) };
}

export function distance2D(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 方式A: 2点間の平面距離（カメラ高さ=1の単位）。どちらかが地平線以上ならnull。 */
export function groundDistanceUnits(p1: Vec2, p2: Vec2, cam: CameraModel, up: Vec3): number | null {
  const a = projectToGroundPlane(p1, cam, up);
  const b = projectToGroundPlane(p2, cam, up);
  return a && b ? distance2D(a, b) : null;
}

/**
 * 焦点距離(35mm換算)を推定する。既知長の線分が2本以上あるとき、
 * 各線分の「既知長/平面距離」（縮尺）が互いに一致する焦点距離を格子探索で選ぶ。
 */
export function estimateFocal35mm(
  segments: { p1: Vec2; p2: Vec2; knownLength: number }[],
  size: { widthPx: number; heightPx: number },
  up: Vec3,
  range = { min: 12, max: 60, step: 0.1 },
): { focal35mm: number; costLogScaleStdDev: number } | null {
  if (segments.length < 2) return null;
  let best: { focal35mm: number; cost: number } | null = null;
  for (let f = range.min; f <= range.max + 1e-9; f += range.step) {
    const cam = { ...size, focalPx: focalPxFrom35mm(f, size.widthPx, size.heightPx) };
    const logs: number[] = [];
    for (const s of segments) {
      const d = groundDistanceUnits(s.p1, s.p2, cam, up);
      if (d === null || d <= 0) {
        logs.length = 0;
        break;
      }
      logs.push(Math.log(s.knownLength / d));
    }
    if (logs.length !== segments.length) continue;
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const cost = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
    if (!best || cost < best.cost) best = { focal35mm: f, cost };
  }
  return best ? { focal35mm: best.focal35mm, costLogScaleStdDev: best.cost } : null;
}

export type Homography = number[]; // 行優先の3x3(9要素)

/** 4点対応(src→dst)からホモグラフィを求める（h33=1として8元連立方程式を解く）。 */
export function homographyFrom4(src: Vec2[], dst: Vec2[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function applyHomography(h: Homography, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** 方式B: A4等の4隅（画像上の順に辺をたどる）から、画像上の2点間の実距離(mm)を求める。 */
export function planeDistanceViaTarget(
  corners: Vec2[],
  firstEdgeMm: number,
  secondEdgeMm: number,
  p1: Vec2,
  p2: Vec2,
): number | null {
  const h = homographyFrom4(corners, [
    { x: 0, y: 0 },
    { x: firstEdgeMm, y: 0 },
    { x: firstEdgeMm, y: secondEdgeMm },
    { x: 0, y: secondEdgeMm },
  ]);
  return h ? distance2D(applyHomography(h, p1), applyHomography(h, p2)) : null;
}

/** ガウスの消去法（部分ピボット選択）。特異ならnull。 */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/**
 * 重力方向(鉛直)の画像上の消失点と、鉛直ガイド線の方向を返す。壁の角などの鉛直な辺が
 * このガイド線と平行なら、傾き・回転・焦点距離の設定が合っている目安になる。
 * 消失点が無限遠に近い場合は vanishing=null で direction のみ返す。
 */
export function verticalGuide(
  cam: CameraModel,
  up: Vec3,
): { vanishing: Vec2 | null; direction: Vec2 } {
  const nadir = scale(up, -1);
  if (Math.abs(nadir.z) < 0.02) {
    const len = Math.hypot(nadir.x, nadir.y) || 1;
    return { vanishing: null, direction: { x: nadir.x / len, y: nadir.y / len } };
  }
  return {
    vanishing: {
      x: cam.widthPx / 2 + (cam.focalPx * nadir.x) / nadir.z,
      y: cam.heightPx / 2 + (cam.focalPx * nadir.y) / nadir.z,
    },
    direction: { x: 0, y: 0 },
  };
}
