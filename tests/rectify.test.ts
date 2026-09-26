import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  estimateFocal35mm,
  estimateFocalFromVerticals,
  focalPxFrom35mm,
  groundDistanceUnits,
  homographyFrom4,
  pixelRay,
  planeDistanceViaTarget,
  projectToGroundPlane,
  tiltFromUp,
  upVectorFromVerticals,
  upVectorInCamera,
  verticalGuide,
  type CameraModel,
  type Vec2,
} from '../src/photo/rectify';

const size = { widthPx: 1200, heightPx: 1600 };
const cam: CameraModel = { ...size, focalPx: focalPxFrom35mm(26, size.widthPx, size.heightPx) };

/** 世界(X右,Y上,Z前)の地面点を、高さh・仰角e(度)・ロール0のカメラで撮った画素へ投影する。 */
function project(world: { x: number; z: number }, h: number, elevationDeg: number, c: CameraModel): Vec2 {
  const e = (elevationDeg * Math.PI) / 180;
  const v = { x: world.x, y: -h, z: world.z };
  const forward = { x: 0, y: Math.sin(e), z: Math.cos(e) };
  const down = { x: 0, y: -Math.cos(e), z: Math.sin(e) };
  const xc = v.x;
  const yc = v.x * 0 + v.y * down.y + v.z * down.z;
  const zc = v.y * forward.y + v.z * forward.z;
  return { x: c.widthPx / 2 + (c.focalPx * xc) / zc, y: c.heightPx / 2 + (c.focalPx * yc) / zc };
}

describe('upVectorInCamera', () => {
  it('縦持ちで水平を向くと、上向きは画像の上(-y)', () => {
    const up = upVectorInCamera(0, 0);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(-1, 9);
    expect(up.z).toBeCloseTo(0, 9);
  });

  it('真下を向くと、上向きは光軸の後ろ(-z)', () => {
    expect(upVectorInCamera(-90, 0).z).toBeCloseTo(-1, 9);
  });

  // 実機（Pixel 6a）: 端末の上端を左に倒した横持ちで screen.orientation.angle=90、ロール≈+90。
  // 保存される画像は景色が正立しているので、上向きは画像の上(-y)になるはず。
  it('横持ち（画面の向き90°、ロール+90°）でも、上向きは画像の上(-y)', () => {
    const up = upVectorInCamera(0, 90, 90);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(-1, 9);
  });

  it('横持ち（画面の向き270°、ロール-90°）でも、上向きは画像の上(-y)', () => {
    const up = upVectorInCamera(0, -90, 270);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(-1, 9);
  });
});

describe('方式A: 傾き+焦点距離による水平面の距離', () => {
  it('真下向きなら、ピクセル距離/焦点距離がカメラ高さに対する比になる', () => {
    const up = upVectorInCamera(-90, 0);
    const c = { x: cam.widthPx / 2, y: cam.heightPx / 2 };
    const d = groundDistanceUnits(c, { x: c.x + 100, y: c.y }, cam, up);
    expect(d).toBeCloseTo(100 / cam.focalPx, 9);
  });

  it('斜め下向きでも、合成した写真から実距離(h倍)を復元できる', () => {
    const h = 1.5;
    const elevation = -40;
    const up = upVectorInCamera(elevation, 0);
    const a = { x: -1, z: 3 };
    const b = { x: 1.2, z: 5 };
    const trueDist = Math.hypot(b.x - a.x, b.z - a.z);
    const d = groundDistanceUnits(project(a, h, elevation, cam), project(b, h, elevation, cam), cam, up);
    expect(d! * h).toBeCloseTo(trueDist, 6);
  });

  it('地平線より上の視線はnull', () => {
    const up = upVectorInCamera(0, 0);
    expect(projectToGroundPlane({ x: 600, y: 100 }, cam, up)).toBeNull();
  });
});

describe('estimateFocal35mm', () => {
  it('2本の既知長から、合成に使った焦点距離を復元する', () => {
    const trueFocal = 28;
    const trueCam = { ...size, focalPx: focalPxFrom35mm(trueFocal, size.widthPx, size.heightPx) };
    const h = 1.4;
    const elevation = -35;
    const up = upVectorInCamera(elevation, 0);
    const seg = (a: { x: number; z: number }, b: { x: number; z: number }) => ({
      p1: project(a, h, elevation, trueCam),
      p2: project(b, h, elevation, trueCam),
      knownLength: Math.hypot(b.x - a.x, b.z - a.z),
    });
    const result = estimateFocal35mm([seg({ x: -1, z: 3 }, { x: 1, z: 3.5 }), seg({ x: -0.5, z: 4 }, { x: -0.5, z: 6 })], size, up);
    expect(result?.focal35mm).toBeCloseTo(trueFocal, 0);
  });

  it('線分が1本ではnull', () => {
    expect(estimateFocal35mm([{ p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, knownLength: 1 }], size, upVectorInCamera(-40, 0))).toBeNull();
  });
});

