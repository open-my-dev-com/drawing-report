# アプリケーション統合ガイド

[한국어](integration.ko.md) · [English](integration.md)

このドキュメントは、SlipKit のデザイナー・作成フォーム・ビューアを接続し、各コンポーネントから受け取ったテンプレートと伝票をアプリケーションで管理する方法を説明します。

まだテンプレートデザイナーを実行していない場合は、[スタートガイド](getting-started.ja.md) を進めてください。

このドキュメントを終えると、次のことができるようになります。

- テンプレートと伝票の状態を区別する
- デザイナー・作成フォーム・ビューアを接続する
- 編集結果をブラウザまたはサーバーに保存する
- 作成中の伝票を続けて作成する
- 発行された伝票を読み取り専用で表示する

> [!IMPORTANT]
> SlipKit コンポーネントは画面と編集機能を提供します。
> ユーザー認証、権限管理、画面遷移、自動保存、サーバー連携はホストアプリケーションが担当します。

## 全体のデータフロー

一般的なアプリケーションでは、テンプレートと伝票が次の順序で移動します。

```mermaid
flowchart TD
    A["テンプレート"] --> B["SlipDesigner"]
    B -->|"slip-change"| C["ホスト状態・ストレージ"]
    C -->|"テンプレートまたは作成中の伝票"| D["SlipForm"]
    D -->|"slip-change"| E["作成中の伝票"]
    D -->|"slip-issue"| F["発行された伝票"]
    E --> C
    F --> C
    C -->|"保存されたテンプレート・伝票"| G["SlipViewer"]
```

コンポーネント同士でデータを直接渡しません。ホストアプリケーションが、あるコンポーネントから受け取ったファイルを保存し、次のコンポーネントの `src` に渡します。

## 管理すべきファイル

SlipKit アプリケーションは、主に次の 3 つの状態を管理します。

| 状態 | ファイルの種類 | 説明 |
|---|---|---|
| テンプレート | `kind: 'template'` | 文書の構成、パラメータ、数式などを定義します。 |
| 作成中の伝票 | `kind: 'voucher'`、`issued: false` | ユーザーが値を入力している伝票です。 |
| 発行された伝票 | `kind: 'voucher'`、`issued: true` | 値が確定し、作成フォームで編集できない伝票です。 |

伝票には、作成時点のテンプレートが `templateSnapshot` として保存されます。その後、元のテンプレートが変更されても、既存の伝票は自身のテンプレートスナップショットを使用します。

> [!WARNING]
> `issued: true` は作成フォームで入力を止める状態です。伝票が暗号学的に改ざんされていないことを証明する電子署名や完全性保証ではありません。
> 保存された伝票のアクセス権限と変更防止は、ホストアプリケーションとサーバーで処理する必要があります。

## コンポーネントの入力と出力

| コンポーネント | `src` で受け取るファイル | 出力する結果 |
|---|---|---|
| `<slip-designer>` | テンプレート | `slip-change` で編集されたテンプレート |
| `<slip-form>` | テンプレートまたは伝票 | `slip-change` で作成中の伝票、`slip-issue` で発行された伝票 |
| `<slip-viewer>` | テンプレートまたは伝票 | なし |

`src` には `SlipFile` オブジェクトではなく、`serializeSlipFile` で変換した JSON 文字列を渡します。

```ts
import { serializeSlipFile } from '@omdc-slipkit/core';

designer.src = serializeSlipFile(template);
form.src = serializeSlipFile(template);
viewer.src = serializeSlipFile(voucher);
```

## イベントの接続

### 環境ごとのイベント名

| 動作 | Web Component | React | Vue |
|---|---|---|---|
| テンプレート変更 | `slip-change` | `onSlipChange` | `@slip-change` |
| 伝票の入力変更 | `slip-change` | `onSlipChange` | `@slip-change` |
| 伝票の発行 | `slip-issue` | `onSlipIssue` | `@slip-issue` |

