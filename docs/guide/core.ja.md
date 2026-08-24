# Core API ガイド

[한국어](core.md) · [English](core.en.md)

`@omdc-slipkit/core` は DOM やブラウザに依存しない純粋な TypeScript ライブラリです。
Node.js でもそのまま利用できます。

別途 UI をインストールせずに、Slip ファイルを Core に渡してサーバー側で PDF を生成したり、伝票を検証したりできます。

## 目次

1. [インストール](#1-インストール)
2. [ファイルのパース・シリアライズ](#2-ファイルのパースシリアライズ)
3. [伝票の組み立て — テンプレートに値を入れる](#3-伝票の組み立て--テンプレートに値を入れる)
4. [数式](#4-数式)
5. [PDF レンダリング](#5-pdf-レンダリング)
6. [整合性 (ハッシュ・署名)](#6-整合性-ハッシュ署名)
7. [サーバー連携パターン](#7-サーバー連携パターン)

### 詳細リファレンス

- **[数式関数リファレンス](formula.md)** — 組み込み関数 32 種の使い方・引数・例
- **[主要な型リファレンス](types.md)** — `SlipFile`、フォント、`StorageAdapter`、`IntegrityJwk` など型ごとのフィールドと既定値

---

## 1. インストール

UI パッケージ(`elements` / `react` / `vue`)を使うプロジェクトでは core が依存関係として一緒に入ります。(別途インストール不要)
UI と伝票サーバーを分離する場合、つまりサーバー側で core のみを単独で使う場合にインストールします。

```bash
npm install @omdc-slipkit/core
```

## 2. ファイルのパース・シリアライズ

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
} from '@omdc-slipkit/core';

// JSON 文字列 → SlipFile オブジェクト (旧バージョンなら自動マイグレーション)
const file = parseSlipFile(jsonString);

// SlipFile オブジェクト → JSON 文字列
const json = serializeSlipFile(file);

// すでにパース済みの JSON 値を検証 (JSON.parse の結果など)
const validated = validateSlipFile(jsonValue);
```

- `parseSlipFile` は JSON 文字列を受け取り、`SlipFile` オブジェクトに変換します。旧バージョンのファイルの場合は現在のスキーマバージョンへ自動的にマイグレーションされます。
- `serializeSlipFile` は `SlipFile` オブジェクトを JSON 文字列に変換します。
- `validateSlipFile` はパース済みの JSON 値(`JSON.parse` の結果など)を検証し、`SlipFile` として返します。ファイルが不正な場合は `SlipParseError` を投げます。

## 3. 伝票の組み立て — テンプレートに値を入れる

UI なしで core だけで伝票を作るときは、**テンプレートに値（values）を入れて**伝票（voucher）オブジェクトを
自分で組み立てます。テンプレートは `.slip` ファイルで連携しますが、パラメータに入れるデータはこの
`values` オブジェクトで渡します。

### values オブジェクトの形

キーはテンプレートの**パラメータ物理名（`key`）**、値はパラメータタイプによって異なります。

| パラメータタイプ | 値 |
|---|---|
| 文字・数値・日付・真偽 | その値そのまま（`'2026-08-24'` · `12000` · `true`） |
| 画像 | `data:` base64 文字列（外部 URL 不可 — core はネットワークを使いません） |
| リスト（list） | **オブジェクトの配列** — 項目ごとに項目フィールドの `key` で値を入れます |

```ts
const values = {
  tradeDate: '2026-08-24',          // date パラメータ
  items: [                          // list パラメータ — 項目フィールドの key で入れる
    { itemName: '鉛筆', spec: 'HB', quantity: 12, unitPrice: 300, amount: 3600 },
    { itemName: 'ノート', spec: 'A5', quantity: 5, unitPrice: 1200, amount: 6000 },
  ],
  // totalAmount は数式 SUM(items.amount) で計算されるので入れなくてよい
};
```

### テンプレート + 値 → 伝票

`buildVoucher(テンプレート, 値)` が、テンプレートスナップショットの埋め込み・number パラメータの空値を
0 に揃える正規化（ADR-044）・伝票の組み立てをまとめて行います。返ってきた伝票を `renderSlipToPdf` に
渡すと、値が入った PDF が得られます。

```ts
import { parseSlipFile, buildVoucher, renderSlipToPdf } from '@omdc-slipkit/core';

const template = parseSlipFile(templateJson);
if (template.kind !== 'template') throw new Error('テンプレートファイルではありません');

const voucher = buildVoucher(template, values);   // 発行前（issued: false）の伝票
const pdf = await renderSlipToPdf(voucher, { fonts });
```

- 数式で計算されるフィールド（例: 合計金額）は `values` に入れなくてもレンダリング時に自動計算されます。
- 伝票は作成時点のテンプレートを `templateSnapshot` として丸ごと保持するので、後でテンプレートが変わっても
  同じようにレンダリングされます (ADR-008)。`buildVoucher` が返す伝票は、入力のテンプレート・値と参照を
  共有しません。
- リストの項目数が 1 ページに収まる数を超えると、ページが自動で増えます。

### 発行（確定）

値を確定して改ざん検知の記録を残すのが**発行**です。**先に `issued: true` にしてから**、その伝票で整合性を
計算して付けます — 順序が重要です。ハッシュは `issued` まで含むため、発行状態にしてからハッシュしないと
後の検証が合いません（[§6 整合性](#6-整合性-ハッシュ署名)）。

```ts
import { computeIntegrity } from '@omdc-slipkit/core';

const issued = { ...voucher, issued: true };           // 1) 先に発行状態へ
issued.integrity = await computeIntegrity(issued);     // 2) その伝票をハッシュ（署名するには第2引数に秘密鍵）
```

`computeIntegrity` は伝票を受け取り `{ contentHash, signature? }` だけを返します — 伝票を作らないので
`buildVoucher` の**後**に来ます。

> `buildVoucher` を使わず自分で組み立てることもできます — 伝票は `{ schemaVersion, kind: 'voucher',
> templateSnapshot, values, issued }` オブジェクトで、`buildVoucher` はそこにディープコピーと number
> 正規化を加えるだけです。手組みしたオブジェクトは `validateSlipFile(voucher)` で検証できます。

## 4. 数式

```ts
import { parseFormula, evaluateFormula } from '@omdc-slipkit/core';

const ast = parseFormula('SUM(items.amount)');
const result = evaluateFormula(ast, {
  values: { items: { amount: [1000, 2000, 3000] } },
});
// result → 6000
```

32 種の組み込み関数をサポートしています (SUM、IF、ROUND、CONCAT など)。関数ごとの使い方は **[数式関数リファレンス](formula.md)** を参照してください。
登録されていない関数はパース段階で拒否されます。

## 5. PDF レンダリング

```ts
import { renderSlipToPdf } from '@omdc-slipkit/core';

const pdfBytes = await renderSlipToPdf(file, {
  fonts: [{ name: 'Pretendard', data: fontBuffer }],
});
// pdfBytes: Uint8Array — PDF ファイルのバイト列
```

- `fonts` に正しいフォントを登録する必要があります。フォントが不正な場合、PDF 出力時に文字化けすることがあります。
- `locale` オプションで数式フォーマット関数の数値表記を変更できます。(既定は `'ko-KR'`)。
- フォント型の詳細は [型リファレンス](types.md#font) を参照してください。

## 6. 整合性 (ハッシュ・署名)

```ts
import {
  computeIntegrity,
  verifyIntegrity,
  generateSigningKeyPair,
} from '@omdc-slipkit/core';

// ハッシュのみを記録
const hashed = await computeIntegrity(file);

// 署名まで記録
const keyPair = await generateSigningKeyPair();
const signed = await computeIntegrity(file, { privateKey: keyPair.privateKey });

// 検証
const result = await verifyIntegrity(signed);
// result.hashValid, result.signatureValid
```

`.slip` ファイルの整合性を確認します。
SHA-256 ハッシュ + JWS(ES256) 署名。RFC 8785(JCS) による正規化を経て、Web Crypto API で実装されています。

## 7. サーバー連携パターン

SlipKit はサーバーを持たない組み込み型ライブラリで、外部バックエンドとは `.slip` ファイルを通じて連携します。
詳しいアーキテクチャは [ARCHITECTURE.md](../ARCHITECTURE.md) を参照してください。

### 基本フロー 1 : バックエンドから JSON でリクエストし -> 伝票結果を JSON バイナリとして取得する形式。

1. バックエンドから `.slip` と伝票に入れるデータ(values)を JSON で送信します。
2. このパッケージの core を通じて伝票を組み立て、数式を計算して発行します。
3. 発行された伝票 `.pdf` をバイナリに変換したうえで、バックエンドに返します。

### 基本フロー 2 : 夜間バッチなどでサーバー側で PDF を生成する必要がある場合

リクエストなしに特定の時間帯に発行が必要な場合(夜間バッチなど)は、core を Node で実行すればよいです。

```ts
import { parseSlipFile, renderSlipToPdf, computeIntegrity } from '@omdc-slipkit/core';

const file = parseSlipFile(jsonFromDb);
const issued = await computeIntegrity(file);
const pdf = await renderSlipToPdf(issued, { fonts });
```

core は Node 20 以上でのみ動作します。
