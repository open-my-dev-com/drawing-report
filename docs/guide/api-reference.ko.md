# API 참조

[English](api-reference.md) · [日本語](api-reference.ja.md)

이 문서는 SlipKit 패키지가 공개하는 함수, 타입, 컴포넌트 속성, 이벤트와 오류를 빠르게 확인하기 위한 참조 문서입니다.

작업 순서와 전체 예제는 다음 문서를 먼저 확인하세요.

- [시작하기](getting-started.ko.md)
- [애플리케이션 통합 가이드](integration.ko.md)
- [Core 사용 가이드](core.ko.md)
- [MCP 사용 가이드](mcp.ko.md)
- [환경 설정 가이드](configuration.ko.md)

> [!NOTE]
> 이 문서의 타입 형태는 이해하기 쉽도록 TypeScript 표기로 정리했습니다.
> 실제 `.slip` 실행 검증은 `parseSlipFile`, `validateSlipFile`과 공개 스키마를 기준으로 합니다.

## 패키지 구성

| 패키지 | 주요 공개 API |
|---|---|
| `@omdc-slipkit/core` | 파일 검증, 전표 조립, 수식, PDF, 암호화, 저장소 인터페이스 |
| `@omdc-slipkit/elements` | Web Component, 설정 타입, 기본 프리셋과 저장소 구현 |
| `@omdc-slipkit/react` | React 래퍼 컴포넌트 |
| `@omdc-slipkit/vue` | Vue 래퍼 컴포넌트 |
| `@omdc-slipkit/mcp` | 로컬 stdio MCP 서버, 파일 시스템 저장소와 MCP 구조 안내 |

폰트는 다음 서브패스에서도 가져올 수 있습니다.

```ts
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';
```

## `@omdc-slipkit/core`

### 파일 파싱과 직렬화

#### `parseSlipFile`

```ts
function parseSlipFile(
  json: string,
  options?: { locale?: string },
): SlipFile;
```

JSON 문자열을 파싱하고 `.slip` 파일 전체를 검증합니다. 지원되는 마이그레이션 경로가 있으면 현재 스키마 버전으로 변환합니다.

유효하지 않은 JSON이나 파일 구조는 `SlipParseError`를 발생시킵니다. `options.locale`은 오류 메시지 언어를 정합니다(기본 영어).

문자열 맨 앞의 U+FEFF 한 개는 UTF-8 BOM으로 보고 파싱 전에 제거합니다. 다른 위치의 U+FEFF는 일반 문자열 내용이며 그대로 보존합니다. 문서 안의 문자열(제목, 라벨, 파라미터 키, 값)은 유니코드 정규화를 하지 않으므로 NFC와 NFD 표기는 서로 다른 키입니다.

#### `validateSlipFile`

```ts
function validateSlipFile(
  raw: unknown,
  options?: { locale?: string },
): SlipFile;
```

이미 파싱된 값을 `.slip` 파일로 검증합니다. `options.locale`은 오류 메시지 언어를 정합니다(기본 영어).

HTTP 요청 본문, `JSON.parse` 결과 또는 애플리케이션에서 직접 조립한 객체를 검사할 때 사용합니다.

#### `serializeSlipFile`

```ts
function serializeSlipFile(
  file: SlipFile,
): string;
```

`SlipFile` 객체를 들여쓰기된 JSON 문자열로 변환합니다.

이 함수는 입력 객체를 다시 검증하지 않습니다.

출력은 BOM으로 시작하지 않습니다.

#### `CURRENT_SCHEMA_VERSION`

```ts
const CURRENT_SCHEMA_VERSION: string;
```

현재 라이브러리가 사용하는 `.slip` 스키마 버전입니다.

새 양식을 코드로 직접 만들 때 버전 문자열을 하드코딩하지 않고 이 상수를 사용하는 것을 권장합니다.

```ts
const file: SlipTemplateFile = {
  schemaVersion:
    CURRENT_SCHEMA_VERSION,
  kind: 'template',
  template: {
    // ...
  },
};
```

### 설정 인스턴스

#### `createSlipKit`

```ts
function createSlipKit(
  config?: SlipKitConfig,
): SlipKit;
```

폰트, 수식 로케일과 암호화 키를 한 번 설정한 Core 인스턴스를 만듭니다.

#### `SlipKitConfig`

```ts
interface SlipKitConfig {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;

  encryption?: {
    key:
      | string
      | Uint8Array;

    previousKeys?: (
      | string
      | Uint8Array
    )[];
  };
}
```

| 필드 | 설명 |
|---|---|
| `getFonts` | PDF 렌더링에 사용할 폰트 공급 함수 |
| `locale` | 숫자·날짜 표시 형식과 오류 메시지에 사용할 BCP-47 로케일. 기본값은 `'en-US'` |
| `encryption.key` | 암호화·복호화 기본 키 |
| `encryption.previousKeys` | 이전 키로 암호화된 파일을 복호화할 때 추가로 시도할 키 |

#### `SlipKit`

```ts
interface SlipKit {
  readonly locale: string | undefined;

  readonly getFonts:
    | (() =>
        | readonly SlipFont[]
        | Promise<readonly SlipFont[]>)
    | undefined;

  render(
    file: SlipFile,
  ): Promise<Uint8Array>;

  buildVoucher(
    template: SlipTemplateFile,
    values: Record<string, JsonValue>,
  ): SlipVoucherFile;

  evaluate(
    source: string | FormulaAst,
    context: FormulaContext,
  ): FormulaValue;

  encrypt(
    file: SlipFile,
    key?: string | Uint8Array,
  ): Promise<string>;

  decrypt(
    json: string,
    key?: string | Uint8Array,
  ): Promise<SlipFile>;
}
```

| 프로퍼티·메서드 | 반환값 | 설명 |
|---|---|---|
| `locale` | `string \| undefined` | 인스턴스에 설정된 로케일 |
| `getFonts` | 함수 또는 `undefined` | 인스턴스가 공유하는 폰트 조회 함수. 성공한 결과는 재사용하고 실패한 조회는 다음 호출에서 다시 시도한다. |
| `render` | `Promise<Uint8Array>` | 양식 또는 전표를 PDF 바이트로 변환 |
| `buildVoucher` | `SlipVoucherFile` | 양식과 값으로 작성 중 전표 생성 |
| `evaluate` | `FormulaValue` | 수식 문자열 또는 AST 평가 |
| `encrypt` | `Promise<string>` | `.slip` 파일을 암호화 봉투 JSON으로 변환 |
| `decrypt` | `Promise<SlipFile>` | 암호화 봉투를 복호화하고 검증 |

### 전표 조립

#### `buildVoucher`

```ts
function buildVoucher(
  template: SlipTemplateFile,
  values: Record<string, JsonValue>,
): SlipVoucherFile;
```

양식과 입력값을 결합하여 `issued: false`인 전표를 만듭니다.

- 양식은 `templateSnapshot`으로 깊은 복사됩니다.
- 입력값도 원본 객체와 참조를 공유하지 않습니다.
- 최상위 숫자 파라미터의 빈 값은 `0`으로 정규화됩니다.
- 수식 결과는 `values`에 미리 넣지 않아도 됩니다.

#### `normalizeNumericParameters`

```ts
function normalizeNumericParameters(
  values: Record<string, unknown>,
  parameters?:
    readonly ParameterDef[],
): Record<string, unknown>;
```

`valueType: 'number'`인 최상위 파라미터의 `undefined`, `null`, 빈 문자열을 `0`으로 바꿉니다.

변경할 값이 없으면 입력 객체를 그대로 반환합니다.

### PDF 렌더링

#### `renderSlipToPdf`

```ts
function renderSlipToPdf(
  file: SlipFile,
  options?: RenderOptions,
): Promise<Uint8Array>;
```

양식 또는 전표 하나를 PDF 바이트로 변환하는 편의 함수입니다.

#### `createPdfRenderer`

```ts
function createPdfRenderer(
  options?: RenderOptions,
): SlipPdfRenderer;
```

같은 렌더링 설정을 여러 파일에 재사용할 수 있는 PDF 렌더러를 만듭니다.

#### `RenderOptions`

