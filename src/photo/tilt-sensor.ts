import type { TiltInfo } from '../types';
import { gravityToTilt, summarizeTilt, type GravitySample } from './tilt';

const MAX_SAMPLES = 30;

/**
 * devicemotionのaccelerationIncludingGravityから直近のサンプルを保持し、
 * 現在値・撮影時の平均(と、ばらつき)を取得できるようにする。
 * ブラウザ側のセンサーが使えない場合は available=false のまま。
 */
export class TiltSensor {
  private samples: GravitySample[] = [];
  private lastRaw: GravitySample | null = null;
  private listener = (event: DeviceMotionEvent) => {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    const sample = { ax: g.x, ay: g.y, az: g.z };
    this.lastRaw = sample;
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  };
  private running = false;

  start(): void {
    if (this.running) return;
    window.addEventListener('devicemotion', this.listener);
    this.running = true;
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.listener);
    this.running = false;
    this.samples = [];
    this.lastRaw = null;
  }

  /** 最新の生値(ax,ay,az)。まだイベントが来ていなければnull。 */
  get raw(): GravitySample | null {
    return this.lastRaw;
  }

  /** 最新1サンプルの傾き（ライブ表示用）。 */
  current(): { elevationDeg: number; rollDeg: number } | null {
    return this.lastRaw ? gravityToTilt(this.lastRaw) : null;
  }

  /** 直近サンプルの平均とばらつき（撮影時に保存する値）。 */
  snapshot(): TiltInfo | null {
    return summarizeTilt(this.samples);
  }
}
