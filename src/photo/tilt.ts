import type { TiltInfo } from '../types';

export interface GravitySample {
  ax: number;
  ay: number;
  az: number;
}

/**
 * accelerationIncludingGravity（端末が静止しているとき、重力と逆向き=上向きを示す）から、
 * 背面カメラの光軸の傾きを求める。端末座標: x=右, y=画面の上, z=画面の手前。
 * 光軸は端末座標の (0,0,-1)。
 *  - elevationDeg: 光軸の水平からの角度。真下を向く=-90、水平=0、真上=+90
 *  - rollDeg: 光軸まわりの回転。縦持ちで水平を向く=0。真下/真上向きでは不安定になる
 * 符号の前提（静止・画面上向きで az≈+9.8）は実機で確認する（画面に生の値も表示する）。
 */
export function gravityToTilt(sample: GravitySample): { elevationDeg: number; rollDeg: number } {
  const norm = Math.hypot(sample.ax, sample.ay, sample.az);
  if (norm === 0) return { elevationDeg: 0, rollDeg: 0 };
  const ux = sample.ax / norm;
  const uy = sample.ay / norm;
  const uz = sample.az / norm;
  const elevationDeg = (Math.asin(clamp(-uz, -1, 1)) * 180) / Math.PI;
  const rollDeg = (Math.atan2(ux, uy) * 180) / Math.PI;
  return { elevationDeg, rollDeg };
}

/** 複数サンプルの平均（重力ベクトルを平均してから角度化）と、仰角のばらつきを返す。 */
export function summarizeTilt(samples: GravitySample[]): TiltInfo | null {
  if (samples.length === 0) return null;
  const mean = samples.reduce(
    (acc, s) => ({ ax: acc.ax + s.ax / samples.length, ay: acc.ay + s.ay / samples.length, az: acc.az + s.az / samples.length }),
    { ax: 0, ay: 0, az: 0 },
  );
  const { elevationDeg, rollDeg } = gravityToTilt(mean);
  const elevations = samples.map((s) => gravityToTilt(s).elevationDeg);
  const meanElevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;
  const variance = elevations.reduce((a, b) => a + (b - meanElevation) ** 2, 0) / elevations.length;
  return { elevationDeg, rollDeg, sampleCount: samples.length, elevationStdDevDeg: Math.sqrt(variance) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