```ts
interface RenderOptions {
  getFonts?:
    () =>
      | readonly SlipFont[]
      | Promise<readonly SlipFont[]>;

  locale?: string;
}
```

| 필드 | 기본값 | 설명 |
|---|---|---|
| `getFonts` | 하부 엔진 기본 폰트 | 렌더링에 사용할 폰트 공급 함수 |
| `locale` | `'en-US'` | 숫자·날짜 표시 형식과 오류 메시지에 사용할 로케일 |

#### `SlipPdfRenderer`

```ts
interface SlipPdfRenderer {
  renderToPdf(
    file: SlipFile,
  ): Promise<Uint8Array>;
}
```

#### `SlipFont`

```ts
interface SlipFont {
  name: string;
  data: Uint8Array;
  fallback?: boolean;
}
```

| 필드 | 설명 |
|---|---|
| `name` | 양식의 `fontName`과 연결할 폰트 이름 |
| `data` | TTF 또는 OTF 폰트 바이트 |
| `fallback` | 다른 폰트를 찾지 못했을 때 사용할 대체 폰트 여부 |

`fallback: true`인 폰트는 하나만 지정할 수 있습니다. 지정하지 않으면 배열의 첫 번째 폰트를 대체 폰트로 사용합니다.

#### `stackVertically`

```ts
function stackVertically(
  text: string,
  vertical: boolean | undefined,
): string;
```

`vertical`이 `true`이면 문자열의 각 글자 사이에 줄바꿈을 넣어 세로쓰기용 문자열을 만듭니다.

일반적인 애플리케이션에서 직접 사용할 필요는 많지 않은 저수준 렌더링 보조 함수입니다.

### 수식

#### `parseFormula`

```ts
function parseFormula(
  source: string,
): FormulaAst;
```

수식 문자열을 파싱하여 AST를 반환합니다.

문법이 잘못되었거나 등록되지 않은 함수를 사용하면 `FormulaSyntaxError`가 발생합니다.

#### `evaluateFormula`

```ts
function evaluateFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaValue;
```

수식 문자열 또는 파싱된 AST를 평가합니다. 첫 오류에서 멈추고 오류를 던집니다.

#### `diagnoseFormula`

```ts
interface FormulaDiagnosis {
  value: FormulaValue;
  formulaError?: FormulaEvalError;
  dataError?: FormulaEvalError;
}

function diagnoseFormula(
  source: string | FormulaAst,
  context: FormulaContext,
): FormulaDiagnosis;
```

현재 값으로 수식을 진단해, 첫 오류에서 멈추지 않고 발견한 오류를 `formulaError`와 `dataError`로 나눠 돌려줍니다. 값이 없거나 예약 범위를 쓸 수 없어 실패한 자리는 빈 값으로 이어 끝까지 계산하고 그 실패를 `dataError`로, 식에서 난 오류를 `formulaError`로 알립니다. 둘 다 이번 계산 한 번의 실패이며, 어느 쪽도 그 수식이 어떤 값에서도 계산되지 않는다는 것을 증명하지 않습니다. `formulaError`나 `dataError`가 있으면 `value`는 진단 과정에서 나온 값이므로 결과로 보여 주지 않습니다.

#### `FormulaContext`

```ts
interface FormulaContext {
  values: Record<string, unknown>;
  now?: Date;
  locale?: string;
}
```

| 필드 | 기본값 | 설명 |
|---|---|---|
| `values` | 필수 | 수식에서 참조할 값 |
| `now` | 호출 시각 | `TODAY` 등 날짜 함수의 기준 시각 |
| `locale` | `'en-US'` | 숫자·날짜 표시 형식과 오류 메시지에 사용할 로케일 |

#### `resolveConditionalFormats`

```ts
function resolveConditionalFormats(
  rules: readonly ConditionalFormatRule[] | undefined,
  scope: Record<string, unknown>,
  options?: {
    locale?: string;
    subject?: string;
  },
): ConditionalFormatOverrides;
```

조건부 서식 규칙을 선언된 순서대로 평가하고, 조건이 참인 규칙의 스타일을 합성합니다. 같은 속성을 여러 규칙이 지정하면 뒤에 선언된 규칙의 값을 사용합니다.

조건식의 문법이 잘못되었거나 결과가 불리언이 아니면 `SlipRenderError`가 발생합니다. 값 누락이나 타입 불일치 등으로 조건식을 계산할 수 없으면 해당 규칙을 적용하지 않습니다.

#### `FormulaValue`

```ts
type FormulaValue =
  | number
  | string
  | boolean
  | null
  | FormulaValue[];
```

#### `FormulaAst`

`FormulaAst`는 다음 노드로 구성된 판별 유니온입니다.

| `type` | 의미 |
|---|---|
| `number` | 숫자 리터럴 |
| `string` | 문자열 리터럴 |
| `boolean` | 논리값 |
| `reference` | 파라미터 또는 하위 필드 참조 |
| `call` | 함수 호출 |
| `unary` | 단항 `+`, `-` |
| `binary` | 산술 또는 비교 연산 |

#### `FORMULA_FUNCTIONS`

```ts
const FORMULA_FUNCTIONS:
  readonly FormulaFunctionName[];
```

현재 등록된 수식 함수 이름 목록입니다. 이 목록에 없는 함수는 파싱 단계에서 거부됩니다.

함수별 인자와 사용 방법은 [수식 함수 참조](formula.ko.md)를 확인하세요.

#### `FORMULA_ARITY`

```ts
interface FormulaArity {
  min: number;
  max?: number;
}

const FORMULA_ARITY:
  Record<FormulaFunctionName, FormulaArity>;
```

지원하는 각 함수의 최소 인자 수와 최대 인자 수를 정의합니다. `max`가 없으면 인자 수에 상한이 없습니다.

#### `assertFormulaArity`

```ts
function assertFormulaArity(
  ast: FormulaAst,
  options?: { locale?: string },
): void;
```

파싱된 AST에 포함된 모든 함수 호출의 인자 수를 검사합니다. 인자 수가 `FORMULA_ARITY`와 맞지 않으면 `FormulaEvalError`가 발생합니다. 이 함수는 수식을 평가하지 않으므로 전표 값 없이 사용할 수 있습니다.

#### `FormulaFunctionName`

```ts
type FormulaFunctionName =
  (typeof FORMULA_FUNCTIONS)[number];
```

지원되는 수식 함수 이름의 문자열 유니온입니다.

### 암호화

#### `encryptSlipFile`

```ts
function encryptSlipFile(
  file: SlipFile,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<string>;
```

`.slip` 파일을 AES-256-GCM 암호화 봉투 JSON으로 변환합니다.

문자열 키는 암호 문구로 처리하고, `Uint8Array` 키는 32바이트 원시 AES 키여야 합니다.

암호 문구는 PBKDF2 키 파생 직전에 NFC로 정규화하므로 시각적으로 같은 NFC/NFD 암호 문구는 같은 키를 만듭니다. 원시 키는 그대로 사용합니다. 봉투 JSON은 BOM으로 시작하지 않습니다.

#### `decryptSlipFile`

```ts
function decryptSlipFile(
  json: string,
  key: string | Uint8Array,
  options?: { locale?: string },
): Promise<SlipFile>;
```

암호화 봉투를 복호화한 뒤 `parseSlipFile`로 검증합니다. `options.locale`은 오류 메시지 언어를 정합니다(기본 영어).

봉투 문자열 맨 앞의 U+FEFF 한 개는 파싱 전에 제거하고, 문자열 키는 `encryptSlipFile`과 같이 NFC로 정규화합니다.

#### `isEncryptedSlipFile`

```ts
function isEncryptedSlipFile(
  json: string,
): boolean;
```

JSON에 SlipKit 암호화 봉투 표식이 있는지 확인합니다.

복호화 가능 여부나 데이터 무결성을 검증하는 함수는 아닙니다.

맨 앞의 U+FEFF 한 개는 무시하므로 BOM이 붙은 봉투도 감지합니다.

## `.slip` 파일 타입

### `JsonValue`

```ts
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
```

전표의 `values`와 양식의 `sampleValues`에 사용할 수 있는 JSON 값입니다.

### `SlipFile`

```ts
type SlipFile =
  | SlipTemplateFile
  | SlipVoucherFile;
```