describe('方式B: 4隅によるホモグラフィ', () => {
  it('射影変換で歪ませたA4の4隅から、平面上の距離(mm)を復元する', () => {
    // 平面(mm)の点を、適当な射影変換で画像へ写す
    const forward = (p: Vec2): Vec2 => {
      const w = 1 + 0.0004 * p.x + 0.0008 * p.y;
      return { x: (1.1 * p.x + 0.2 * p.y + 300) / w, y: (0.1 * p.x + 0.9 * p.y + 200) / w };
    };
    const a4 = [
      { x: 0, y: 0 },
      { x: 297, y: 0 },
      { x: 297, y: 210 },
      { x: 0, y: 210 },
    ];
    const corners = a4.map(forward);
    const p1 = { x: 500, y: 700 };
    const p2 = { x: 1500, y: 900 };
    const d = planeDistanceViaTarget(corners, 297, 210, forward(p1), forward(p2));
    expect(d).toBeCloseTo(Math.hypot(p2.x - p1.x, p2.y - p1.y), 6);
  });

  it('恒等に近い対応で単位変換になる', () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const h = homographyFrom4(src, src.map((p) => ({ x: p.x * 2, y: p.y * 2 })))!;
    const out = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(out.x).toBeCloseTo(1, 9);
    expect(out.y).toBeCloseTo(1, 9);
  });

  it('同一直線上に潰れた4点はnull', () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(homographyFrom4(line, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBeNull();
  });
});

describe('verticalGuide', () => {
  it('真下向きなら消失点は画像中心', () => {
    const g = verticalGuide(cam, upVectorInCamera(-90, 0));
    expect(g.vanishing?.x).toBeCloseTo(cam.widthPx / 2, 6);
    expect(g.vanishing?.y).toBeCloseTo(cam.heightPx / 2, 6);
  });

  it('水平を向くと消失点は無限遠で、方向は画像の縦', () => {
    const g = verticalGuide(cam, upVectorInCamera(0, 0));
    expect(g.vanishing).toBeNull();
    expect(g.direction.y).toBeCloseTo(1, 6);
  });
});

describe('pixelRay', () => {
  it('画像中心は光軸方向', () => {
    expect(pixelRay({ x: 600, y: 800 }, cam)).toEqual({ x: 0, y: 0, z: 1 });
  });
});

/** カメラ座標の3D点を画素へ投影する（主点=画像中心）。 */
function projectCam(p: { x: number; y: number; z: number }, c: CameraModel): Vec2 {
  return { x: c.widthPx / 2 + (c.focalPx * p.x) / p.z, y: c.heightPx / 2 + (c.focalPx * p.y) / p.z };
}

/** 上向きupのカメラで、足元点footから高さ1の鉛直な線を撮った画像上の2点。 */
function verticalLine(foot: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }, c: CameraModel) {
  return { p1: projectCam(foot, c), p2: projectCam({ x: foot.x + up.x, y: foot.y + up.y, z: foot.z + up.z }, c) };
}

describe('upVectorFromVerticals', () => {
  it('合成した縦線2本から、撮影時の上向きを復元する（斜め下・ロールあり）', () => {
    const truth = upVectorInCamera(-25.7, 4);
    const lines = [verticalLine({ x: -1, y: 1.2, z: 4 }, truth, cam), verticalLine({ x: 1.5, y: 1.0, z: 5 }, truth, cam)];
    const up = upVectorFromVerticals(lines, cam)!;
    expect(up.x).toBeCloseTo(truth.x, 9);
    expect(up.y).toBeCloseTo(truth.y, 9);
    expect(up.z).toBeCloseTo(truth.z, 9);
  });

  it('線をなぞる向き（上→下／下→上）が混ざっても、上向きは画像の上側を向く', () => {
    const truth = upVectorInCamera(-10, -3);
    const a = verticalLine({ x: -1, y: 1, z: 4 }, truth, cam);
    const b = verticalLine({ x: 1, y: 1, z: 3 }, truth, cam);
    const up = upVectorFromVerticals([a, { p1: b.p2, p2: b.p1 }], cam)!;
    expect(up.y).toBeCloseTo(truth.y, 9);
    expect(up.y).toBeLessThan(0);
  });

  it('同じ線を2回なぞった（平行で区別できない）ときはnull', () => {
    const truth = upVectorInCamera(-20, 0);
    const a = verticalLine({ x: -1, y: 1, z: 4 }, truth, cam);
    expect(upVectorFromVerticals([a, a], cam)).toBeNull();
  });

  it('tiltFromUp: 求めた上向きを仰角・画像の傾きに戻せる', () => {
    const t = tiltFromUp(upVectorInCamera(-25.7, 4));
    expect(t.elevationDeg).toBeCloseTo(-25.7, 9);
    expect(t.imageRollDeg).toBeCloseTo(4, 9);
  });
});

describe('estimateFocalFromVerticals', () => {
  it('縦線2本とセンサーの上向きから、合成に使った焦点距離を復元する', () => {
    const truthCam = { ...size, focalPx: focalPxFrom35mm(44, size.widthPx, size.heightPx) };
    const sensorUp = upVectorInCamera(-25.7, 1);
    const lines = [
      verticalLine({ x: -1.2, y: 1.2, z: 3 }, sensorUp, truthCam),
      verticalLine({ x: 1.4, y: 1.0, z: 3.5 }, sensorUp, truthCam),
    ];
    const r = estimateFocalFromVerticals(lines, size, sensorUp)!;
    expect(r.focal35mm).toBeCloseTo(44, 1);
    expect(r.angleDeg).toBeLessThan(0.05);
  });
});