Web Component では、`CustomEvent` の `detail.file` に結果が入っています。

```ts
designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;
});
```

React と Vue のラッパーは `CustomEvent` を外し、`SlipFile` オブジェクトを直接渡します。

<details>
<summary><strong>React</strong></summary>

```tsx
<SlipDesigner
  src={designerSrc}
  onSlipChange={(file) => {
    if (file.kind === 'template') {
      setTemplate(file);
    }
  }}
/>

<SlipForm
  src={formSrc}
  onSlipChange={(file) => {
    if (file.kind === 'voucher') {
      setDraftVoucher(file);
    }
  }}
  onSlipIssue={(file) => {
    if (file.kind === 'voucher') {
      setIssuedVoucher(file);
    }
  }}
/>
```

</details>

<details>
<summary><strong>Vue</strong></summary>

```vue
<SlipDesigner
  :src="designerSrc"
  @slip-change="onTemplateChange"
/>

<SlipForm
  :src="formSrc"
  @slip-change="onVoucherChange"
  @slip-issue="onVoucherIssue"
/>
```

Vue のイベント処理関数には、`SlipFile` オブジェクトが直接渡されます。

</details>

> [!IMPORTANT]
> `designerSrc` と `formSrc` は、各コンポーネントで編集を始めるときに渡す入力です。
> `slip-change` で受け取った結果を、現在編集中のコンポーネントの `src` にそのまま渡し直さないでください。
>
> イベントで受け取った最新のテンプレートと伝票は、別のアプリケーション状態または保存対象として管理します。別のファイルを開くときや、新しい編集セッションを始めるときだけ、そのコンポーネントの `src` を更新してください。

