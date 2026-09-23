# ハカルーム 実装ガイド（共通本文）

Claude Code（`CLAUDE.md`）とCodex/ChatGPT（`AGENTS.md`）の両方から参照される共通本文。ツール固有の事項はそれぞれの入口ファイルに書き、規約はここに一本化する。

## 概要

スマートフォンのブラウザ（WebXR）だけで、部屋の角を指定するだけの操作から壁長・面積・簡易平面図までを一続きにできるかを、実測値との比較検証を通じて確認するWebアプリ。初期利用者は開発者本人（Pixel 6a／Android版Chrome）。サーバーを持たず、計測データは端末内（localStorage）に閉じる。

## 前提（仮置き）

以下は【想定】＝技術的・可逆的な既定値。変更時は関連ドキュメント（括弧内）も更新する。

- AR計測バックエンドは、技術検証（`docs/tasks.md` T-003/T-004）で素のWebXR Device API実装とThree.js実装を両方試作してから最終決定する。本ガイドの技術スタックには暫定でThree.jsを本採用候補として記載する（`docs/api-design.md`）
- 基準物の輪郭自動検出ライブラリは未選定。候補はOpenCV.js（`docs/api-design.md`）
- 検証記録の保持上限は100件、FIFOで自動削除する（`docs/data-model.md`）
- デザイントークン（フォント・アイコン）はモック未作成のため暫定値（`docs/screens.md`）
- 複数配置した同一種類の基準物から得た情報の統合方法は未定（要件定義書20章 No.9）。実装時は「配置ごとの結果を一覧表示し、利用者が採用する1件を選ぶ」を暫定仕様とする（`docs/api-design.md`）

## 技術スタック

- 言語/FW: Vite + TypeScript（フレームワークなし）
- AR/3D: 技術検証中（WebXR Device API 素実装 と Three.js の両方を試作・比較）。本採用候補はThree.js【想定】
- 描画（簡易平面図）: 素のSVG（DOM API、ライブラリ不使用）
- データ永続化: `localStorage`（JSON、`schemaVersion` 管理）。画像は永続化しない（メタデータのみ保存、確定）
- テスト: Vitest（幾何計算ロジックのユニットテスト中心）。実機（Pixel 6a）確認は開発者本人が手動で実施
- デプロイ: GitHub Pages（GitHub Actionsでビルド・デプロイ）
- リポジトリ: `hakaroom`（個人GitHubアカウント）

## ディレクトリ構成

```
hakaroom/
├── src/
│   ├── main.ts
│   ├── ar/
│   │   ├── ar-backend.ts       # 共通インターフェース ArBackend
│   │   ├── webxr-native/       # 素のWebXR Device API実装
│   │   └── threejs/            # Three.js実装
│   ├── geometry/                # 距離・面積・補正計算（純粋関数、Vitest対象）
│   ├── calibration/             # 基準物・対応点による縮尺補正
│   ├── storage/                 # localStorage永続化層（storage.ts）
│   ├── screens/                 # 画面ごとのUIモジュール（S-001〜S-007に対応）
│   └── types/                   # 共通型定義
├── docs/
├── tests/
├── CLAUDE.md
├── AGENTS.md
└── .github/workflows/deploy.yml
```

## 規約

- 命名: ファイル・変数はキャメルケース、型・クラスはパスカルケース
- コミットメッセージに `docs/tasks.md` のタスクID（例: `T-007`）を含める
- 幾何計算（`src/geometry/`, `src/calibration/`）は必ず純粋関数にし、DOM/AR APIに依存させない（Vitestで検証するため）
- AR実装（`src/ar/webxr-native/`, `src/ar/threejs/`）は共通インターフェース `ArBackend`（`docs/api-design.md`）を実装し、画面側はバックエンド差異を意識しない

## バージョン管理

- 形式: `hakaroom-MAJOR.MINOR.PATCH`
- 現在版: `hakaroom-0.5.0`（正典は `src/version.ts`。この節の値は更新を忘れがちなので、変更時は必ず両方直す）
- 増分: PATCH=小修正 / MINOR=後方互換のある機能追加・中規模変更 / MAJOR=破壊的・大規模変更
- リセット: MINOR更新時はPATCH=0、MAJOR更新時はMINOR=0かつPATCH=0
- 正典: `src/version.ts` の `export const APP_VERSION = 'hakaroom-0.1.0'`
- 反映先: フッタ表示（`docs/screens.md` デザイントークン）、検証記録の `deviceInfo.appVersion`
- 同値検証: `src/version.ts` の値とフッタ表示コンポーネントが同一値を参照する（別々にハードコードしない）ことをユニットテストで確認する

