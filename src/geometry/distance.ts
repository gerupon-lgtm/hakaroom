import type { Point3D } from '../types';

/** 2点間の3次元ユークリッド距離（メートル）。docs/api-design.md「geometry」参照。 */
export function euclideanDistance3D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
