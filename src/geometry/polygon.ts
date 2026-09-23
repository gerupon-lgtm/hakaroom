import type { Point2D, Point3D } from '../types';
import { euclideanDistance3D } from './distance';
import { projectPointsToFloor } from './projection';

/**
 * 隣接測点間の距離（メートル）。閉多角形として最後の点→最初の点も含む。
 * 3点未満では辺を構成できないため空配列を返す。
 */
export function computeEdgeLengths(points: Point3D[]): number[] {
  if (points.length < 3) return [];
  return points.map((p, i) => euclideanDistance3D(p, points[(i + 1) % points.length]));
}

export function computePerimeter(edgeLengths: number[]): number {
  return edgeLengths.reduce((sum, len) => sum + len, 0);
}

/** Shoelace公式による面積（平方メートル）。points は3次元のまま渡し、内部で床平面へ投影する。 */
export function computePolygonArea(points: Point3D[]): number {
  if (points.length < 3) return 0;
  const projected = projectPointsToFloor(points);
  return shoelaceArea(projected);
}

function shoelaceArea(points: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * 閉合誤差（メートル）。
 *
 * 【要確認】現時点では「部屋を一周して測点を打つワークフロー」における
 * 閉合誤差の具体的な取得方法（始点を再度Hit Testし直して比較する等）が
 * 未確定のため、再測定した始点位置(closingMeasurement)が与えられない限り
 * null を返す。単純に points 配列内の最後→最初の辺長を closureError とするのは
 * 誤り（それは他の辺と同じ「辺長」であって「誤差」ではない）。
 */
export function computeClosureError(
  startPoint: Point3D | null,
  closingMeasurement: Point3D | null,
): number | null {
  if (!startPoint || !closingMeasurement) return null;
  return euclideanDistance3D(startPoint, closingMeasurement);
}