## 日時・タイムゾーン

- 基準タイムゾーン: `Asia/Tokyo`（JST）。固定オフセット `+09:00` ではなくIANA ID `Asia/Tokyo` で保持する
- 保存: 検証記録の日時（`measuredAt`, `capturedAt` 等）は**UTCに正規化**して保存する（ISO 8601文字列、例 `2026-09-23T01:00:00.000Z`）
- 表示: 利用者の環境タイムゾーンに追従して表示し、取得できない／不定な場合は `Asia/Tokyo` にフォールバックする。UTCのまま表示しない
- 表示形式: `yyyy/MM/dd HH:mm`。初期利用者は国内のみのため基準表記の併記は不要【想定】
- 「日付だけ」の値: 本アプリには現時点で該当する項目なし（検証記録は時刻付きのイベントのみ）
- 使用ライブラリ: ブラウザ標準の `Intl.DateTimeFormat` を使用し、自前のオフセット計算をしない
- 禁止: `new Date()` の暗黙ローカル解釈をそのまま保存に使うこと、固定オフセット `+09:00` のハードコード
- テスト: 日時変換のユニットテストは `TZ=UTC` で実行し、UTC→JST表示変換が正しいことを確認する

## コマンド

- 開発サーバ: `npm run dev`
- テスト: `npm test`
- ビルド: `npm run build`
- デプロイ: GitHub Actions（`main` ブランチへのpushで自動デプロイ）

## 実装上の注意

- WebXRはセキュアコンテキスト（HTTPS）必須。ローカル開発時は `vite --https` またはトンネル（ngrok等）で実機確認する
- カメラ・AR系のAPIは非対応環境で例外を投げるため、`src/ar/ar-backend.ts` の対応環境チェック（F-001）を経ずに他画面から直接呼び出さない
- 検証データ（測点・寸法値・検証記録・撮影に伴うメタデータ）は**サーバーへ送信しない**（要件定義書 C-01）。ネットワーク送信を伴うコードを追加する場合は要件定義書の改訂を先に行う
- 生値・補正値・手入力値は別フィールドで保持し、上書きしない（要件定義書 C-02）。補正ロジックの追加・変更は既存フィールドを壊さない形で行う
- 基準物の自動検出結果は、利用者が確認・修正してから確定するまで縮尺計算に使わない（要件定義書 C-03）。`confirmedCorners` が未設定の `ReferenceObjectPlacement` は補正計算の入力に含めない

## 変更禁止事項（根拠つき）

- **immersive-arセッション中に `window.alert`/`prompt`/`confirm` 等のブロッキングダイアログを呼ばない**。実機検証で `window.prompt()` を呼ぶとセッションが強制終了することを確認した（下記「検証済みの事実」参照）。値の入力が必要な場合は、DOM Overlay内のHTML要素（`<input>`等）で完結させる（`src/ar/webxr-native/two-point-prototype.ts` の `xr-actual-input-row` を参照）

## 検証済みの事実

| 事実 | 検証方法 | 根拠 | 確認日 |
|------|----------|------|--------|
| immersive-arセッション中に `window.prompt()` を呼ぶとセッションが強制終了する | 実機(Pixel 6a / Android Chrome)でAR中に2点計測完了後 `window.prompt()` を呼び出し、ARが終了して呼び出し元の画面に戻ることを確認 | ユーザー報告＋実装での再現・修正（`window.prompt`をDOM Overlay内input要素に置換） | 2026-09-23 |
| 事実 | 検証方法 | 根拠 | 確認日 |
|------|----------|------|--------|
| （未実施） | — | — | — |

## 参照

- 要件定義書: `../要件定義書_ハカルーム.md`（機能IDはここを正とする）
- 設計: `docs/data-model.md`, `docs/screens.md`, `docs/api-design.md`, `docs/tasks.md`
