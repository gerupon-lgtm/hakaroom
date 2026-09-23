import type { Point3D } from '../types';

/**
 * ARバックエンドの共通インターフェース（docs/api-design.md参照）。
 * 技術検証中は webxr-native/ と threejs/ の両方がこれを実装する。
 * 画面側（src/screens/）はこのインターフェースにのみ依存し、
 * どちらの実装かを意識しない。
 */
export interface ArBackend {
  /** WebXR/Hit Test等の対応可否を判定する（F-001） */
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  /** ARセッションを開始し、床平面を基準面として検出する（F-002） */
  start(): Promise<void>;

  /** 画面上の正規化座標(0-1)に対応する3次元位置を取得する。床/壁が検出できない場合はnull */
  hitTest(normalizedX: number, normalizedY: number): Promise<Point3D | null>;

  /** 追跡ロスト時に呼ばれる。直前まで記録した測点は呼び出し元(セッション状態)が保持する */
  onTrackingLost(callback: () => void): void;

  /** 追跡復帰後、基準面を取り直す。既存測点の座標系は再計算される */
  reacquireReference(): Promise<void>;

  /** 短時間の測点位置のばらつきを監視し、閾値を超えたら通知する（F-017） */
  onInstability(callback: (magnitude: number) => void): void;

  stop(): Promise<void>;
}
