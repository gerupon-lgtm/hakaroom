import { describe, expect, it } from 'vitest';
import { euclideanDistance3D } from '../src/geometry/distance';
import { computeEdgeLengths, computePerimeter, computePolygonArea, computeClosureError } from '../src/geometry/polygon';
import type { Point3D } from '../src/types';

describe('euclideanDistance3D', () => {
  it('同一点なら距離0', () => {
    expect(euclideanDistance3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0);
  });

  it('3-4-5の直角三角形相当の座標で距離5になる', () => {
    expect(euclideanDistance3D({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });
});

describe('1辺1mの正方形（床平面 x-z）', () => {
  const square: Point3D[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 },
  ];

  it('4辺すべて1mになる', () => {
    const edges = computeEdgeLengths(square);
    expect(edges).toHaveLength(4);
    edges.forEach((len) => expect(len).toBeCloseTo(1, 10));
  });

  it('周長は4mになる', () => {
    const edges = computeEdgeLengths(square);
    expect(computePerimeter(edges)).toBeCloseTo(4, 10);
  });

  it('面積は1平方メートルになる', () => {
    expect(computePolygonArea(square)).toBeCloseTo(1, 10);
  });
});

describe('2m x 3mの長方形', () => {
  const rect: Point3D[] = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 3 },
    { x: 0, y: 0, z: 3 },
  ];

  it('面積は6平方メートルになる', () => {
    expect(computePolygonArea(rect)).toBeCloseTo(6, 10);
  });

  it('周長は10mになる', () => {
    expect(computePerimeter(computeEdgeLengths(rect))).toBeCloseTo(10, 10);
  });
});

describe('境界: 4点未満', () => {
  it('3点未満では辺を計算しない', () => {
    expect(computeEdgeLengths([{ x: 0, y: 0, z: 0 }])).toEqual([]);
    expect(computeEdgeLengths([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toEqual([]);
  });

  it('3点未満では面積は0', () => {
    expect(computePolygonArea([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBe(0);
  });
});

describe('computeClosureError', () => {
  it('再測定が無ければnull', () => {
    expect(computeClosureError({ x: 0, y: 0, z: 0 }, null)).toBeNull();
    expect(computeClosureError(null, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('再測定した始点とのずれを返す', () => {
    const start = { x: 0, y: 0, z: 0 };
    const remeasured = { x: 0.03, y: 0, z: 0.04 }; // 5cmのずれ相当
    expect(computeClosureError(start, remeasured)).toBeCloseTo(0.05, 10);
  });
});