デザイナーの入力と編集結果を分ける基本的な例は、[スタートガイド](getting-started.ja.md#3-デザイナーの接続) を確認してください。

## 3 つのコンポーネントを接続する

次の例は、Web Component を使ってテンプレート設計、伝票作成、発行伝票の閲覧を接続します。

HTML に各コンポーネントを用意します。

```html
<section id="designer-screen">
  <slip-designer id="designer"></slip-designer>
  <button id="start-voucher">伝票作成</button>
</section>

<section id="form-screen" hidden>
  <slip-form id="form"></slip-form>
</section>

<section id="viewer-screen" hidden>
  <slip-viewer id="viewer"></slip-viewer>
</section>
```

アプリケーションでテンプレートと伝票の状態を管理します。

```ts
import '@omdc-slipkit/elements';

import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import type {
  SlipDesigner,
  SlipForm,
  SlipViewer,
} from '@omdc-slipkit/elements';

import { createBlankTemplate } from './slip-template';

const designer =
  document.querySelector<SlipDesigner>('#designer');
const form =
  document.querySelector<SlipForm>('#form');
const viewer =
  document.querySelector<SlipViewer>('#viewer');

const designerScreen =
  document.querySelector<HTMLElement>('#designer-screen');
const formScreen =
  document.querySelector<HTMLElement>('#form-screen');
const viewerScreen =
  document.querySelector<HTMLElement>('#viewer-screen');
const startButton =
  document.querySelector<HTMLButtonElement>('#start-voucher');

if (
  !designer ||
  !form ||
  !viewer ||
  !designerScreen ||
  !formScreen ||
  !viewerScreen ||
  !startButton
) {
  throw new Error('SlipKit の画面要素が見つかりません。');
}

let template: SlipTemplateFile = createBlankTemplate();
let draftVoucher: SlipVoucherFile | null = null;
let issuedVoucher: SlipVoucherFile | null = null;

designer.src = serializeSlipFile(template);

designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
});

form.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  draftVoucher = file;
});

form.addEventListener('slip-issue', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  issuedVoucher = file;
  draftVoucher = null;

  viewer.src = serializeSlipFile(file);

  formScreen.hidden = true;
  viewerScreen.hidden = false;
});

startButton.addEventListener('click', () => {
  const source =
    draftVoucher && canResumeVoucher(draftVoucher)
      ? draftVoucher
      : template;

  form.src = serializeSlipFile(source);

  designerScreen.hidden = true;
  viewerScreen.hidden = true;
  formScreen.hidden = false;
});

function canResumeVoucher(
  voucher: SlipVoucherFile,
): boolean {
  return !voucher.issued;
}
```

この例では、作成中の伝票があれば伝票に保存された `templateSnapshot` を使って続けて作成し、発行された伝票なら現在のテンプレートで新しい伝票を始めます。

### 作成フォームの `src` を更新するタイミング

作成フォームの `src` は次のタイミングで設定します。

- 新しい伝票の作成を開始するとき
- 保存された作成中の伝票を再度開くとき
- ユーザーが別の伝票に切り替えるとき

> [!CAUTION]
> `slip-change` が発生するたびに、受け取った伝票を再度シリアライズして同じ作成フォームの `src` に入れないでください。
> `src` が変更されると、作成フォームはファイルを再パースし、内部の入力状態を再構成します。
> 入力中は、イベントで受け取った伝票をホスト状態にのみ保持し、作成フォームの `src` はそのまま維持するのが安全です。

React と Vue でも、作成フォームの入力用 `formSrc` とイベントで受け取った `draftVoucher` を別々の状態として管理することを推奨します。

発行後に同じテンプレートで新しい伝票を始めるには、Web Component の `reset()` メソッドを呼び出します。React と Vue のラッパーはこのメソッドを公開しないため、コンポーネントの `key` を変更して再マウントします。同じ `src` 文字列を再指定するだけでは、発行済みフォームのロックは解除されません。

`.slip` バリデーターは `values`、`sampleValues`、リスト行、未定義の業務データキーを読み込み・編集・保存の過程で保持します。構造オブジェクトの未定義プロパティは拒否します。作成フォームは不正な業務値を暗黙に修復せず保持し、ユーザーが明示的に消去または修正するまで発行を止めます。業務ルールの検証はホストアプリケーションの責任です。

## 作成中の伝票を続けて書く

作成中の伝票は、作成時点のテンプレートを `templateSnapshot` として持っています。

元のテンプレートがあとで変更されても、作成中の伝票を再度開くと、伝票に保存されたテンプレートスナップショットが使われます。したがって技術的には、現在のテンプレートに関係なく `issued: false` の伝票を続けて作成できます。

ただしホストアプリケーションは、サービスポリシーに応じて次のいずれかを選択する必要があります。

1. 作成中の伝票が持つ既存のテンプレートで作成を続けます。
2. 現在のテンプレートと同じバージョンから作成された伝票だけを続けて作成します。
3. テンプレートが変更された場合は、既存の伝票を続けて作成するか、新しい伝票を作るかをユーザーに選ばせます。

前述の `canResumeVoucher` の例は、1 つ目のポリシーを使います。

```ts
function canResumeVoucher(
  voucher: SlipVoucherFile,
): boolean {
  return !voucher.issued;
}
```

### 現在のテンプレートバージョンと一致するときだけ続けて書く

現在のテンプレートと同じバージョンから作成された伝票だけを続けて書くには、ホストアプリケーションでテンプレート ID とバージョンを別途管理する方法を推奨します。

`.slip` ファイル自体には、ホストアプリケーションのテンプレート ID や改訂番号が必須フィールドとして定義されていません。したがって、次のような保存レコードをアプリケーションやサーバーで管理します。

```ts
interface TemplateRecord {
  id: string;
  revision: number;
  file: SlipTemplateFile;
}

interface VoucherRecord {
  id: string;
  templateId: string;
  templateRevision: number;
  file: SlipVoucherFile;
}
```

伝票を最初に作るときに使ったテンプレートの ID とバージョンを、伝票の保存レコードに一緒に記録します。

```ts
function canResumeWithCurrentTemplate(
  voucher: VoucherRecord,
  currentTemplate: TemplateRecord,
): boolean {
  return (
    !voucher.file.issued &&
    voucher.templateId === currentTemplate.id &&
    voucher.templateRevision === currentTemplate.revision
  );
}
```

このメタデータは、`.slip` ファイルの `templateSnapshot` を代わりにするものではありません。

- `templateSnapshot` は、伝票を当時の見た目でレンダリングするために使います。
- `templateId` と `templateRevision` は、ホストアプリケーションでテンプレートの関係とバージョンを判断するために使います。

> [!CAUTION]
> `JSON.stringify(voucher.templateSnapshot) === JSON.stringify(currentTemplate.template)` を、運用環境のテンプレートバージョンの判別基準として使わないでください。
>
> オブジェクトのプロパティ順序が異なると、内容が同じでも別の文字列になることがあり、サンプルデータのように伝票作成の構造と直接関係のない変更でも、別のテンプレートと判断してしまうことがあります。テンプレートが大きくなるほど、比較コストも増えます。

テンプレート ID とバージョンを管理できない場合は、正規化したテンプレートデータからハッシュを生成して保存できます。この場合も、単純な `JSON.stringify` の結果ではなく、プロパティ順序を固定した正規形式を使う必要があります。

> [!IMPORTANT]
> 既存の伝票の `templateSnapshot` を現在のテンプレートに自動で置き換えないでください。
> テンプレートが異なると、既存の入力値のパラメータと新しいテンプレートのパラメータが合わない場合があります。
>
> 現在のテンプレートで作成する必要があるなら、既存の伝票を変形するのではなく、新しい伝票を作るか、別途定義したデータマイグレーションの手順を使ってください。

## 変更内容を保存する

### アプリケーション状態と保存形式

アプリケーション内部では `SlipFile` オブジェクトとして管理し、サーバーやファイルに保存する境界で JSON 文字列に変換する方式を推奨します。

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';

const json = serializeSlipFile(file);
const restored = parseSlipFile(json);
```

`parseSlipFile` は JSON パースと `.slip` スキーマ検証を同時に行います。

### サーバーに保存する

次の例は、`.slip` ファイル全体をサーバーに保存し、再度読み込みます。

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';

export async function saveSlip(
  id: string,
  file: SlipFile,
): Promise<void> {
  const response = await fetch(
    `/api/slips/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: serializeSlipFile(file),
    },
  );

  if (!response.ok) {
    throw new Error(
      `保存に失敗しました: ${response.status}`,
    );
  }
}

