import type { Point2D, Point3D } from '../types';

/**
 * 3次元の測点を床平面へ投影して2次元座標にする（面積計算の前処理）。
 *
 * 【想定】WebXRのHit TestはY-upのローカル座標系で床平面をY≈0として返す前提とし、
 * ここではX/Z成分をそのまま床平面の2次元座標として使う（傾いた床への対応はしない）。
 * 技術検証（T-003/T-004）で座標系の実際の挙動を確認し、必要なら任意平面への
 * 射影（法線ベクトルを使った一般化）に差し替える。
 */
export function projectPointsToFloor(points: Point3D[]): Point2D[] {
  return points.map((p) => ({ x: p.x, y: p.z }));
}
