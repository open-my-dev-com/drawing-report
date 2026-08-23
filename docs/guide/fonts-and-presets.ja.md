# 同梱フォント・プリセット

[한국어](fonts-and-presets.md) · [English](fonts-and-presets.en.md)

SlipKit が同梱するフォントとプリセットの詳細、ホストがフォントを供給する方法、そして言語設定に応じた
動作を説明します。

---

## フォント供給: `settings.getFonts` (ADR-040)

レンダーフォントはホストが**供給インターフェース**で渡します。コンポーネント（`<slip-designer>`、`<slip-form>`、
`<slip-viewer>`）の `settings` 属性に `getFonts` を実装したオブジェクトを渡すと、プレビュー・PDF がそのフォントで
レンダーされます。フォントをどこに置くか（バンドル・サーバーフォルダなど）はホストが決めるため、ライブラリは値を受け取る
pull 方式でのみ受け取ります。

```ts
import type { SlipFontProvider } from '@omdc-slipkit/elements';

const settings: SlipFontProvider = {
  // 同期配列も、サーバーから取得する Promise も使えます。
  getFonts: () => [
    { name: 'MyFont', data: myFontBuffer },
    { name: 'MyFont-Bold', data: myFontBoldBuffer },
  ],
};

designer.settings = settings;
```

| 項目 | 型 | 説明 |
|---|---|---|
| `getFonts?` | `() => SlipFont[] \| Promise<SlipFont[]>` | レンダーに使うフォント一覧。空、または渡さない場合は同梱のデフォルトフォントを使います |

`SlipFont` は core `RenderOptions.fonts` の要素と同じです（`{ name, data, fallback? }`）。

> デザイナーは `settings` に用紙一覧の供給・保存（`getPaperSizes`/`savePaperSize`）が加わった
> `SlipDesignerSettings` を受け取ります — 詳しくは[利用ガイド](README.md)の用紙設定を参照してください。

---

## 同梱デフォルトフォント

`settings.getFonts` でフォントを**渡さない場合**、コンポーネントは `locale` に合わせた同梱デフォルトフォントを自動的に
読み込みます。各言語ですぐにレンダーできるよう、言語ごとにデフォルトフォント 1 種を収めています。

| 言語（`locale`） | デフォルトフォント | ウェイト | 形式 | サイズ（おおよそ） |
|---|---|---|---|---|
| `ko`（デフォルト） · `en` | Pretendard | Regular · Bold | OTF | 約 3 MB |
| `ja` | Noto Sans JP | Regular | TTF（サブセット） | 約 4.8 MB |

- Regular に `fallback: true` が設定されており、他のフォントにない文字をこのフォントが描画します。
- 読み込みは必要な時点で一度だけ行われ（非同期）、言語ごとに再利用されます。
- フォントデータは**サブパス**で隔離され動的 import されるため、その言語を使わないホストのバンドルには
  含まれません。
- ライセンス: Pretendard は SIL Open Font License 1.1（`OFL-Pretendard.txt`）、Noto Sans JP も
  SIL Open Font License 1.1（`OFL-NotoSansJP.txt`）。

### 日本語フォントの範囲 (ADR-042)

同梱の Noto Sans JP は **Regular 一ウェイト**であり、日本語の常用文字（かな・常用漢字・ラテン・全角/半角）に
絞ったサブセットです。**太字(Bold)やサブセット外の文字**が必要な場合は `settings.getFonts` でフォントを
供給してください — 同梱は「デフォルト一つ」、拡張は供給インターフェースで分担します。

### 直接使用

同梱フォントを明示的に取り込み、ユーザーフォントと一緒に使うこともできます。

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';
import notoSansJpFonts from '@omdc-slipkit/elements/fonts/noto-sans-jp';

designer.settings = {
  getFonts: () => [
    ...pretendardFonts,
    ...notoSansJpFonts,
    { name: 'MyFont', data: myFontBuffer },
  ],
};
```

`getFonts` が一覧を返すと同梱の自動読み込みは行われないため、必要な同梱フォントは配列に
直接含める必要があります。

---

## 同梱プリセット

デザイナーにプリセット 2 種が同梱されています。

| プリセット | 構成 |
|---|---|
| **取引明細書** | 供給者・供給を受ける者の情報（登録番号・商号・住所など）、品目表（品名・規格・数量・単価・金額）、合計数式 |
| **請求書** | 請求情報、金額内訳表、合計・付加価値税の数式 |

### プリセットと言語

プリセットメニューの**名前**（取引明細書、請求書）は `locale` に応じて翻訳されます —
英語に切り替えると "Transaction statement"、"Invoice" と表示されます。

しかしプリセットの**内容**（セルテキスト、バインディングの論理名、列見出しなど）は韓国語で固定です。
たとえば取引明細書プリセットを選ぶと、`locale="en"` や `locale="ja"` であってもセルに "등록번호"、
"상호" と書かれています。

英語・日本語のテンプレートが必要な場合は `presets` 属性に自作のプリセットを渡してください。

### プリセットを自作する

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

const myPresets: SlipPreset[] = [
  {
    id: 'my-invoice',
    name: 'Invoice',
    create: (): SlipTemplateFile => ({
      schemaVersion: '0.1.0',
      kind: 'template',
      template: {
        meta: { title: 'Invoice' },
        paper: { width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
        pages: [{ elements: [] }],
        assets: [],
      },
    }),
  },
];
```

```html
<slip-designer .presets=${myPresets}></slip-designer>
```

`presets` を指定すると、同梱プリセットの代わりに渡した一覧がメニューに表示されます。