export async function loadSlip(
  id: string,
): Promise<SlipFile> {
  const response = await fetch(
    `/api/slips/${encodeURIComponent(id)}`,
  );

  if (!response.ok) {
    throw new Error(
      `読み込みに失敗しました: ${response.status}`,
    );
  }

  return parseSlipFile(await response.text());
}
```

> [!IMPORTANT]
> 伝票を保存するときは `values` だけを別に保存せず、`SlipVoucherFile` 全体を保存してください。
> 伝票のテンプレートスナップショットと発行状態も一緒に保持されて初めて、あとで同じ見た目で閲覧できます。

### 自動保存リクエストを減らす

`slip-change` は編集や入力が発生するたびに渡されることがあります。毎回サーバーリクエストを送らず、入力が少し止まったあとに保存するよう遅延できます。

```ts
import type { SlipFile } from '@omdc-slipkit/core';

function createSaveScheduler(
  id: string,
  delay = 800,
): (file: SlipFile) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (file) => {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;

      void saveSlip(id, file).catch((error) => {
        console.error('自動保存に失敗しました。', error);
      });
    }, delay);
  };
}

const saveTemplateLater =
  createSaveScheduler('current-template');
const saveDraftLater =
  createSaveScheduler('current-draft');
```

その後、イベントで予約保存を呼び出します。

```ts
designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
  saveTemplateLater(file);
});