`kind`를 기준으로 양식과 전표를 구분하는 판별 유니온입니다.

### `SlipFileKind`

```ts
type SlipFileKind =
  SlipFile['kind'];
```

현재 값은 다음 두 종류입니다.

```ts
type SlipFileKind =
  | 'template'
  | 'voucher';
```

### `SlipTemplateFile`

```ts
interface SlipTemplateFile {
  schemaVersion: string;
  kind: 'template';
  template: SlipTemplateBody;
}
```

### `SlipVoucherFile`

```ts
interface SlipVoucherFile {
  schemaVersion: string;
  kind: 'voucher';
  templateSnapshot:
    SlipTemplateBody;

  values:
    Record<string, JsonValue>;

  issued: boolean;
}
```

| 필드 | 설명 |
|---|---|
| `templateSnapshot` | 전표를 만들 당시의 양식 전체 |
| `values` | 파라미터 물리명과 실제 값 |
| `issued` | 발행 여부 |

발행된 전표는 외부 URL 이미지에 의존할 수 없습니다. 고정 이미지와 변동 이미지 값은 파일 안에서 사용할 수 있는 형태로 포함해야 합니다.

### `SlipTemplateBody`

```ts
interface SlipTemplateBody {
  meta: {
    title: string;
    createdAt?: string;
    updatedAt?: string;
  };

  paper: CorePaperSize;
  pages: SlipPage[];
  assets: AssetEntry[];

  parameters?:
    ParameterDef[];

  sampleValues?:
    Record<string, JsonValue>;
}
```

| 필드 | 필수 | 설명 |
|---|:---:|---|
| `meta` | ● | 양식 제목과 선택적 생성·수정 시각 |
| `paper` | ● | 용지 크기와 여백 |
| `pages` | ● | 최소 한 개 이상의 페이지 |
| `assets` | ● | 파일에 포함된 이미지 등의 에셋 |
| `parameters` | — | 파라미터 정의 목록 |
| `sampleValues` | — | 디자이너 미리보기용 값 |

`createdAt`과 `updatedAt`은 시간대 오프셋이 포함된 ISO 날짜·시각 문자열을 사용합니다.

### Core의 `PaperSize`

`@omdc-slipkit/core`가 공개하는 `PaperSize`는 `.slip` 파일 안의 실제 용지 크기입니다.

```ts
interface CorePaperSize {
  width: number;
  height: number;

  padding: [
    top: number,
    right: number,
    bottom: number,
    left: number,
  ];
}
```

크기와 여백의 단위는 밀리미터입니다.

> [!CAUTION]
> `@omdc-slipkit/elements`도 `PaperSize`라는 이름을 공개하지만 용도가 다릅니다.
> Elements의 `PaperSize`는 디자이너 선택 목록에 표시할 `{ name, width, height }` 형태의 용지 프리셋입니다.

두 타입을 함께 사용한다면 별칭을 지정하는 것이 안전합니다.

```ts
import type {
  PaperSize as SlipPaperSize,
} from '@omdc-slipkit/core';

import type {
  PaperSize as PaperPreset,
} from '@omdc-slipkit/elements';
```

### `SlipPage`

```ts
interface SlipPage {
  elements: SlipElement[];
  key?: string;
  label?: string;
  pageNumber?: PageNumber;
  flowArea?: PageFlowArea;
}
```

| 필드 | 설명 |
|---|---|
| `elements` | 페이지에 배치된 요소 |
| `key` | 외부 연계에 사용할 페이지 물리명 |
| `label` | 디자이너 목록에 표시할 페이지 논리명 |
| `pageNumber` | PDF에 표시할 페이지 번호 설정 |
| `flowArea` | 자동 확장 요소가 배치될 세로 범위 |

문서 안에서 `key`는 중복될 수 없습니다.

### `PageFlowArea`

```ts
interface PageFlowArea {
  top: number;
  bottom: number;
}
```

`top`과 `bottom`은 용지 위쪽을 기준으로 한 mm 좌표입니다. 생략하면 용지의 위·아래 여백 사이를 흐름 영역으로 사용합니다.

### `PageNumber`

```ts
interface PageNumber {
  position: PageNumberPosition;
  format?: string;
  fontSize?: number;
}
```

`format`에서 `{n}`은 현재 페이지 번호, `{total}`은 전체 페이지 수로 변환됩니다.

기본 형식은 `{n} / {total}`입니다.

### `PageNumberPosition`

```ts
type PageNumberPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';
```

### `AssetEntry`

```ts
interface AssetEntry {
  id: string;
  mimeType: string;
  src: string;
}
```

`src`는 다음 형태를 사용할 수 있습니다.

| 형태 | 예 |
|---|---|
| 외부 URL | `https://example.com/logo.png` |
| Base64 데이터 | `data:image/png;base64,...` |
| 내장 에셋 참조 | `asset://company-logo` |

발행된 전표는 외부 URL 이미지를 포함할 수 없습니다.

### `ParameterDef`

```ts
interface ParameterDef {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;

  fields?: ParameterField[];
}
```

| 필드 | 설명 |
|---|---|
| `key` | 파일, 수식과 외부 연계에 사용하는 물리명 |
| `label` | 작성폼과 디자이너에 표시할 논리명 |
| `valueType` | 값 종류. 생략하면 글자로 취급 |
| `fields` | 목록 파라미터의 하위 필드 |

### `ParameterField`

```ts
interface ParameterField {
  key: string;
  label?: string;
  valueType?:
    ParameterValueType;
}
```

하위 필드는 다시 `fields`를 가질 수 없습니다.

### `ParameterValueType`

```ts
type ParameterValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'image'
  | 'list';
```

`fields`는 `valueType: 'list'`인 파라미터에서만 사용할 수 있습니다.

## 요소 타입

### `SlipElement`

```ts
type SlipElement =
  | TextElement
  | FieldElement
  | GridElement
  | ImageElement
  | BarcodeElement
  | LineElement
  | RectElement
  | EllipseElement
  | PolygonElement;
```

`type`을 기준으로 아홉 종류의 요소를 구분합니다.

### 모든 요소의 공통 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | 문자열 유니온 | 요소 종류 |
| `id` | `string` | 문서 전체에서 유일한 요소 식별자 |
| `name` | `string` | 디자이너에 표시할 요소 이름 |
| `position` | `{ x, y }` | 페이지 왼쪽 위를 기준으로 한 위치(mm) |
| `width` | `number` | 요소 너비(mm). 그리드는 열 너비의 합으로 계산하므로 사용하지 않음 |
| `height` | `number` | 요소 높이(mm). 그리드는 행 높이의 합으로 계산하므로 사용하지 않음 |
| `group` | `string?` | 여러 요소를 묶는 그룹 식별자 |
| `pagePlacement` | `PagePlacement?` | 생성된 출력 페이지에서 요소를 표시할 위치와 범위 |

### `PagePlacement`

```ts
type OutputPageFilter =
  | 'all'
  | 'first'
  | 'continuation'
  | 'non-final'
  | 'last';

type PagePlacement =
  | { mode: 'absolute'; pages?: OutputPageFilter }
  | { mode: 'after'; target: string; gap?: number };
```

`absolute`는 원래 좌표에 요소를 표시하며 `pages`로 표시할 출력 페이지를 고릅니다. `after`는 같은 양식 페이지에 있는 대상 요소의 마지막 출력 조각 뒤에 요소를 이어서 배치합니다.

### 글자 스타일 필드

텍스트, 필드, 그리드와 그리드 셀에서 다음 필드를 사용할 수 있습니다.

| 필드 | 타입 | 기본 동작 |
|---|---|---|
| `fontName` | `string?` | 대체 폰트 사용 |
| `fontSize` | `number?` | 요소별 기본 크기 |
| `alignment` | `'left' \| 'center' \| 'right'` | 왼쪽 정렬 |
| `verticalAlignment` | `'top' \| 'middle' \| 'bottom'` | 위쪽 정렬 |
| `bold` | `boolean?` | 굵은 폰트 변형 사용 |
| `italic` | `boolean?` | 기울임 폰트 변형 사용 |
| `underline` | `boolean?` | 밑줄 |
| `strikethrough` | `boolean?` | 취소선 |
| `lineHeight` | `number?` | 줄 간격 배수 |
| `characterSpacing` | `number?` | 자간(pt) |
| `vertical` | `boolean?` | 세로쓰기 |

