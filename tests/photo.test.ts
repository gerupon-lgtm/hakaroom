import { describe, expect, it } from 'vitest';
import { computeTargetSize } from '../src/photo/image-size';
import { gravityToTilt, summarizeTilt } from '../src/photo/tilt';
import { selectPhotosToEvict } from '../src/storage/photo-eviction';

describe('computeTargetSize', () => {
  it('長辺が上限を超える場合は縦横比を保って縮小する', () => {
    expect(computeTargetSize(4080, 3072, 1600)).toEqual({ width: 1600, height: 1205 });
    expect(computeTargetSize(3072, 4080, 1600)).toEqual({ width: 1205, height: 1600 });
  });

  it('上限以下なら拡大せずそのまま', () => {
    expect(computeTargetSize(1280, 720, 1600)).toEqual({ width: 1280, height: 720 });
  });
});

describe('gravityToTilt（静止・画面上向きでaz=+9.8の前提）', () => {
  it('縦持ちで水平を向くと仰角0・ロール0', () => {
    const t = gravityToTilt({ ax: 0, ay: 9.8, az: 0 });
    expect(t.elevationDeg).toBeCloseTo(0, 6);
    expect(t.rollDeg).toBeCloseTo(0, 6);
  });

  it('画面を真上に向けて水平に置くと真下を向く(仰角-90)', () => {
    expect(gravityToTilt({ ax: 0, ay: 0, az: 9.8 }).elevationDeg).toBeCloseTo(-90, 6);
  });

  it('45度下向きの仰角は-45', () => {
    const g = 9.8 * Math.SQRT1_2;
    expect(gravityToTilt({ ax: 0, ay: g, az: g }).elevationDeg).toBeCloseTo(-45, 6);
  });

  it('端末を右へ45度傾けるとロール45', () => {
    const g = 9.8 * Math.SQRT1_2;
    expect(gravityToTilt({ ax: g, ay: g, az: 0 }).rollDeg).toBeCloseTo(45, 6);
  });

  it('ゼロベクトルでも例外にならない', () => {
    expect(gravityToTilt({ ax: 0, ay: 0, az: 0 })).toEqual({ elevationDeg: 0, rollDeg: 0 });
  });
});

describe('summarizeTilt', () => {
  it('サンプルが無ければnull', () => {
    expect(summarizeTilt([])).toBeNull();
  });

  it('同一サンプルならばらつき0', () => {
    const s = { ax: 0, ay: 6.93, az: 6.93 };
    const summary = summarizeTilt([s, s, s]);
    expect(summary?.elevationStdDevDeg).toBeCloseTo(0, 6);
    expect(summary?.sampleCount).toBe(3);
  });
});

describe('selectPhotosToEvict', () => {
  const mb = 1024 * 1024;
  const photos = [
    { id: 'c', capturedAt: '2026-09-25T03:00:00Z', byteSize: 60 * mb },
    { id: 'a', capturedAt: '2026-09-25T01:00:00Z', byteSize: 80 * mb },
    { id: 'b', capturedAt: '2026-09-25T02:00:00Z', byteSize: 70 * mb },
  ];

  it('上限以下なら削除しない', () => {
    expect(selectPhotosToEvict(photos, 210 * mb)).toEqual([]);
  });

  it('上限を超えた分だけ古い写真から削除する', () => {
    expect(selectPhotosToEvict(photos, 200 * mb)).toEqual(['a']);
    expect(selectPhotosToEvict(photos, 100 * mb)).toEqual(['a', 'b']);
  });
});