form.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  draftVoucher = file;
  saveDraftLater(file);
});
```

発行イベントは遅延せず、すぐに保存するのがよいです。

```ts
form.addEventListener('slip-issue', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  void saveSlip(`voucher-${crypto.randomUUID()}`, file)
    .catch((error) => {
      console.error('発行伝票の保存に失敗しました。', error);
    });
});
```

## デザイナーのストレージアダプタ

`<slip-designer>` の `storage` プロパティに `StorageAdapter` を渡すと、デザイナーに次の機能が現れます。

- マイテンプレートに保存
- 保存したテンプレートの一覧
- 保存したテンプレートの読み込み
- 保存したテンプレートの削除

ブラウザの IndexedDB を使うには、次のように接続します。

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import { IndexedDbStorage } from '@omdc-slipkit/elements';

const slipkit = createSlipKit({
  locale: 'ja-JP',
  encryption: {
    key: import.meta.env.VITE_SLIPKIT_KEY,
  },
});

const templateStorage = new IndexedDbStorage(slipkit, {
  dbName: 'my-app-templates',
  encryptOnSave: true,
});

designer.slipkit = slipkit;
designer.storage = templateStorage;
```

この例のように `getFonts` を省略すると、デザイナーのプレビューは `SlipKit.locale` に合った同梱フォントを使います。

> [!IMPORTANT]
> `storage` プロパティは、デザイナーの「マイテンプレート」機能に使うストレージです。
> 編集するたびに自動で保存したり、作成中の伝票を保存したりする機能ではありません。
> 自動保存は別途 `slip-change` イベントを受け取って実装する必要があります。

`storage` はオブジェクトなので、HTML 属性の文字列として渡せません。

```html
<!-- 誤った使い方 -->
<slip-designer storage="templateStorage"></slip-designer>
```

JavaScript プロパティ、またはフレームワークのオブジェクト prop として渡します。

```ts
designer.storage = templateStorage;
```

### サーバーストレージアダプタ

サーバー API をデザイナーの「マイテンプレート」機能と接続するには、`StorageAdapter` を実装します。

<details>
<summary><strong>サーバー StorageAdapter の例</strong></summary>

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';

async function requireSuccess(
  response: Response,
): Promise<Response> {
  if (!response.ok) {
    throw new Error(
      `ストレージリクエストに失敗しました: ${response.status}`,
    );
  }

  return response;
}

export const serverStorage: StorageAdapter = {
  async save(id, file): Promise<void> {
    await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: serializeSlipFile(file),
        },
      ),
    );
  },

  async load(id): Promise<SlipFile> {
    const response = await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
      ),
    );

    return parseSlipFile(await response.text());
  },

  async delete(id): Promise<void> {
    await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        },
      ),
    );
  },

  async list(filter, cursor): Promise<SlipListPage> {
    const params = new URLSearchParams();

    if (filter?.kind) {
      params.set('kind', filter.kind);
    }

    if (filter?.query) {
      params.set('query', filter.query);
    }

    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await requireSuccess(
      await fetch(`/api/slips?${params.toString()}`),
    );

    return await response.json() as SlipListPage;
  },
};
```

一覧 API は次の形を返す必要があります。

```json
{
  "items": [
    {
      "id": "template-001",
      "kind": "template",
      "title": "取引明細書",
      "updatedAt": "2026-08-25T09:00:00.000Z"
    }
  ],
  "nextCursor": "次のページがある場合に使う値"
}
```

サーバーは、保存リクエストで受け取った JSON を信頼せず、`parseSlipFile` または `validateSlipFile` で検証する必要があります。

</details>

## ローカルファイルを開く・ダウンロードする

`SlipFileExchange` は、ブラウザのファイル選択ダイアログとダウンロード機能を提供します。コンポーネントや IndexedDB ストレージと同じ `SlipKit` インスタンスを使います。

```ts
import { SlipFileExchange } from '@omdc-slipkit/elements';

const fileExchange = new SlipFileExchange(slipkit, {
  encryptOnSave: true,
});

