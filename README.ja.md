# SlipKit

[한국어](README.md) · [English](README.en.md)

UIで伝票（テンプレート文書）を簡単に作成・表示・出力できる**組み込み型パッケージツール**。

外部プロジェクトがこのパッケージをインストール（install）すると、自身のアプリ内で伝票テンプレートをデザインし、
データを入力して伝票を発行・照会・印刷・PDF出力できる。

- npmスコープ: `@omdc-slipkit/*` (`core` / `elements` / `react` / `vue`)
- ファイル拡張子: `.slip`
- カスタムエレメント: `<slip-designer>`, `<slip-form>`, `<slip-viewer>` など

## 主な特徴

- **汎用テンプレートエンジン**: 取引明細書・請求書のような文書型伝票から会計仕訳伝票まで、テンプレートで表現
- **一般ユーザー向けGUIデザイナー**: 非開発者がドラッグ&ドロップでテンプレートを直接設計（セル結合・色スタイル・undo対応）
- **どのスタックでも動作**: Web Component(Lit)ベースの配布 + React/Vueの薄いラッパー
- **印刷・PDFを第一級でサポート**: 用紙(A4など)基準のレイアウト、画面 = 印刷 = PDFが一致。PDFエンジンはpdfme(直接検証済み、外部非公開)
- **ファイルで完結**: 伝票はJSONベースの`.slip`ファイルで保存 — テンプレートのスナップショットを内蔵、SHA-256ハッシュ必須 + JWS署名オプション

## ローカルですぐ確認する（デモ）

別途サーバー不要で、すべてブラウザ内で動作する。クローン後:

```bash
pnpm install
pnpm demo         # バニラ → http://localhost:5173
pnpm demo:react   # React  → http://localhost:5174
pnpm demo:vue     # Vue    → http://localhost:5175
```

テンプレート作成（要素の追加・ドラッグ・スナップ・表・図形・数式・サンプルデータ・マイテンプレート保存）と
伝票入力（値の入力・数式の即時計算・発行）を一画面で行き来しながら試せる。
編集内容はブラウザに自動保存され、リロードしても作業を続けられ、
ファイルへのダウンロード・オープンで`.slip`ファイルをやり取りできる。
デモはライブラリのソースを直接参照するため、コードを修正するとリロードなしですぐ反映される。

**デモ3種 - 使用するフレームワークに合った例を参照してください。(機能上の違いはありません。)**

| 例 | 組み込み方法 |
|---|---|
| [`examples/demo`](examples/demo) | カスタムエレメントをそのまま (`<slip-designer>`・`<slip-form>`) |
| [`examples/react-demo`](examples/react-demo) | `@omdc-slipkit/react` ラッパーコンポーネント + フック |
| [`examples/vue-demo`](examples/vue-demo) | `@omdc-slipkit/vue` ラッパーコンポーネント + SFC |

何を保存し、いつ作業を続けるかといった**画面に依存しないロジックは
[`examples/shared`](examples/shared)** の一箇所に置き、3つのデモが共通で使う。

## 利用ガイド

ホストアプリにSlipKitを組み込む方法は**[利用ガイド](docs/guide/)**を参照。
インストールからテンプレートデザイナー・伝票入力フォーム・ビューアの連携、ストレージアダプター、サーバー連携まで段階的に説明する。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/guide/](docs/guide/) | **利用ガイド** — インストール・連携・API ([日本語](docs/guide/README.ja.md)) + [数式関数](docs/guide/formula.ja.md) · [型リファレンス](docs/guide/types.ja.md) · [フォント・プリセット](docs/guide/fonts-and-presets.ja.md) |
| [docs/SPEC.md](docs/SPEC.md) | `.slip` ファイルフォーマットの公開規範仕様 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ — 外部システム連携 (ダイアグラム含む) |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 確定した要件の整理 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 設計決定ログ(ADR-001~035) — 各決定の根拠と背景 |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | 未決事項の一覧 (現在すべて解決済み) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | ロードマップ · セッション引き継ぎ — 現在の状態と次の作業 |
| [CLAUDE.md](CLAUDE.md) | 開発ルール — すべてのClaude Codeセッションに自動適用 (ADR-024) |
| [.claude/rules/branching.md](.claude/rules/branching.md) | ブランチ・コミット・PRルール (ADR-023/024) |
| [docs/Q08-PDFME-EVAL.md](docs/Q08-PDFME-EVAL.md) | pdfme評価レポート |
| [docs/TECH-RESEARCH.md](docs/TECH-RESEARCH.md) | 技術動向リサーチ (2026-08) |

> **ドキュメント運用ルール**: 新しい設計決定は必ずDECISIONS.mdに追加し、
> 既存の決定と矛盾する変更は既存の決定を "Superseded" と表示したうえで新しい決定として記録する。
> REQUIREMENTS.mdは常にDECISIONS.mdと一致していなければならない。

## ライセンス

Business Source License 1.1（**BUSL-1.1**）— ソース公開型で、OSI のオープンソースではありません。
自分のアプリに組み込む本番利用は許可されますが、SlipKit と競合するホスト型・組み込み型の商用製品・
サービスとして第三者に提供するには商用ライセンスが必要です。**Change Date 2031-01-01** に Apache
License 2.0 へ移行します。全文は [LICENSE](LICENSE)、著作権者は JangHyeonho。同梱フォント
Pretendard・Noto Sans JP はそれぞれ SIL Open Font License 1.1 です（コードのライセンスとは別）。
