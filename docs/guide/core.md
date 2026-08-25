# Core API 가이드

[English](core.en.md) · [日本語](core.ja.md)

`@omdc-slipkit/core`는 DOM이나 브라우저에 의존하지 않는 순수 TypeScript 라이브러리입니다.
Node.js에서도 그대로 쓸 수 있습니다.

별도 UI를 설치 하지 않고, Slip파일을 Core로 보내 서버에서 PDF를 만들거나 전표를 검증하게 할 수 있습니다.

## 목차

1. [설치](#1-설치)
2. [파일 파싱·직렬화](#2-파일-파싱직렬화)
3. [전표 조립 — 양식에 값 채우기](#3-전표-조립--양식에-값-채우기)
4. [수식](#4-수식)
5. [PDF 렌더링](#5-pdf-렌더링)
6. [서버 연계 패턴](#6-서버-연계-패턴)
7. [파일 암호화 (선택)](#7-파일-암호화-선택)

### 상세 참조

- **[수식 함수 참조](formula.md)** — 내장 함수 32종의 사용법·인자·예시
- **[주요 타입 참조](types.md)** — `SlipFile`, 폰트, `StorageAdapter` 등 타입별 필드와 기본값

---

## 1. 설치

UI 패키지(`elements` / `react` / `vue`)를 사용하는 프로젝트의 경우 core가 의존성으로 따라옵니다. (별도 설치 불필요)
UI와 전표 서버를 분리할 경우, 이 때 서버에서 core만 단독으로 사용해야할 경우 설치합니다.

```bash
npm install @omdc-slipkit/core
```

## 2. 파일 파싱·직렬화

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  validateSlipFile,
} from '@omdc-slipkit/core';

// JSON 문자열 → SlipFile 객체 (구버전이면 자동 마이그레이션)
const file = parseSlipFile(jsonString);

// SlipFile 객체 → JSON 문자열
const json = serializeSlipFile(file);

// 이미 파싱된 JSON 값을 검증 (JSON.parse 결과 등)
const validated = validateSlipFile(jsonValue);
```

- `parseSlipFile`은 JSON 문자열을 받아 `SlipFile` 객체로 변환합니다. 구버전 파일일 경우에는 현재 스키마 버전으로 자동 마이그레이션이 됩니다.
- `serializeSlipFile`은 `SlipFile` 객체를 JSON 문자열로 변환합니다.
- `validateSlipFile`은 파싱된 JSON 값(`JSON.parse` 결과 등)을 검증해 `SlipFile`로 돌려줍니다. 파일이 유효하지 않으면 `SlipParseError`를 던집니다.

## 3. 전표 조립 — 양식에 값 채우기

UI 없이 core만으로 전표를 만들 때는 **양식(template)에 값(values)을 채워** 전표(voucher) 객체를 직접
조립합니다. 양식은 `.slip` 파일로 연계하지만, 파라미터에 넣을 데이터는 이 `values` 객체로 넘깁니다.

### values 객체의 모양

키는 양식의 **파라미터 물리명(`key`)**, 값은 파라미터 타입에 따라 다릅니다.

| 파라미터 타입 | 값 |
|---|---|
| 글자·숫자·날짜·참거짓 | 그 값 그대로 (`'2026-08-24'` · `12000` · `true`) |
| 이미지 | `data:` base64 문자열 (외부 URL 불가 — core는 네트워크를 쓰지 않습니다) |
| 목록(list) | **객체 배열** — 항목마다 하위 필드 `key`로 값을 담습니다 |

```ts
const values = {
  tradeDate: '2026-08-24',          // date 파라미터
  items: [                          // list 파라미터 — 하위 필드 key로 채운다
    { itemName: '연필', spec: 'HB', quantity: 12, unitPrice: 300, amount: 3600 },
    { itemName: '공책', spec: 'A5', quantity: 5, unitPrice: 1200, amount: 6000 },
  ],
  // totalAmount는 수식 SUM(items.amount)로 계산되므로 넣지 않아도 됩니다
};
```

### 양식 + 값 → 전표

`buildVoucher(양식, 값)`이 양식 스냅샷 내장 · number 파라미터 빈 값 0 정규화(ADR-044) · 전표 조립을
한 번에 해줍니다. 나온 전표를 `render`에 넘기면 값이 채워진 PDF가 나옵니다.

```ts
import { parseSlipFile, createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({ getFonts });   // 설정은 여기서 한 번 (아래 §5)

const template = parseSlipFile(templateJson);
if (template.kind !== 'template') throw new Error('양식 파일이 아닙니다');

const voucher = slip.buildVoucher(template, values);   // 발행 전(issued: false) 전표
const pdf = await slip.render(voucher);
```

- 수식으로 계산되는 필드(예: 합계금액)는 `values`에 넣지 않아도 렌더 시 자동으로 계산됩니다.
- 전표는 생성 시점의 양식을 `templateSnapshot`으로 통째로 담습니다 — 나중에 양식이 바뀌어도 이 전표는
  그대로 렌더됩니다 (ADR-008). `buildVoucher`가 반환한 전표는 입력 양식·값과 참조를 공유하지 않습니다.
- 목록 값의 개수가 한 페이지 항목 수를 넘으면 페이지가 자동으로 늘어납니다.

### 발행(확정)

값을 확정해 **잠그는** 것이 **발행**입니다 — `issued: true`로 바꾸면 작성폼이 입력을 막습니다.
발행된 전표도 렌더는 동일합니다.

```ts
const issued = { ...voucher, issued: true };
const pdf = await slip.render(issued);
```

> `buildVoucher` 없이 직접 조립해도 됩니다 — 전표는 `{ schemaVersion, kind: 'voucher', templateSnapshot,
> values, issued }` 객체이며, `buildVoucher`는 여기에 깊은 복사와 number 정규화를 더해 줄 뿐입니다.
> 직접 만든 객체는 `validateSlipFile(voucher)`로 검증할 수 있습니다.

## 4. 수식

```ts
import { parseFormula, evaluateFormula } from '@omdc-slipkit/core';

const ast = parseFormula('SUM(items.amount)');
const result = evaluateFormula(ast, {
  values: { items: { amount: [1000, 2000, 3000] } },
});
// result → 6000
```

32종의 내장 함수를 지원합니다 (SUM, IF, ROUND, CONCAT 등). 함수별 사용법은 **[수식 함수 참조](formula.md)** 를 참고해 주세요.
등록되지 않은 함수는 파싱 단계에서 거부됩니다.

## 5. PDF 렌더링

폰트·로케일 같은 설정은 `createSlipKit`로 **한 번** 주고, 이후 `render(file)`는 파일만 받습니다 —
렌더 호출마다 폰트를 넘기지 않습니다 (ADR-056).

```ts
import { createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({
  getFonts: () => [{ name: 'Pretendard', data: fontBuffer, fallback: true }],
  locale: 'ko-KR',
});

const pdfBytes = await slip.render(file);   // Uint8Array — PDF 파일 바이트
```

- 폰트는 설정의 `getFonts`로 한 번 공급합니다 — 동기 배열도, 서버에서 받아오는 Promise도 됩니다 (ADR-040).
  한글·일본어 문서는 폰트를 반드시 공급해야 하며, 없으면 글자가 깨질 수 있습니다.
- `locale`은 수식 포맷 함수(FORMAT_NUMBER 등)의 숫자 표기에 쓰입니다 (기본 `'ko-KR'`).
- 폰트 타입 상세는 [타입 참조](types.md#font)를 참고해 주세요.
- 저수준 함수 `createPdfRenderer(설정)`·`renderSlipToPdf(file, 설정)`도 있으나, 설정을 한 번 지니는
  `createSlipKit`을 권합니다. 인스턴스는 `render` 외에 `buildVoucher`·`evaluate`·`encrypt`/`decrypt`도 제공합니다.

## 6. 서버 연계 패턴

SlipKit은 서버가 없는 임베드형 라이브러리로 외부 백엔드와 `.slip` 파일을 통해 연계가 됩니다. 
자세한 아키텍처는 [ARCHITECTURE.md](../ARCHITECTURE.md)를 참고해 주세요.

### 기본 흐름 1 : 백엔드에서 JSON으로 요청 -> 전표 결과를 JSON 바이너리로 취득하는 형태.

1. 백엔드에서 `.slip`과 전표에 넣을 데이터(values)를 JSON으로 전송합니다.
2. 이 패키지의 core를 통해 전표를 조립하고 수식을 계산하고 발행합니다.
3. 발행된 전표 `.pdf`을 바이너리로 변경 후, 백엔드에 돌려줍니다.

### 기본 흐름 2 : 야간 배치등을 통해 서버에서 PDF를 만들어야 하는 경우

요청 없이 특정 시간대에 발행이 필요하는 경우(야간 배치 등) core를 Node를 활용하여 실행시키면 됩니다.

```ts
import { parseSlipFile, createSlipKit } from '@omdc-slipkit/core';

const slip = createSlipKit({ getFonts });   // 설정은 한 번
const file = parseSlipFile(jsonFromDb);
const pdf = await slip.render(file);
```

core는 Node 20 이상에서만 동작합니다.

## 7. 파일 암호화 (선택)

`.slip`은 JSON이라 편집기로 열면 내용이 다 보입니다. 민감한 양식·전표를 잠가 두려면 암호화합니다
(AES-256-GCM, ADR-054). 키를 **설정에 한 번** 주면 `slip.encrypt`/`slip.decrypt`가 그 키를 씁니다 (ADR-056).

```ts
import { createSlipKit, isEncryptedSlipFile } from '@omdc-slipkit/core';

// 키는 설정에 한 번 — 암호(passphrase) 또는 32바이트 원시 키(Uint8Array)
const slip = createSlipKit({ encryption: { key: '비밀-암호' } });

const locked = await slip.encrypt(file);    // 봉투 JSON 문자열
const file2 = await slip.decrypt(locked);   // 복호화 후 자동으로 검증까지

isEncryptedSlipFile(locked);   // true — 표준 .slip과 구분
```

- 파일마다 다른 키는 인자로 덮어씁니다 — `slip.encrypt(file, otherKey)`. 키를 바꿨으면 설정에
  `encryption.previousKeys`를 두면 옛 키로 잠근 파일도 `decrypt`가 풉니다(회전).
- 설정 인스턴스 없이 단독 함수로도 됩니다 — `encryptSlipFile(file, key)` · `decryptSlipFile(json, key)`.
- **키 관리는 호스트 책임**입니다 — core는 키를 만들거나 보관하지 않습니다.
- 잠근 파일은 **표준 `.slip`이 아닙니다.** 받는 쪽이 같은 키로 풀어야 읽을 수 있어 시스템 간
  그대로 주고받을 수 없습니다.
- 틀린 키나 변조된 파일은 복호화 단계에서 걸러집니다(AES-GCM 인증).
- 봉투 형식은 [SPEC §8](../SPEC.md)을 보세요.
- UI(디자이너 등)에서 저장할 때 자동으로 잠그려면 core 함수를 직접 부르지 말고 저장소 어댑터의
  `encryption` 설정을 쓰세요 (ADR-055) — [타입 참조](types.md#저장-시-암호화-선택-adr-055).