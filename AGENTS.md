# ハカルーム（Codex/ChatGPT向け）

共通の実装規約・技術スタック・タイムゾーン方針・変更禁止事項は [`docs/implementation-guide.md`](docs/implementation-guide.md) を参照する（Claude Codeと共通）。

## Codex/ChatGPT固有の事項

- このプロジェクトはClaude Codeでの初期実装（プロジェクト雛形〜技術検証、`docs/tasks.md` フェーズ0）から引き継ぐ想定
- 着手前に `docs/implementation-guide.md` の「変更禁止事項」「検証済みの事実」を必ず読み、Claude Code側で確定した内容を上書きしない
- タスク着手時は `docs/tasks.md` の該当タスクの完了条件・検証方法を先に読む
- **引き継ぎ時は最初に [`引継ぎ資料_ハカルーム.md`](引継ぎ資料_ハカルーム.md) を読む**（依頼者との進め方、実機検証の結果、未解決の論点）
