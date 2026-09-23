# ハカルーム（Claude Code向け）

共通の実装規約・技術スタック・タイムゾーン方針・変更禁止事項は [`docs/implementation-guide.md`](docs/implementation-guide.md) を参照する（Codex/ChatGPTと共通）。

## Claude Code固有の事項

- 実装の初期フェーズ（プロジェクト雛形〜技術検証、`docs/tasks.md` フェーズ0）はこのセッション（Claude Code）で担当する
- 途中でCodex（`AGENTS.md` 経由）へ引き継ぐ想定。引き継ぎ時は `docs/tasks.md` の進捗（完了したタスクID）と、`docs/implementation-guide.md` の「変更禁止事項」「検証済みの事実」を最新化してから引き渡す
- タスク着手時は `docs/tasks.md` の該当タスクの完了条件・検証方法を先に読む
