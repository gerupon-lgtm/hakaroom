# 処理設計（内部モジュール）

外部システム連携・サーバーAPIは無い（要件定義書11章）ため、ここでは実装AIが迷いやすい**内部モジュールのインターフェース**を定義する。特に、技術検証で2方式を並行実装するARバックエンドの抽象化と、幾何計算ロジックの純粋関数化がトレーサビリティ上重要。

## ArBackend（ARバックエンドの共通インターフェース）

技術検証（`docs/tasks.md` T-003/T-004）でWebXR Device API素実装とThree.js実装の両方を試作し、比較したうえで最終的にどちらか一方（または両方を状況により使い分け）を採用する。**画面側コード（`src/screens/`）はこのインターフェースにのみ依存し、どちらの実装かを意識しない。**

```ts
interface ArBackend {
  /** WebXR/Hit Test等の対応可否を判定する（F-001） */
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  /** ARセッションを開始し、床平面を基準面として検出する（F-002） */
  start(): Promise<void>;

  /** 画面上の座標(0-1正規化)に対応する3次元位置を取得する。床/壁が検出できない場合はnull */
  hitTest(normalizedX: number, normalizedY: number): Promise<{ x: number; y: number; z: number } | null>;

  /** 追跡ロスト時に呼ばれる。直前まで記録した測点は呼び出し元(セッション状態)が保持する */
  onTrackingLost(callback: () => void): void;

  /** 追跡復帰後、基準面を取り直す。既存測点の座標系は再計算される */
  reacquireReference(): Promise<void>;

  /** 短時間の測点位置のばらつきを監視し、閾値を超えたら通知する（F-017） */
  onInstability(callback: (magnitude: number) => void): void;

  stop(): Promise<void>;
}
```

- `src/ar/webxr-native/index.ts` と `src/ar/threejs/index.ts` はそれぞれこのインターフェースを実装する
- 不安定判定の閾値（`onInstability` の発火条件）は技術検証で実測してから確定する【想定】

## geometry（幾何計算。純粋関数、Vitestで単体テスト必須）

```ts
// src/geometry/distance.ts
function euclideanDistance3D(a: Point3D, b: Point3D): number;

// src/geometry/polygon.ts
function computeEdgeLengths(points: Point3D[]): number[];       // 隣接点間の距離（閉多角形として最後→最初も含む）
function computePerimeter(edgeLengths: number[]): number;
function computePolygonArea(points: Point3D[]): number;         // Shoelace公式。points は床平面へ投影済みであること
function computeClosureError(startPoint: Point3D | null, closingMeasurement: Point3D | null): number | null;
// 始点を再度Hit Testし直した位置(closingMeasurement)との差。再測定しない場合や
// L字等一周しない形状ではnull。単純な「最後→最初の辺長」は誤差ではないため使わない
// （実装時に判明。docs/tasks.md T-008参照）
```

- 面積計算（Shoelace公式）は3次元の測点を床平面（法線ベクトル）へ投影してから2次元多角形として計算する。投影ロジックは `src/geometry/projection.ts` に分離する
- 単位はメートルで内部保持し、表示時のみセンチメートル四捨五入に変換する（要件定義書9章）

### 移植・準拠ロジックのテスト方針

Shoelace公式・3次元ユークリッド距離は一般的な幾何公式であり「移植元」は無いが、要件定義書9章の正確性・準拠基準に従い、**固定の既知座標（例: 3-4-5の直角三角形、1辺1mの正方形）を使った期待値テスト**を用意し、実装ミスではなく公式適用の誤りを検出できるようにする。

## calibration（縮尺補正）

```ts
// src/calibration/reference-object.ts
function estimateScaleFromReferenceObject(
  placement: ReferenceObjectPlacement, // confirmedCornersが必須（C-03）
): { scaleFactor: number } | null;     // confirmedCornersが無い場合はnullを返し、呼び出し元は補正に使わない

// src/calibration/multi-placement.ts
function listPlacementResults(
  placements: ReferenceObjectPlacement[],
): Array<{ placementIndex: number; scaleFactor: number }>;
// 複数配置の統合方法は未決定（要件定義書20章No.9）。
// 暫定実装: 統合(平均化等)はせず、配置ごとの結果を一覧で返し、画面側(S-003)で利用者に1件選ばせる。

// src/calibration/geometry-constraint.ts
function applyGeometryConstraints(
  rawPoints: Point3D[],
  constraints: { floorPlane: boolean; verticalWalls: boolean; rightAngles: boolean }, // 全条件を組み込む(確定)
): Point3D[];

// src/calibration/correspondence.ts
function estimateFromCorrespondence(
  points: CorrespondencePoint[],
  knownDistanceMeters: number | null,
): { orientation: unknown; scale: number | null; note: string };
// カメラ位置固定(視差なし)の場合はscaleがnullになりうる（要件定義書3章の技術的懸念を参照）。
// nullの場合は「奥行きを一意に決められない」旨をUIに伝える。
```

- 基準物の輪郭自動検出（F-013）は初期実装で `src/calibration/contour-detection.ts` に分離する。使用ライブラリは未選定、候補はOpenCV.js【想定：技術検証で確定】

## storage（永続化）

```ts
// src/storage/index.ts
function loadStorageRoot(): StorageRoot;                 // 破損・schemaVersion不一致時は初期状態にフォールバックし警告ログを出す
function saveCurrentSession(session: MeasurementSession | null): void;
function appendVerificationRecord(record: VerificationRecord): void; // 追加時に100件超過なら最古のものから自動削除(FIFO)
function updateVerificationRecord(id: string, patch: Partial<VerificationRecord>): void;
function deleteVerificationRecord(id: string): void;      // 削除は取り消し不可（確定）
```

- `schemaVersion` が保存データと実装側で不一致の場合のマイグレーション方針は未実装（現状は `schemaVersion: 1` のみ運用のため未着手）。将来バージョンアップ時に `docs/data-model.md` と合わせて設計する