await fileExchange.download('取引明細書.slip', template);

const opened = await fileExchange.open();

if (opened.kind === 'template') {
  template = opened;
  designer.src = serializeSlipFile(opened);
}
```

`SlipFileExchange` は `StorageAdapter` ではないため、デザイナーの `storage` プロパティには渡せません。アプリケーションの <kbd>ファイルを開く</kbd> と <kbd>ダウンロード</kbd> の処理で直接使います。

外部から受け取った `.slip` ファイルは、使う前にパースと検証が必要です。`SlipFileExchange.open` はこの検証を行い、暗号化されたエンベロープは `SlipKit` に設定したキーで復号します。

## 発行された伝票を閲覧する

発行された伝票は `<slip-viewer>` に渡して読み取り専用で表示できます。

```ts
viewer.src = serializeSlipFile(issuedVoucher);
```

React:

```tsx
<SlipViewer src={serializeSlipFile(issuedVoucher)} />
```

Vue:

```vue
<SlipViewer :src="serializeSlipFile(issuedVoucher)" />
```

`<slip-viewer>` はテンプレートと伝票の両方を表示でき、ファイルを変更するイベントは発生させません。

## エラー処理

アプリケーションでは、次の失敗を区別して処理するのがよいです。

| 失敗 | 処理例 |
|---|---|
| 不正な `.slip` ファイル | ファイルが有効でない旨の案内を表示 |
| サーバー保存の失敗 | 編集内容が保存されなかったことを表示して再試行 |
| 保存されたファイルがない | 新しいテンプレートまたは新しい伝票で開始 |
| ファイル選択のキャンセル | エラー通知なしで既存の画面を維持 |
| 発行の失敗 | 入力画面を維持して発行エラーを表示 |
| PDF レンダリングの失敗 | 元の `.slip` ファイルを維持して再試行 |

> [!CAUTION]
> 自動保存が失敗したのに成功したように表示しないでください。
> 画面の状態とサーバーの状態が異なる場合があるため、最後に保存が成功した時刻や保存失敗の状態をユーザーに見せるのがよいです。

## 避けるべき実装

- `slip-change` が発生するたびに同じ作成フォームの `src` を更新する
- `storage` プロパティを自動保存機能と誤解する
- 作成中の伝票の `values` だけを保存する
- `JSON.stringify` の結果だけで、テンプレート ID やバージョンが同じと判断する
- `issued: true` を電子署名や改ざん防止として解釈する
- サーバーから受け取った `.slip` JSON を検証せずに使う
- 保存の失敗を無視して成功状態を表示する
- 既存の伝票の `templateSnapshot` を現在のテンプレートに自動で置き換える

## 統合チェックリスト

- [ ] デザイナーの `slip-change` からテンプレートを受け取ります。
- [ ] 作成フォームの `slip-change` から作成中の伝票を受け取ります。
- [ ] 作成フォームの `slip-issue` から発行された伝票を受け取ります。
- [ ] テンプレートと伝票を別々の状態または保存キーで管理します。
- [ ] 自動保存リクエストを適切に遅延します。
- [ ] 発行イベントはすぐに保存します。
- [ ] 作成中の伝票をどのテンプレートで続けて書くか、ポリシーを決めました。
- [ ] テンプレートバージョンの一致が必要なら、ホストでテンプレート ID と改訂番号を管理します。
- [ ] 既存の伝票の `templateSnapshot` を現在のテンプレートに自動で置き換えません。
- [ ] 外部とやり取りする `.slip` ファイルを検証します。
- [ ] 保存失敗とレンダリング失敗をユーザーに表示します。
- [ ] 発行された伝票をビューアで読み取り専用で表示します。

## 関連ドキュメント

- [スタートガイド](getting-started.ja.md)
- [テンプレートデザイナー利用ガイド](designer.ja.md)
- [Core API ガイド](core.ja.md)
- [数式関数リファレンス](formula.ja.md)