### 색과 테두리 필드

해당 스타일을 지원하는 요소에서 다음 필드를 사용합니다.

| 필드 | 타입 |
|---|---|
| `backgroundColor` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `fontColor` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `borderColor` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `borderWidth` | `number` |
| `borderStyle` | `'solid' \| 'dashed' \| 'dotted'` |

### `ConditionalFormatRule`

```ts
interface ConditionalFormatRule {
  condition: string;
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

`condition`은 불리언 값을 반환하는 수식입니다. 규칙마다 색이나 글자 강조를 하나 이상 지정해야 하며, 요소 또는 셀마다 최대 20개까지 선언할 수 있습니다.

글자 강조 값은 `true`면 적용하고 `false`면 기본 스타일의 강조를 해제합니다. 필드를 생략하면 기본 스타일이나 앞선 규칙의 결과를 유지합니다.

`conditionalFormats?: ConditionalFormatRule[]`는 `TextElement`, `FieldElement`, `GridCell`에서만 사용할 수 있습니다.

### `ConditionalFormatOverrides`

```ts
interface ConditionalFormatOverrides {
  fontColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}
```

`resolveConditionalFormats`가 반환하는 스타일입니다. 조건이 참인 규칙이 없으면 모든 필드가 비어 있습니다.

### `TextElement`

```ts
interface TextElement {
  type: 'text';
  content: string;
  conditionalFormats?: ConditionalFormatRule[];

  // 공통 위치·크기,
  // 글자·색·테두리 스타일
}
```

모든 전표에서 동일하게 표시할 고정 문자열입니다.

### `FieldElement`

```ts
interface FieldElement {
  type: 'field';

  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  // 공통 위치·크기,
  // 글자·색·테두리 스타일
}
```

`parameter`와 `formula` 중 하나만 가져야 합니다.

### `ImageElement`

```ts
interface ImageElement {
  type: 'image';

  src?: string;
  parameter?: string;

  // 공통 위치·크기
}
```

| 필드 | 역할 |
|---|---|
| `src` | 모든 전표에서 같은 고정 이미지 |
| `parameter` | 전표마다 달라지는 이미지 값의 키 |

`src`와 `parameter` 중 하나만 가져야 합니다.

변동 이미지의 전표 값은 `data:` Base64 문자열을 사용합니다.

### `BarcodeElement`

```ts
interface BarcodeElement {
  type: 'barcode';

  kind: BarcodeKind;

  content?: string;
  parameter?: string;
  formula?: string;
  conditionalFormats?: ConditionalFormatRule[];

  fontColor?: string;
  backgroundColor?: string;
}
```

`content`, `parameter`, `formula` 중 하나만 가져야 합니다.

### `BarcodeKind`

```ts
type BarcodeKind =
  | 'qrcode'
  | 'code128'
  | 'ean13'
  | 'code39'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'itf14'
  | 'nw7'
  | 'japanpost'
  | 'gs1datamatrix'
  | 'pdf417';
```

### `LineElement`

```ts
interface LineElement {
  type: 'line';

  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  lineDirection?:
    | 'horizontal'
    | 'vertical'
    | 'down'
    | 'up';
}
```

`lineDirection`을 생략하면 `horizontal`을 사용합니다.

### `RectElement`

```ts
interface RectElement {
  type: 'rect';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;

  borderStyle?:
    | 'solid'
    | 'dashed'
    | 'dotted';

