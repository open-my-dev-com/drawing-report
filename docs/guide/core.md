# Core API 가이드

[English](core.en.md) · [日本語](core.ja.md)

`@omdc-slipkit/core`는 DOM이나 브라우저에 의존하지 않는 순수 TypeScript 라이브러리입니다.
Node.js에서도 그대로 쓸 수 있습니다.

별도 UI를 설치 하지 않고, Slip파일을 Core로 보내 서버에서 PDF를 만들거나 전표를 검증하게 할 수 있습니다.

## 목차

1. [설치](#1-설치)
2. [파일 파싱·직렬화](#2-파일-파싱직렬화)
3. [수식](#3-수식)
4. [PDF 렌더링](#4-pdf-렌더링)
5. [무결성 (해시·서명)](#5-무결성-해시서명)
6. [서버 연계 패턴](#6-서버-연계-패턴)

### 상세 참조

- **[수식 함수 참조](formula.md)** — 내장 함수 32종의 사용법·인자·예시
- **[주요 타입 참조](types.md)** — `SlipFile`, 폰트, `StorageAdapter`, `IntegrityJwk` 등 타입별 필드와 기본값

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

## 3. 수식

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

## 4. PDF 렌더링

```ts
import { renderSlipToPdf } from '@omdc-slipkit/core';

const pdfBytes = await renderSlipToPdf(file, {
  fonts: [{ name: 'Pretendard', data: fontBuffer }],
});
// pdfBytes: Uint8Array — PDF 파일 바이트
```

- `fonts`에 올바른 폰트를 등록해야합니다. 폰트가 잘못되어 있을 경우 PDF 출력시 깨질 수 있습니다.
- `locale` 옵션으로 수식 포맷 함수의 숫자 표기를 변경할 수 있습니다. (기본 `'ko-KR'`).
- 폰트 타입 상세는 [타입 참조](types.md#font)를 참고해 주세요.

## 5. 무결성 (해시·서명)

```ts
import {
  computeIntegrity,
  verifyIntegrity,
  generateSigningKeyPair,
} from '@omdc-slipkit/core';

// 해시만 기록
const hashed = await computeIntegrity(file);

// 서명까지 기록
const keyPair = await generateSigningKeyPair();
const signed = await computeIntegrity(file, { privateKey: keyPair.privateKey });

// 검증
const result = await verifyIntegrity(signed);
// result.hashValid, result.signatureValid
```

`.slip`파일에 대한 무결성을 확인합니다.
SHA-256 해시 + JWS(ES256) 서명. RFC 8785(JCS) 정규화를 거치며 Web Crypto API로 구현됩니다.

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
import { parseSlipFile, renderSlipToPdf, computeIntegrity } from '@omdc-slipkit/core';

const file = parseSlipFile(jsonFromDb);
const issued = await computeIntegrity(file);
const pdf = await renderSlipToPdf(issued, { fonts });
```

core는 Node 20 이상에서만 동작합니다.
