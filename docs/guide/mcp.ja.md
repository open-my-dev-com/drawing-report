# SlipKit MCP 利用ガイド

[한국어](mcp.md) · [English](mcp.en.md)

`@omdc-slipkit/mcp` は、AI が指定されたローカルディレクトリ内の `.slip` テンプレートと伝票を読み取り、作成・編集できる stdio MCP サーバーです。テンプレートから未発行伝票を作成したり、テンプレートや伝票を PDF にレンダリングしたりできます。

別のターミナルでサーバーを起動し続ける必要はありません。stdio 方式では、MCP クライアントが設定された `command` と `args` を使ってサーバーをローカルの子プロセスとして起動し、接続終了時に停止します。実行ファイルと作業ディレクトリを MCP 設定に登録すれば利用できます。

> [!IMPORTANT]
> SlipKit パッケージはまだ npm レジストリに公開されていません。現在はこのリポジトリでパッケージをビルドし、生成された CLI を MCP クライアントに接続してください。

## 事前準備

- Node.js 22.13 以上
- pnpm 10.33.0
- ローカル stdio MCP サーバーに接続できる MCP クライアント

リポジトリのルートで依存関係をインストールし、MCP パッケージをビルドします。

```bash
pnpm install
pnpm --filter @omdc-slipkit/mcp build
mkdir slip-workspace
```

`slip-workspace` は、AI がアクセスする `.slip` ファイルと画像を配置する作業ディレクトリの例です。別のディレクトリも使用できます。

## MCP クライアントへの接続

クライアントの stdio MCP サーバー設定に次の内容を追加します。設定ファイルの場所と最上位キーはクライアントによって異なります。

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "/absolute/path/to/slip-workspace",
        "--locale",
        "ja"
      ]
    }
  }
}
```

2 つのパスは実際の絶対パスに置き換えてください。設定保存後、MCP クライアントを再起動するか、MCP サーバー一覧を再読み込みします。`slip_list` や `slip_read` を含む 7 つのツールが表示されれば、接続は完了です。

### 設定の保存場所

SlipKit MCP サーバー自体は設定ファイルを作成しません。作業ディレクトリとロケールはコマンド引数、暗号化キーは環境変数として受け取ります。この起動設定の保存場所は MCP クライアントが決定します。

| クライアント | 保存場所と登録方法 |
|---|---|
| Codex CLI | ユーザー設定 `~/.codex/config.toml`。TOML を直接編集せず、`codex mcp add` で登録できます。 |
| Claude Code | `local`、`user`、`project` スコープを選択できます。`project` スコープはリポジトリの `.mcp.json` を使用します。現在の開発段階では端末固有の絶対パスを含むため、`local` スコープが適しています。 |
| その他のクライアント | そのクライアントが定めるユーザーまたはプロジェクト MCP 設定に、同じ `command`、`args`、`env` を登録します。 |

現在のリポジトリビルドを Codex CLI に登録する例:

```bash
codex mcp add slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  /absolute/path/to/slip-workspace --locale ja
```

Claude Code では次のように登録できます。`local` スコープを使うと、端末固有のパスを `.mcp.json` で共有せずに済みます。

```bash
claude mcp add --scope local slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  /absolute/path/to/slip-workspace --locale ja
```

パッケージを npm に公開した後は、このリポジトリをビルドせずに起動できます。

```bash
codex mcp add slipkit -- \
  npx -y @omdc-slipkit/mcp /absolute/path/to/slip-workspace --locale ja
```

作業ディレクトリはユーザーデータの保存場所であるため、各環境で一度パスを指定する必要があります。

### CLI オプションと環境変数

| 設定 | 説明 |
|---|---|
| 1 番目の位置引数 | 作業ディレクトリ。省略時は MCP サーバーのカレントディレクトリを使用します。 |
| `--locale <locale>` | エラーメッセージと PDF の既定フォントに使用する言語です。`ko`、`en`、`ja` を指定できます。 |
| `SLIPKIT_MCP_LOCALE` | `--locale` を省略したときに使用する言語です。 |
| `SLIPKIT_MCP_KEY` | `.slip` ファイルの暗号化と復号に使用する現在のキーです。環境変数でのみ受け取ります。 |
| `SLIPKIT_MCP_PREVIOUS_KEYS` | 現在のキーより前に使用したキーをカンマ区切りで指定します。復号時に現在のキーの次に試行します。 |

暗号化を使用する設定例は次のとおりです。

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "/absolute/path/to/slip-workspace",
        "--locale",
        "ja"
      ],
      "env": {
        "SLIPKIT_MCP_KEY": "current-passphrase",
        "SLIPKIT_MCP_PREVIOUS_KEYS": "previous-passphrase"
      }
    }
  }
}
```