  radius?: number;
}
```

`radius`가 `0`보다 크면 파선 또는 점선 테두리를 함께 사용할 수 없습니다.

### `EllipseElement`

```ts
interface EllipseElement {
  type: 'ellipse';

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

### `PolygonElement`

```ts
interface PolygonElement {
  type: 'polygon';

  sides: number;

  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}
```

`sides`는 3 이상 12 이하의 정수입니다.

### `GridElement`

```ts
interface GridElement {
  type: 'grid';

  id: string;
  name: string;
  position: { x: number; y: number };
  group?: string;
  pagePlacement?: PagePlacement;

  cellBorderColor?: string;
  cellBorderWidth?: number;
  cellBorderStyle?: 'solid' | 'dashed' | 'dotted';
  outlineColor?: string;
  outlineWidth?: number;
  outlineStyle?: 'solid' | 'dashed' | 'dotted';

  columns: {
    width: number;
    autoMerge?: boolean;
  }[];

  rows: {
    height: number;
  }[];

  cells: GridCell[];
  repeat?: GridRepeat;

  overflow?:
    | 'clip'
    | 'shrink';

  // 글자·색·테두리 스타일
}
```

열 너비와 행 높이는 비율이 아니라 밀리미터 단위의 절대값입니다.

- 그리드 너비는 열 너비의 합으로 계산합니다.
- 그리드의 양식 높이는 행 높이의 합으로 계산합니다.
- 반복 출력 높이와 출력 페이지 수는 `repeat`의 행 구간과 페이지 방식으로 계산합니다.

`cellBorder*`는 대응하는 `border*`를 지정하지 않은 셀에 적용할 기본 테두리입니다. 기본값은 검정
실선 0.2mm입니다. `outline*`는 그리드 전체를 감싸는 별도의 테두리이며 기본 두께는 0이므로
표시되지 않습니다. 반복 출력 조각마다 네 변의 그리드 테두리를 따로 그립니다.

호환성을 위해 그리드의 `borderColor`·`borderWidth`·`borderStyle`은 대응하는 `cellBorder*`가
없을 때만 셀 기본 테두리로 읽습니다. 그리드 테두리로 해석하지 않으며 새 파일에는 사용하지
않습니다.

### `GridCell`

```ts
interface GridCell {
  row: number;
  column: number;

  name?: string;

  rowSpan?: number;
  colSpan?: number;

  content?: string;
  parameter?: string;
  formula?: string;

  overflow?:
    | 'clip'
    | 'shrink';

  // 글자·색·테두리 스타일
}
```

`row`와 `column`은 0부터 시작합니다.

`content`, `parameter`, `formula`는 동시에 둘 이상 사용할 수 없습니다.

셀의 `borderColor`·`borderWidth`·`borderStyle`은 대응하는 그리드의 `cellBorder*`보다
우선합니다.

`name`은 디자이너가 셀을 목록에 표시할 때 사용하는 이름이며 PDF에는 출력하지 않습니다. 생략하면 디자이너가 좌표를 표시합니다.

`item` 행 구간 안의 `parameter`는 목록 항목의 하위 필드를 가리키고, 그 밖에서는 전표 `values`의 최상위 키를 가리킵니다.

### `GridRepeat`

```ts
interface GridRepeat {
  parameter: string;
  bands: GridBand[];
  pagination: GridPagination;
  groupBy?: string[];
  maxItems?: number;
}
```

| 필드 | 설명 |
|---|---|
| `parameter` | 객체 배열을 가진 목록 파라미터 |
| `bands` | 각 양식 행의 출력 시점과 범위를 정의한 행 구간 목록 |
| `pagination` | 자동 확장 또는 고정 페이지 방식 |
| `groupBy` | 연속된 항목을 그룹으로 묶을 하위 필드 목록 |
| `maxItems` | 전체 출력 항목 수 상한 |

### `GridBand`

```ts
type GridBandPlacement =
  | 'before-data'
  | 'page-start'
  | 'group-start'
  | 'item'
  | 'group-end'
  | 'after-data'
  | 'page-end';

interface GridBand {
  id: string;
  name?: string;
  fromRow: number;
  toRow: number;
  placement: GridBandPlacement;
  pages?: OutputPageFilter;
  repeatOnPageBreak?: boolean;
}
```

`fromRow`와 `toRow`는 0부터 시작하며 양끝을 포함합니다. 모든 양식 행은 빈틈이나 겹침 없이 하나의 행 구간에 속해야 하고 `item` 구간은 정확히 하나 있어야 합니다.

행 구간은 `before-data`, `page-start`, `group-start`, `item`, `group-end`, `after-data`, `page-end` 순서로 배치합니다. `pages`는 `page-start`와 `page-end`의 표시 페이지를 제한하고, `repeatOnPageBreak`는 다음 페이지로 이어지는 그룹의 `group-start`를 다시 표시합니다.

### `GridPagination`

```ts
type GridPagination =
  | { mode: 'auto'; minItems: number }
  | { mode: 'fixed'; itemsPerPage: number };
```

`auto`는 문서 전체에 최소 `minItems`개의 항목 자리를 만들고 실제 데이터와 흐름 영역에 따라 출력 페이지를 계획합니다. `fixed`는 각 출력 페이지에 `itemsPerPage`개의 항목 자리를 만듭니다. 두 방식 모두 데이터가 부족한 자리는 빈 항목으로 표시하며, 빈 항목은 집계 범위에서 제외합니다.

## 저장소 API

### `StorageAdapter`

```ts
interface StorageAdapter {
  save(
    id: string,
    file: SlipFile,
  ): Promise<void>;

  load(
    id: string,
  ): Promise<SlipFile>;

  delete(
    id: string,
  ): Promise<void>;

  list(
    filter?: SlipListFilter,
    cursor?: string,
  ): Promise<SlipListPage>;
}
```

| 메서드 | 설명 |
|---|---|
| `save` | 같은 ID가 있으면 덮어쓰기 |
| `load` | ID에 해당하는 파일 불러오기 |
| `delete` | ID에 해당하는 파일 삭제 |
| `list` | 종류와 검색어로 목록 조회 |

### `SlipListFilter`

```ts
interface SlipListFilter {
  kind?: SlipFileKind;
  query?: string;
}
```

### `SlipListPage`

```ts
interface SlipListPage {
  items: SlipListItem[];
  nextCursor?: string;
}
```

`nextCursor`가 없으면 마지막 페이지입니다.

### `SlipListItem`

```ts
interface SlipListItem {
  id: string;
  kind: SlipFileKind;
  title: string;
  updatedAt?: string;
}
```

파일 본문을 포함하지 않는 목록용 메타데이터입니다.

### `VersionedStorageAdapter`

```ts
interface VersionedStorageAdapter
  extends StorageAdapter {
  listVersions(
    id: string,
  ): Promise<{
    version: string;
    savedAt: string;
  }[]>;

  loadVersion(
    id: string,
    version: string,
  ): Promise<SlipFile>;
}
```

버전 이력을 지원하는 사용자 저장소가 선택적으로 구현할 수 있는 확장 인터페이스입니다.

현재 동봉된 `IndexedDbStorage`는 이 인터페이스를 구현하지 않습니다. `SlipFileExchange`는 저장소가 아니므로 `StorageAdapter`를 구현하지 않습니다.

### `supportsVersions`

```ts
function supportsVersions(
  adapter: StorageAdapter,
): adapter is VersionedStorageAdapter;
```

저장소가 `listVersions`와 `loadVersion`을 모두 구현했는지 확인하는 타입 가드입니다.

## 스키마와 마이그레이션 API

### 공개 Zod 스키마

다음 스키마를 `@omdc-slipkit/core`에서 가져올 수 있습니다.

| 스키마 | 검증 범위 |
|---|---|
| `slipEnvelopeSchema` | `schemaVersion`과 `kind` |
| `slipFileSchema` | 양식 또는 전표 전체 |
| `slipTemplateFileSchema` | 양식 파일 전체 |
| `slipVoucherFileSchema` | 전표 파일 전체 |
| `slipTemplateBodySchema` | 양식 본문 |
| `slipElementSchema` | 요소 한 개 |
| `paperSchema` | 용지 크기와 여백 |

일반적인 외부 입력 검증에는 스키마를 직접 호출하기보다 마이그레이션과 오류 변환을 함께 수행하는 `parseSlipFile` 또는 `validateSlipFile`을 권장합니다.

### `slipFileJsonSchema`

```ts
function slipFileJsonSchema():
  Record<string, unknown>;
```

현재 `.slip` 형식의 draft 2020-12 JSON Schema 객체를 만듭니다.

패키지에는 다음 JSON Schema 파일도 포함됩니다.

- `@omdc-slipkit/core/schemas/slip.schema.json`
- 버전별 `slip-<schemaVersion>.schema.json`

> [!IMPORTANT]
> JSON Schema로 표현할 수 없는 일부 교차 필드 검증이 있습니다.
> 완전한 검증은 `parseSlipFile` 또는 `validateSlipFile`을 기준으로 해야 합니다.

### `migrateSlipDocument`

```ts
function migrateSlipDocument(
  document:
    Record<string, unknown>,

  steps?:
    readonly SlipMigrationStep[],
): Record<string, unknown>;
```

문서의 `schemaVersion`을 현재 버전까지 단계별로 변환합니다.

일반적으로 `parseSlipFile`과 `validateSlipFile`이 내부에서 호출하므로 직접 사용할 필요는 많지 않습니다.

### `SlipMigrationStep`

```ts
interface SlipMigrationStep {
  from: string;
  to: string;

  migrate(
    document:
      Record<string, unknown>,
  ): Record<string, unknown>;
}
```

### `BUILT_IN_MIGRATIONS`

```ts
const BUILT_IN_MIGRATIONS:
  readonly SlipMigrationStep[];
```

라이브러리에 포함된 마이그레이션 단계 목록입니다.

현재 기준 스키마가 최초 공개 형식이므로 목록이 비어 있습니다.

### `SLIP_LIMITS`

파일 검증에 사용하는 구조 크기 상한입니다.

| 필드 | 현재 값 | 의미 |
|---|---:|---|
| `maxPages` | 500 | 문서당 최대 페이지 수 |
| `maxElementsPerPage` | 2,000 | 페이지당 최대 요소 수 |
| `maxAssets` | 1,000 | 문서당 최대 에셋 수 |
| `maxGridCells` | 100,000 | 그리드 최대 셀 수 |
| `maxParameters` | 500 | 최대 파라미터 정의 수 |
| `maxGridRowTracks` | 1,000 | 그리드 최대 행 수 |
| `maxGridColumnTracks` | 100 | 그리드 최대 열 수 |
| `maxRepeatPerPage` | 1,000 | 페이지당 최대 반복 항목 수 |
| `maxRepeatItems` | 100,000 | 반복 목록 전체 항목 수 상한 |
| `maxGridBands` | 20 | 그리드당 최대 행 구간 수 |
| `maxOutputPages` | 2,000 | 양식 페이지 하나에서 생성할 수 있는 최대 출력 페이지 수 |
| `maxConditionalFormats` | 20 | 요소·셀당 최대 조건부 서식 규칙 수 |
| `maxLineHeight` | 10 | 줄 간격 배수 상한 |
| `maxCharacterSpacing` | 100 | 자간 절댓값 상한(pt) |
| `maxMillimeters` | 5,000 | 위치·크기·트랙·테두리·여백의 상한(mm) |
| `maxFontSize` | 500 | 글자 크기 상한(pt) |
| `maxTextLength` | 20,000 | 구조 문자열과 렌더링 문자열의 최대 길이 |
| `maxValueStringLength` | 3,000,000 | 업무 데이터 맵 문자열의 최대 길이 |
| `maxImageBytes` | 2MiB | PNG 또는 JPEG 이미지 한 장의 최대 디코딩 크기 |

## 패키지 통합 API

다음 Core export는 `@omdc-slipkit/elements`와 `@omdc-slipkit/mcp`가 패키지 경계를 넘어 같은 배치·수식 규칙을 공유하기 위해 존재합니다. 공개 API의 일부이며 안정적으로 유지하지만, 대부분의 호스트 애플리케이션에는 필요하지 않습니다.

| API | 사용 패키지 | 용도 |
|---|---|---|
| `elementBounds(element)` | Elements, MCP | 요소의 경계 상자를 밀리미터로 계산합니다. 크기를 트랙에서 계산하는 그리드도 포함합니다. |
| `planSourcePage(page, values, options)` | Elements | 양식 페이지 하나의 출력 페이지 계획(행 구간 배치, 항목 인스턴스, `after` 배치)을 만듭니다. 디자이너 미리보기는 PDF 렌더링과 같은 계획을 사용합니다. |
| `filterVisibleOnPage(elements, pageIndex, total)` | Elements | 주어진 출력 페이지에서 `pagePlacement`에 따라 보이는 요소만 고릅니다. |
| `SlipLayoutError` | Elements | 그리드를 배치할 수 없을 때(예: 흐름 영역보다 높은 행 구간) 계획 계층이 던지는 오류입니다. 디자이너는 그 메시지를 미리보기에 표시합니다. |
| `RESERVED_REF_NAMES` | Elements | 자동완성과 검사에 쓰는 예약 참조 루트(`@item`, `@group`, `@page`, `@all`, `@carried`) 목록입니다. |
| `GridPlan`, `GridFragment`, `GridItem`, `PlannedBand`, `SourcePagePlan` | Elements | `planSourcePage`가 반환하는 계획의 타입입니다. |

`planGrid`·`visiblePageRange` 같은 그 밖의 계획 도우미와 `GridFlow`·`ElementPlacement`·`PlanPaper` 타입은 구현 세부이며 export하지 않습니다. 패키지별 export 이름 전체는 tarball 소비자 검증이 확인하는 allowlist로 고정합니다. [공개 export](#공개-export)를 참고합니다.

## 공개 export

각 패키지는 루트와 공개 서브패스에서 정확히 아래 이름만 제공합니다. `dist/` 안의 그 밖의 경로는 내부용이며 import할 수 없습니다.

| 패키지 / 서브패스 | 런타임 값 | 타입 |
|---|---|---|
| `@omdc-slipkit/core` | 이 문서의 `@omdc-slipkit/core`, 스키마·마이그레이션 API, 저장소 API와 오류 타입에 적힌 모든 값 | 이 문서에 적힌 모든 `.slip` 파일·요소·저장소·수식·렌더링 타입 |
| `@omdc-slipkit/core/schemas/*` | `slip.schema.json`, `slip-0.1.0.schema.json` (JSON 파일) | — |
| `@omdc-slipkit/elements` | `SlipDesigner`, `SlipForm`, `SlipViewer`, `getPresets`, `loadDefaultFonts`, `IndexedDbStorage`, `SlipFileExchange` | `SlipFont`, `SlipDesignerSettings`, `PaperSize`, `SlipPreset`, `IndexedDbStorageOptions`, `SlipFileExchangeOptions` |
| `@omdc-slipkit/elements/default-fonts` | `loadDefaultFonts` | — |
| `@omdc-slipkit/elements/fonts/pretendard` | `PRETENDARD_FONTS` | — |
| `@omdc-slipkit/elements/fonts/noto-sans-jp` | `NOTO_SANS_JP_FONTS` | — |
| `@omdc-slipkit/react` | `SlipDesigner`, `SlipForm`, `SlipViewer` | `SlipDesignerProps`, `SlipFormProps`, `SlipViewerProps` |
| `@omdc-slipkit/vue` | `SlipDesigner`, `SlipForm`, `SlipViewer` | — |
| `@omdc-slipkit/mcp` | `createSlipMcpServer`, `FileSystemStorage`, `resolveInRoot`, `readConfigFile`, `loadConfigFonts`, `resolveServerOptions`, `SlipMcpConfigError`, `CONFIG_FILE_NAME`, `DEFAULT_KEY_ENV`, `DEFAULT_PREVIOUS_KEYS_ENV`, `editOpSchema`, `MAX_IMAGE_BYTES`, `SCHEMA_TOPICS`, `schemaTopicText` | `SlipMcpServerOptions`, `FileSystemStorageKey`, `FileSystemStorageOptions`, `SlipMcpConfig`, `ResolveInput`, `EditOp`, `SchemaTopic` |

`slipkit-mcp` CLI가 쓰는 PDF 링크 서버(`startPdfLinkServer` 등)는 CLI 내부 구현이며 export하지 않습니다.

## `@omdc-slipkit/elements`

패키지 루트를 import하면 세 Web Component가 등록됩니다.

```ts
import '@omdc-slipkit/elements';
```

클래스 타입도 직접 가져올 수 있습니다.

```ts
import type {
  SlipDesigner,
  SlipForm,
  SlipViewer,
} from '@omdc-slipkit/elements';
```

### `<slip-designer>`

양식 파일을 시각적으로 편집합니다.

#### 속성과 프로퍼티

| 이름 | 타입 | 전달 방식 | 기본값 |
|---|---|---|---|
| `src` | `string` | HTML 속성·프로퍼티 | `''` |
| `locale` | `string` | HTML 속성·프로퍼티 | `SlipKit` 로케일 또는 영어 |
| `slipkit` | `SlipKit` | JS 프로퍼티 | 생략 |
| `settings` | `SlipDesignerSettings` | JS 프로퍼티 | 동봉 기본 설정 |
| `presets` | `SlipPreset[]` | JS 프로퍼티 | 동봉 프리셋 2종 |
| `storage` | `StorageAdapter` | JS 프로퍼티 | 저장 기능 숨김 |
| `maxImageBytes` | `number` | `max-image-bytes` 속성·프로퍼티 | 2MB |

`src`에는 `kind: 'template'`인 파일을 `serializeSlipFile`로 변환한 JSON 문자열을 전달합니다.

#### 이벤트

| 이벤트 | `detail` | 발생 시점 |
|---|---|---|
| `slip-change` | `{ file: SlipTemplateFile }` | 양식이 편집될 때 |

실제 `file.kind`는 `'template'`입니다.

이 이벤트는 `bubbles: true`, `composed: true`로 전달됩니다.

### `<slip-form>`

양식에 값을 입력하고 전표를 발행합니다.

#### 속성과 프로퍼티

| 이름 | 타입 | 전달 방식 | 기본값 |
|---|---|---|---|
| `src` | `string` | HTML 속성·프로퍼티 | `''` |
| `locale` | `string` | HTML 속성·프로퍼티 | `SlipKit` 로케일 또는 영어 |
| `slipkit` | `SlipKit` | JS 프로퍼티 | 생략 |
| `maxImageBytes` | `number` | `max-image-bytes` 속성·프로퍼티 | 2MB |

`src`에는 다음 파일을 전달할 수 있습니다.

- `kind: 'template'`인 양식
- `kind: 'voucher'`, `issued: false`인 작성 중 전표
- `kind: 'voucher'`, `issued: true`인 발행된 전표

발행된 전표를 전달하면 입력이 잠깁니다.

현재 원본 양식에서 빈 미발행 전표를 다시 시작하려면 `reset()`을 호출합니다. 모든 값을 지우고 발행된 원본도 잠금 해제한 뒤 `slip-change`를 발생시키며, `src`를 읽을 수 없으면 아무 작업도 하지 않습니다.

#### 이벤트

| 이벤트 | `detail` | 발생 시점 |
|---|---|---|
| `slip-change` | `{ file: SlipVoucherFile }` | 입력값이 변경될 때 |
| `slip-issue` | `{ file: SlipVoucherFile }` | 전표 발행이 완료될 때 |

두 이벤트에서 실제 `file.kind`는 `'voucher'`입니다.

이벤트는 `bubbles: true`, `composed: true`로 전달됩니다.

### `<slip-viewer>`

양식이나 전표를 PDF로 렌더링하여 읽기 전용으로 표시합니다.

#### 속성과 프로퍼티

| 이름 | 타입 | 전달 방식 | 기본값 |
|---|---|---|---|
| `src` | `string` | HTML 속성·프로퍼티 | `''` |
| `locale` | `string` | HTML 속성·프로퍼티 | `SlipKit` 로케일 또는 영어 |
| `slipkit` | `SlipKit` | JS 프로퍼티 | 생략 |

뷰어는 파일 변경 이벤트를 발생시키지 않습니다.

## Elements 설정 타입

### `SlipDesignerSettings`

```ts
interface SlipDesignerSettings {
  getBarcodeKinds?():
    | BarcodeKind[]
    | Promise<BarcodeKind[]>;

  getPaperSizes?():
    | ElementPaperSize[]
    | Promise<ElementPaperSize[]>;

  savePaperSize?(
    size: ElementPaperSize,
  ):
    | void
    | Promise<void>;
}
```

### Elements의 `PaperSize`

```ts
interface ElementPaperSize {
  name: string;
  width: number;
  height: number;
}
```

디자이너의 용지 선택 목록에 표시할 프리셋입니다. 실제 `.slip` 용지 타입과 달리 `name`을 가지며 `padding`은 없습니다.

### `SlipPreset`

```ts
interface SlipPreset {
  id: string;
  name: string;

  create():
    SlipTemplateFile;
}
```

`create`는 호출할 때마다 독립된 새 양식 객체를 반환해야 합니다.

## Elements 내장 API

### `getPresets`

```ts
function getPresets(
  locale?: string,
): SlipPreset[];
```

동봉된 거래명세서와 청구서 프리셋 목록을 만듭니다. 제목·라벨·문구는 `locale`에 해당하는 언어(기본 영어)로 채워집니다.

### `IndexedDbStorage`

```ts
class IndexedDbStorage
  implements StorageAdapter {
  constructor(
    slipkit: SlipKit,
    options?:
      IndexedDbStorageOptions,
  );
}
```

브라우저 IndexedDB에 `.slip` 파일을 저장합니다.

`save`, `load`, `delete`, `list`를 모두 지원합니다.

#### `IndexedDbStorageOptions`

```ts
interface IndexedDbStorageOptions {
  dbName?: string;
  pageSize?: number;
  encryptOnSave?: boolean;
}
```

| 필드 | 기본값 | 설명 |
|---|---|---|
| `dbName` | `'slipkit'` | IndexedDB 데이터베이스 이름 |
| `pageSize` | `50` | 목록 한 페이지의 항목 수 |
| `encryptOnSave` | `false` | 저장할 본문의 암호화 여부 |

### `SlipFileExchange`

```ts
class SlipFileExchange {
  constructor(
    slipkit: SlipKit,
    options?: SlipFileExchangeOptions,
  );

  download(
    name: string,
    file: SlipFile,
  ): Promise<void>;

  open(): Promise<SlipFile>;
}
```

`SlipFileExchange`는 브라우저 다운로드와 파일 선택 창을 제공합니다. `StorageAdapter`를 구현하지 않으며 `download`와 `open`만 제공합니다.

#### `SlipFileExchangeOptions`

```ts
interface SlipFileExchangeOptions {
  encryptOnSave?: boolean;
}
```

`encryptOnSave`의 기본값은 `false`입니다. 열기는 이 값과 관계없이 암호화 봉투를 감지하고 `SlipKit`의 키로 복호화합니다.

### 동봉 폰트

#### `loadDefaultFonts`

```ts
function loadDefaultFonts(
  locale?: 'ko' | 'en' | 'ja',
): Promise<SlipFont[]>;
```

어떤 언어든 동봉된 두 패밀리(Pretendard Regular·Bold와 Noto Sans JP 서브셋)를 모두 불러옵니다. 언어는 대체 폰트만 정합니다. `'ja'`면 Noto Sans JP, 그 밖에는 Pretendard입니다. 같은 대체 폰트를 선택하는 호출은 로딩 Promise를 공유합니다.

#### `PRETENDARD_FONTS`

```ts
const PRETENDARD_FONTS:
  SlipFont[];
```

Pretendard Regular와 Bold를 포함합니다. Regular가 대체 폰트로 지정되어 있습니다.

#### `NOTO_SANS_JP_FONTS`

```ts
const NOTO_SANS_JP_FONTS:
  SlipFont[];
```

Noto Sans JP Regular 서브셋을 포함합니다. 해당 폰트가 대체 폰트로 지정되어 있습니다.

## `@omdc-slipkit/react`

React 19 이상을 지원합니다.

각 컴포넌트는 기저 `slip-*` 요소를 가리키는 `ref`를 받고, 표준 HTML 속성(`className`, `style`, `id`, `title`, `role`, `tabIndex`, `aria-*`, `data-*`)과 표준 DOM 이벤트 props(`onClick`, `onKeyDown` 등)를 그 요소에 그대로 전달합니다. `children`과 `dangerouslySetInnerHTML`은 props에 없습니다. 요소가 자체 shadow DOM을 그리기 때문입니다.

### `SlipDesigner`

```ts
interface SlipDesignerProps
  extends SlipHostAttributes {
  ref?: Ref<SlipDesignerElement>;
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  settings?:
    SlipDesignerSettings;

  presets?: SlipPreset[];
  storage?: StorageAdapter;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipTemplateFile,
  ): void;
}
```

Web Component의 `slip-change` 이벤트에서 `CustomEvent`를 제거하고 `SlipTemplateFile` 객체를 콜백에 직접 전달합니다.

### `SlipForm`

```ts
interface SlipFormProps
  extends SlipHostAttributes {
  ref?: Ref<SlipFormElement>;
  src: string;
  locale?: string;
  slipkit?: SlipKit;

  maxImageBytes?: number;

  onSlipChange?(
    file: SlipVoucherFile,
  ): void;

  onSlipIssue?(
    file: SlipVoucherFile,
  ): void;
}
```

### `SlipViewer`

```ts
interface SlipViewerProps
  extends SlipHostAttributes {
  ref?: Ref<SlipViewerElement>;
  src: string;
  locale?: string;
  slipkit?: SlipKit;
}
```

React 패키지에서는 다음 props 타입도 직접 가져올 수 있습니다.

```ts
import type {
  SlipDesignerProps,
  SlipFormProps,
  SlipViewerProps,
} from '@omdc-slipkit/react';
```

`SlipHostAttributes`는 React의 `HTMLAttributes<HTMLElement>`에서 `children`과 `dangerouslySetInnerHTML`을 뺀 것을 뜻하며 별도 이름으로 export하지 않습니다. `SlipDesignerElement`, `SlipFormElement`, `SlipViewerElement`는 `@omdc-slipkit/elements`가 export하는 `SlipDesigner`, `SlipForm`, `SlipViewer` 클래스입니다.

```tsx
import { useRef } from 'react';
import { SlipDesigner } from '@omdc-slipkit/react';
import type { SlipDesigner as SlipDesignerElement } from '@omdc-slipkit/elements';

export function DesignerPane() {
  const designer = useRef<SlipDesignerElement>(null);
  return (
    <SlipDesigner
      ref={designer}
      className="designer-pane"
      style={{ height: '80vh' }}
      aria-label="양식 디자이너"
      src={designerSrc}
      onSlipChange={handleSlipChange}
    />
  );
}
```

전용 props(`src`, 설정 props, `onSlipChange`, `onSlipIssue`)는 항상 우선하므로 spread한 객체가 이 값을 덮어쓸 수 없습니다. 선택형 래퍼 prop은 명시적으로 전달한 동안에만 내부 요소에 설정되며, 제거하면 요소 자체의 기본값으로 돌아갑니다. 발행 뒤 같은 원본으로 새 전표를 시작하려면 React의 `key`를 바꿔 `SlipForm`을 다시 마운트합니다.

## `@omdc-slipkit/vue`

Vue 3.4 이상을 지원합니다.

### `SlipDesigner`

| prop | 타입 | 필수 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `settings` | `SlipDesignerSettings` | — |
| `presets` | `SlipPreset[]` | — |
| `storage` | `StorageAdapter` | — |
| `maxImageBytes` | `number` | — |

발생 이벤트:

| 이벤트 | 전달값 |
|---|---|
| `slip-change` | `SlipTemplateFile` |

### `SlipForm`

| prop | 타입 | 필수 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |
| `maxImageBytes` | `number` | — |

발생 이벤트:

| 이벤트 | 전달값 |
|---|---|
| `slip-change` | `SlipVoucherFile` |
| `slip-issue` | `SlipVoucherFile` |

### `SlipViewer`

| prop | 타입 | 필수 |
|---|---|:---:|
| `src` | `string` | ● |
| `locale` | `string` | — |
| `slipkit` | `SlipKit` | — |

선택형 래퍼 prop도 같은 규칙을 따릅니다. prop을 제거하면 내부 요소의 기본값으로 돌아가며, 발행 뒤에는 Vue의 `:key`를 바꿔 `SlipForm`을 다시 마운트합니다.

## `@omdc-slipkit/mcp`

`@omdc-slipkit/mcp`는 로컬 stdio MCP 서버와 서버가 사용하는 파일 시스템 저장소를 제공합니다. 연결 및 도구 사용법은 [MCP 사용 가이드](mcp.ko.md)를 확인하세요.

### `createSlipMcpServer`

```ts
function createSlipMcpServer(
  options: SlipMcpServerOptions,
): {
  server: McpServer;
  storage: FileSystemStorage;
};
```

도구 7종과 `slip://schema` 리소스를 등록한 MCP 서버를 만듭니다. 반환된 `server`는 아직 전송 계층에 연결되지 않은 상태입니다.

```ts
interface SlipMcpServerOptions
  extends FileSystemStorageOptions {
  fonts?: readonly SlipFont[];
}
```

`fonts`를 생략하면 서버가 로케일에 맞는 동봉 폰트를 사용합니다. 값을 전달하면 해당 목록이 동봉 폰트를 대체합니다.

### `FileSystemStorage`

```ts
class FileSystemStorage
  implements StorageAdapter {
  readonly rootDir: string;

  constructor(options: FileSystemStorageOptions);
  resolvePath(id: string): string;
  save(id: string, file: SlipFile): Promise<void>;
  load(id: string): Promise<SlipFile>;
  delete(id: string): Promise<void>;
  list(filter?: SlipListFilter, cursor?: string): Promise<SlipListPage>;
}
```

지정한 기준 디렉터리 안에서 `.slip` 파일을 읽고 쓰는 Node.js 저장소입니다. id에 `.slip` 확장자가 없으면 자동으로 붙이며, 기준 디렉터리를 벗어나는 경로는 `SlipStorageError`로 거부합니다.

```ts
interface FileSystemStorageOptions {
  rootDir: string;
  locale?: string;
  encryption?: {
    key: FileSystemStorageKey;
    previousKeys?: FileSystemStorageKey[];
  };
}

type FileSystemStorageKey = string | Uint8Array;
```

### `slipkit-mcp.json`

```ts
interface SlipMcpConfig {
  rootDir?: string;
  locale?: string;
  fonts?: Array<{
    name: string;
    path: string;
    fallback?: boolean;
  }>;
  encryption?: {
    keyEnv?: string;
    previousKeysEnv?: string;
  };
}

interface ResolveInput {
  configPath?: string;
  cliRootDir?: string;
  cliLocale?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}
```

`rootDir`과 `fonts[].path`의 상대 경로는 설정 파일 위치를 기준으로 해석합니다. 설정 파일의 알 수 없는 필드, 잘못된 JSON, 없는 작업 디렉터리와 폰트 파일은 `SlipMcpConfigError`를 발생시킵니다.

### MCP 설정 API

| API | 설명 |
|---|---|
| `readConfigFile(filePath)` | JSON 파일을 읽고 `SlipMcpConfig`로 검증합니다. |
| `loadConfigFonts(entries, baseDir)` | 설정의 폰트 파일을 읽어 `SlipFont[]`로 변환합니다. |
| `resolveServerOptions(input)` | 설정 파일, CLI 값과 환경변수를 해석해 `{ options, configPath }`를 반환합니다. |
| `SlipMcpConfigError` | 설정 파일이나 설정에 지정한 파일을 읽고 적용하지 못했을 때 발생하는 오류입니다. |
| `CONFIG_FILE_NAME` | 기본 설정 파일 이름인 `slipkit-mcp.json`입니다. |
| `DEFAULT_KEY_ENV` | 기본 현재 키 환경변수 이름인 `SLIPKIT_MCP_KEY`입니다. |
| `DEFAULT_PREVIOUS_KEYS_ENV` | 기본 이전 키 환경변수 이름인 `SLIPKIT_MCP_PREVIOUS_KEYS`입니다. |

### 기타 MCP 공개 API

| API | 설명 |
|---|---|
| `resolveInRoot(rootDir, relPath, locale?)` | 상대 경로를 기준 디렉터리 안의 절대 경로로 변환합니다. 경로가 밖으로 나가면 오류를 발생시킵니다. |
| `editOpSchema` | `slip_edit` 연산을 검증하는 Zod 스키마입니다. |
| `EditOp` | `editOpSchema`에서 추론한 연산 타입입니다. |
| `MAX_IMAGE_BYTES` | `set_image`가 받을 수 있는 최대 이미지 크기인 `2 * 1024 * 1024`입니다. |
| `SCHEMA_TOPICS` | `slip_schema`가 지원하는 주제 목록입니다. |
| `SchemaTopic` | `SCHEMA_TOPICS`의 요소 타입입니다. |
| `schemaTopicText(topic)` | 지정한 주제의 영문 `.slip` 구조 안내를 반환합니다. |

## 오류 타입

### `SlipParseError`

`.slip` JSON 파싱, 스키마 검증 또는 마이그레이션에 실패했을 때 발생합니다.

### `SlipMigrationError`

직접 `migrateSlipDocument`를 호출했을 때 다음과 같은 마이그레이션 실패를 나타냅니다.

- 올바르지 않은 버전 형식
- 현재 라이브러리보다 새로운 버전
- 마이그레이션 경로 없음
- 마이그레이션 경로 순환

`parseSlipFile`과 `validateSlipFile`을 통해 발생한 마이그레이션 오류는 `SlipParseError`로 변환됩니다.

### `SlipRenderError`

PDF 변환, 폰트 설정 또는 양식 수식 계산에 실패했을 때 발생합니다.

### `FormulaSyntaxError`

수식 문법 분석에 실패했을 때 발생합니다.

```ts
class FormulaSyntaxError
  extends Error {
  readonly position: number;
}
```

`position`은 수식 문자열에서 오류가 발생한 0부터 시작하는 위치입니다.

### `FormulaEvalError`

```ts
type FormulaEvalReason =
  | 'data'
  | 'value'
  | 'formula';

class FormulaEvalError
  extends Error {
  readonly reason: FormulaEvalReason;
  get dataDependent(): boolean;
}
```

수식 평가 중 타입 불일치, 잘못된 인자 또는 0으로 나누기 등이 발생했을 때 사용합니다.

`reason`은 평가에 실패한 까닭입니다. `data`는 값이 없거나 예약 범위를 쓸 수 없는 경우, `value`는 계산에 쓴 값이 잘못된 경우, `formula`는 식 자체가 잘못된 경우입니다.

`dataDependent`는 안내 문구를 구분하기 위한 진단 정보이며, 어떤 입력에서도 계산 가능한지를 증명하지 않습니다. `value`에서는 같은 자리의 다른 피연산자가 아니라, 변환·검사에서 오류를 일으킨 값이 데이터에서 왔는지를 확인합니다. 오류 문구를 비교하는 대신 이 값을 사용합니다.

디자이너는 문법 오류, 등록되지 않은 함수, 함수 인자 수 오류, 결과가 논리값이 아닌 조건식처럼 확정할 수 있는 오류만 적용을 막습니다. 그 밖의 평가 실패는 적용을 허용하고 편집 화면에 경고를 표시합니다.

### `SlipEncryptionError`

다음과 같은 암호화·복호화 실패에 사용합니다.

- 암호화 키 없음
- 빈 암호 문구
- 원시 키 길이 오류
- 지원하지 않는 암호화 봉투
- 잘못된 키
- 암호문 변조
- Web Crypto API 사용 불가

### `SlipStorageError`

```ts
class SlipStorageError
  extends Error {
  readonly code:
    | 'not-found'
    | 'unsupported'
    | 'io'
    | 'cancelled';
}
```

| `code` | 의미 |
|---|---|
| `not-found` | 지정한 저장 키의 파일이 없음 |
| `unsupported` | 저장소가 해당 기능을 지원하지 않음 |
| `io` | 저장소 읽기·쓰기 실패 |
| `cancelled` | 사용자가 파일 선택을 취소함 |

## 관련 문서

- [시작하기](getting-started.ko.md)
- [양식 디자이너 사용 가이드](designer.ko.md)
- [애플리케이션 통합 가이드](integration.ko.md)
- [Core 사용 가이드](core.ko.md)
- [MCP 사용 가이드](mcp.ko.md)
- [환경 설정 가이드](configuration.ko.md)
- [수식 함수 참조](formula.ko.md)
