# データモデル

サーバーを持たないため「テーブル」ではなく、`localStorage` に1キーで保存するJSONの構造として定義する。キーは `hakaroom.v1`。

```ts
interface StorageRoot {
  schemaVersion: number;                    // 現在: 1。将来フォーマット変更時にマイグレーションの判定に使う
  currentSession: MeasurementSession | null; // 進行中のセッション（同時に1つのみ、確定）
  verificationRecords: VerificationRecord[]; // 完了・破棄済みセッションの記録。最大100件、FIFOで自動削除
}
```

## MeasurementSession（計測セッション）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string (uuid) | ◯ | セッションID |
| type | `'room'` \| `'quick-distance'` | ◯ | 部屋計測（F-003〜、L字含む）か簡易2点間計測（F-016）か |
| status | `'in-progress'` \| `'completed'` \| `'discarded'` | ◯ | 状態 |
| measurementMethod | `'webxr-native'` \| `'threejs'` \| `null` | ◯ | 使用したARバックエンド。技術検証中は両方の実装が存在するため記録する【想定：本採用決定後は固定値化を検討】 |
| points | MeasurementPoint[] | ◯ | 記録済み測点（順不同で削除されうるため `order` で表示順を管理） |
| referenceMode | `'none'` \| `'tape-measure'` \| `'registered-object'` \| `'custom-object'` | ◯ | 縮尺基準モード（F-012） |
| referenceObjects | ReferenceObjectPlacement[] | ◯ | 配置した基準物（複数可、確定） |
| correspondencePoints | CorrespondencePoint[] | ◯ | 対応点（F-010）。リアルタイム・バッチ撮影の両方をここに格納 |
| dimensionValues | DimensionValues \| null | — | 4点（またはL字5点以上）が揃うまでは `null` |
| trackingLostCount | number | ◯ | 追跡ロスト回数。0以上。ロスト時は測点を保持したまま基準を取り直す（要件定義書7.2） |
| createdAt | string (ISO8601, UTC) | ◯ | 作成日時 |
| completedAt | string (ISO8601, UTC) \| null | — | 完了（またはユーザーが「ここで終了」を選択）した日時 |

## MeasurementPoint（測点）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string (uuid) | ◯ | 測点ID |
| order | number | ◯ | 表示順。削除で欠番が出ても再採番しない |
| position | `{ x: number; y: number; z: number }` | ◯ | セッションのローカル座標系での位置（メートル）。基準取り直し後は再計算される |
| capturedAt | string (ISO8601, UTC) | ◯ | 記録日時 |

## DimensionValues（寸法値。生値/補正値/手入力値を区別、C-02）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| raw.edgeLengths | number[] | ◯ | 隣接測点間の3次元ユークリッド距離（メートル） |
| raw.perimeter | number | ◯ | `edgeLengths` の合計 |
| raw.area | number | ◯ | Shoelace公式による面積（平方メートル） |
| raw.closureError | number \| null | — | 部屋を一周した場合の始点・終点のずれ（メートル）。L字等一周しない形状では `null` |
| corrected | 上記と同型 \| null | — | 基準物・対応点・幾何条件による補正後の値。補正を適用していなければ `null` |
| corrected.appliedCorrections | string[] | — | 適用した補正手法のID（例: `'reference-object'`, `'geometry-constraint'`） |
| manual.edgeLengths | (number \| null)[] | — | 利用者が手修正した辺長（F-018）。未修正の辺は `null` |
| manual.area | number \| null | — | 利用者が手修正した面積 |

`raw` は補正・手修正があっても上書きしない（C-02）。表示側は `raw`/`corrected`/`manual` を切り替えて参照する。

## ReferenceObjectPlacement（基準物の配置。複数配置に対応、確定）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string (uuid) | ◯ | 配置ID |
| mode | `'tape-measure'` \| `'registered-object'` \| `'custom-object'` | ◯ | 基準モード |
| objectType | `'A4'` \| `'custom'` \| `null` | — | 登録済み基準物の種類。初期版はA4のみ対応 |
| placementIndex | number | ◯ | 同一セッション内の配置番号（0始まり）。複数配置時の識別に使う |
| autoDetectedCorners | `Point2D[]` \| `null` | — | 自動検出結果（確定前）。C-03によりこの値だけでは計算に使わない |
| confirmedCorners | `Point2D[]` | ◯ | 利用者が確認・修正して確定した輪郭点。**これが無い配置は補正計算から除外する（C-03）** |
| knownDistanceMeters | number \| null | — | メジャー／任意基準物モードでの実寸入力値 |
| capturedAt | string (ISO8601, UTC) | ◯ | 撮影日時 |

複数配置（`placementIndex` が2件以上）を統合するか比較のみに使うかは【要確認】（要件定義書20章 No.9）。暫定実装は「配置ごとに算出した縮尺・寸法を一覧表示し、利用者が採用する1件を選ぶ」とする（`docs/api-design.md` 参照）。

## CorrespondencePoint（対応点）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string (uuid) | ◯ | 対応点ID |
| photoAId / photoBId | string | ◯ | 対応する2枚の画像のID（`src/storage` 内で一時管理。画像自体は永続化しない、確定） |
| imageCoordA / imageCoordB | `{ x: number; y: number }` | ◯ | それぞれの画像上のピクセル座標 |
| usage | `'validation-only'` \| `'correction'` | ◯ | WebXR測点の検証専用か、補正計算にも使うか（両方許可、確定） |

## VerificationRecord（検証記録）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string (uuid) | ◯ | 記録ID |
| sessionSnapshot | MeasurementSession | ◯ | 完了/破棄時点のセッション全体のスナップショット（画像は含まない） |
| measurementCount | number | ◯ | 同一対象への計測回数（利用者入力または自動採番） |
| actualValues | number[] | ◯ | 実測値（メジャー等で得た値） |
| errorValues | number[] \| null | — | 計測値と実測値の差。実測値未入力の間は `null` |
| environmentConditions | `{ lighting?: string; notes?: string }` | — | 環境条件（照度・メモ等） |
| deviceInfo | `{ model: string; os: string; browser: string; appVersion: string }` | ◯ | 端末情報。`appVersion` はビルド時の `APP_VERSION` を参照（同値検証対象） |
| measuredAt | string (ISO8601, UTC) | ◯ | 記録日時 |
| editedAt | string (ISO8601, UTC) \| null | — | 完了後に編集した場合の最終編集日時（編集可能、確定） |

- 検証記録は完了後も編集・個別削除が可能（確定）。削除は取り消し不可（Undo無し、確定）
- `verificationRecords` は最大100件（暫定値、要件定義書20章 No.10）。追加時に100件を超える場合は `measuredAt` が最も古いものから削除する（FIFO、確定）

## リレーション

- `MeasurementSession` 1 - N `MeasurementPoint` / `ReferenceObjectPlacement` / `CorrespondencePoint`（セッションに従属、セッション削除で連動して破棄）
- `VerificationRecord` 1 - 1 `MeasurementSession`（スナップショットとして埋め込み。正規化せず、後から見返せることを優先）