`SLIPKIT_MCP_KEY` を設定すると、新しく保存するファイルは暗号化されます。平文の `.slip` ファイルはそのまま読み取れますが、暗号化済みファイルには一致する現在または過去のキーが必要です。

### PDF フォント

フォントファイルのパスや OS フォントを設定する必要はありません。MCP サーバーは `@omdc-slipkit/elements` に base64 で同梱されたフォントをメモリ上で読み込み、PDF レンダラーへ渡します。ネットワークからフォントをダウンロードすることはありません。

| ロケール | 既定フォント |
|---|---|
| `ja` で始まるロケール | Noto Sans JP Regular 日本語サブセット |
| その他のロケール | Pretendard Regular、Pretendard Bold |

`fontName` を省略すると、ロケールに対応する既定フォントを使用します。明示する場合は、現在のロケールに登録されている `Pretendard`、`Pretendard-Bold`、`Noto Sans JP` のいずれかを使用してください。同梱の日本語フォントには Bold がないため、`bold: true` を指定しても別の Bold フォントは適用されません。

現在の CLI にはユーザーフォントを追加するオプションがありません。ユーザーフォントを扱うには、フォント供給関数を受け取るサーバーオプションの拡張が必要です。開発リポジトリから実行する場合は `packages/mcp/dist` だけをコピーせず、pnpm でインストールした workspace 依存関係を維持してください。npm 公開後は `elements` 依存関係と同梱フォントも MCP パッケージと一緒にインストールされます。

## 提供ツール

| ツール | 用途 | 主な入力 |
|---|---|---|
| `slip_list` | 作業ディレクトリの `.slip` ファイルを 1 ページ最大 50 件表示します。 | `kind`, `query`, `cursor` |
| `slip_read` | 概要、1 ページ、1 要素、またはファイル全体を読み取ります。 | `path`, `part`, `elementId`, `pageIndex` |
| `slip_save` | 完成した JSON を検証し、新しい `.slip` ファイルとして保存します。 | `path`, `file`, `overwrite` |
| `slip_edit` | 既存ファイルに対象を指定した編集操作をアトミックに適用します。 | `path`, `ops` |
| `slip_build_voucher` | テンプレートとパラメータ値から未発行伝票を作成します。 | `templatePath`, `values`, `outPath`, `overwrite` |
| `slip_render_pdf` | テンプレートまたは伝票を PDF にレンダリングします。 | `path`, `outPath` |
| `slip_schema` | `.slip` 構造をトピックごとに説明します。 | `topic` |

`slip://schema` リソースは現在の `.slip` JSON Schema 全体を提供します。`slip_schema` の `topic` は `overview`、`elements`、`grid`、`parameters`、`formula`、`voucher`、`json-schema` です。

### `slip_read` の読み取り範囲

| `part` | 返却内容 |
|---|---|
| `summary` | ページ、要素の id・種類・位置、パラメータ、アセットの概要。既定値です。 |
| `element` | `elementId` で指定した 1 要素の全内容 |
| `page` | `pageIndex` で指定した 1 ページの全内容 |
| `full` | ファイル全体 |

読み取り応答の base64 画像データはサイズ表示に置き換えられます。`.slip` ファイル内の画像形式は base64 データ URL です。MCP 経由で画像を追加するときは、`set_image` 操作に作業ディレクトリ内のファイルパスを渡します。サーバーがファイルを読み取り、base64 アセットを作成します。

### `slip_edit` 操作

| `action` | 対象 |
|---|---|
| `set_meta` | テンプレートのメタデータ |
| `set_paper` | 用紙設定 |
| `set_page`, `add_page`, `remove_page` | ページ |
| `set_element`, `add_element`, `remove_element` | id で指定した要素 |
| `add_parameter`, `set_parameter`, `remove_parameter` | key で指定したパラメータ |
| `set_cell` | グリッド id と 0 始まりの行・列で指定したセル |
| `set_image` | id で指定した画像要素 |
| `set_values` | 未発行伝票の値 |

操作は指定順にコピーへ適用し、その後ファイル全体を検証します。1 つでも操作または検証に失敗すると、ファイルは書き込まれません。

`set_element` など `fields` を受け取る操作は、渡したフィールドだけをマージします。変更しないフィールドは省略してください。`null` は削除の印ではなく、実際の値として保存されます。

## 推奨ワークフロー

