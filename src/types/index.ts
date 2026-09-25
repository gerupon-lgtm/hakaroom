// 共通型定義。詳細は docs/data-model.md を参照。

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export type ReferenceMode = 'none' | 'tape-measure' | 'registered-object' | 'custom-object';

export interface MeasurementPoint {
  id: string;
  order: number;
  position: Point3D;
  capturedAt: string; // ISO8601, UTC
}

export interface DimensionSet {
  edgeLengths: number[];
  perimeter: number;
  area: number;
  closureError: number | null;
}

export interface DimensionValues {
  raw: DimensionSet;
  corrected: (DimensionSet & { appliedCorrections: string[] }) | null;
  manual: { edgeLengths: (number | null)[]; area: number | null } | null;
}

export interface ReferenceObjectPlacement {
  id: string;
  mode: ReferenceMode;
  objectType: 'A4' | 'custom' | null;
  placementIndex: number;
  autoDetectedCorners: Point2D[] | null;
  confirmedCorners: Point2D[] | null; // C-03: これがnullの間は補正計算に使わない
  knownDistanceMeters: number | null;
  capturedAt: string;
}

export interface CorrespondencePoint {
  id: string;
  photoAId: string;
  photoBId: string;
  imageCoordA: Point2D;
  imageCoordB: Point2D;
  usage: 'validation-only' | 'correction';
}

export type MeasurementMethod = 'webxr-native' | 'threejs' | null;

export interface MeasurementSession {
  id: string;
  type: 'room' | 'quick-distance';
  status: 'in-progress' | 'completed' | 'discarded';
  measurementMethod: MeasurementMethod;
  points: MeasurementPoint[];
  referenceMode: ReferenceMode;
  referenceObjects: ReferenceObjectPlacement[];
  correspondencePoints: CorrespondencePoint[];
  dimensionValues: DimensionValues | null;
  trackingLostCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface DeviceInfo {
  model: string;
  os: string;
  browser: string;
  appVersion: string;
}

export interface VerificationRecord {
  id: string;
  sessionSnapshot: MeasurementSession;
  measurementCount: number;
  actualValues: number[];
  errorValues: number[] | null;
  environmentConditions: { lighting?: string; notes?: string };
  deviceInfo: DeviceInfo;
  measuredAt: string;
  editedAt: string | null;
}

/** 撮影時の傾き。elevationDegは光軸の水平からの角度（真下=-90、水平=0）、rollDegは光軸まわりの回転。 */
export interface TiltInfo {
  elevationDeg: number;
  rollDeg: number;
  sampleCount: number;
  elevationStdDevDeg: number;
  /** 撮影時の画面の向き(screen.orientation.angle)。取得できなければ未設定。 */
  screenAngleDeg?: number;
}

/** 写真方式の写真（docs/data-model.md「PhotoRecord」）。IndexedDBに保存する。 */
export interface PhotoRecord {
  id: string;
  blob: Blob;
  source: 'in-app-camera' | 'gallery';
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  focalLength35mm: number | null;
  tilt: TiltInfo | null;
  capturedAt: string; // ISO8601, UTC
  processing: { longSidePx: number; quality: number; grayscale: boolean };
  byteSize: number;
}

export interface StorageRoot {
  schemaVersion: number;
  currentSession: MeasurementSession | null;
  verificationRecords: VerificationRecord[];
}