### 新しいテンプレートの作成

1. `slip_schema` で `overview` を読みます。
2. 必要に応じて `elements`、`grid`、`parameters`、`formula` を読みます。
3. 完成したテンプレート JSON を `slip_save` で保存します。
4. `slip_render_pdf` で PDF を作成し、配置とスタイルを確認します。

### 既存テンプレートの編集

1. `slip_read` の既定の概要でページと要素 id を確認します。
2. 必要な場合だけ `element` または `page` を読みます。
3. `slip_edit` で意図した対象だけを変更します。
4. `slip_render_pdf` で変更結果を確認します。

既存ファイルの小さな変更に `slip_save` や `full` の読み取りを使用しないでください。概要から対象を見つけ、`slip_edit` で指定して編集すると、無関係な要素の欠落や変更を防ぎやすくなります。

### 伝票と PDF の作成

1. `slip_build_voucher` にテンプレートパス、パラメータ値、出力パスを渡します。
2. 必要に応じて `set_values` 操作で値を調整します。
3. `slip_render_pdf` で実際の値を反映した PDF を作成します。

MCP サーバーが作成する伝票は未発行（`issued: false`）です。発行は、ユーザー確認と権限チェックを実施できるホストアプリケーションで行います。発行済み伝票はこの MCP サーバーで編集できません。

## ファイルアクセスと安全性の境界

- すべての入出力パスは、起動時に指定した作業ディレクトリ内に制限されます。
- 保存パスで `.slip` 拡張子を省略すると自動的に付与されます。
- `slip_edit` の操作グループは、完全な結果が有効な場合にのみ保存されます。
- `slip_save` と `slip_build_voucher` は、既存ファイルを既定で置き換えません。`overwrite: true` を指定しても、発行済み伝票は置き換えられません。
- PDF 出力パスに `.slip` 拡張子は使用できません。
- `set_image` は PNG、JPEG、GIF、WebP をファイルごとに最大 2 MB までサポートします。
- サーバーは任意コード実行、ネットワークアクセス、ユーザー認証、伝票発行を提供しません。

`slip_edit` には要素、ページ、パラメータの削除操作があります。これらのツール呼び出しに対するユーザー確認は、MCP クライアントの承認設定で構成してください。

## Node.js でのストレージ再利用

`FileSystemStorage` は、MCP サーバーと同じパス制限と暗号化ルールを使用する `StorageAdapter` 実装です。

```ts
import { FileSystemStorage } from '@omdc-slipkit/mcp';

const key = process.env.SLIPKIT_MCP_KEY;
if (!key) throw new Error('SLIPKIT_MCP_KEY が必要です。');

const previousKeys = process.env.SLIPKIT_MCP_PREVIOUS_KEYS
  ?.split(',')
  .map((key) => key.trim())
  .filter((key) => key !== '');

const storage = new FileSystemStorage({
  rootDir: '/absolute/path/to/slip-workspace',
  locale: 'ja',
  encryption: {
    key,
    ...(previousKeys?.length ? { previousKeys } : {}),
  },
});

const template = await storage.load('invoice');
await storage.save('archive/invoice', template);
```

MCP サーバー自体を組み込む場合は `createSlipMcpServer(options)` を使用できます。この関数は未接続の `McpServer` と `FileSystemStorage` を返し、トランスポートの接続は呼び出し側が行います。

## トラブルシューティング

| 現象 | 確認事項 |
|---|---|
| MCP ツールが表示されない | パッケージをビルドしたか、2 つの設定パスが有効な絶対パスか、クライアントを再起動したかを確認します。 |
| `working directory not found` | 作業ディレクトリを作成し、設定パスを修正します。 |
| 暗号化ファイルを読み取れない | 一致するキーが `SLIPKIT_MCP_KEY` または `SLIPKIT_MCP_PREVIOUS_KEYS` にあるか確認します。 |
| 編集後もファイルが変わらない | ツール応答の検証エラーを確認します。検証失敗時は元のファイルが保持されます。 |
| PDF 出力に失敗する | 出力先の親ディレクトリが存在し、書き込み可能か確認します。 |

## 関連ドキュメント

- [`.slip` ファイル形式仕様](../SPEC.md)
- [Core 利用ガイド](core.ja.md)
- [サーバー統合ガイド](server-integration.ja.md)
- [API リファレンス](api-reference.ja.md)
- [ADR-061: AI 連携をローカル MCP サーバーパッケージとして提供する](../DECISIONS.md#adr-061-ai-연동은-로컬-mcp-서버-패키지로-제공한다)
