# Core API 가이드

[English](core.en.md)

`@omdc-slipkit/core`는 DOM이나 브라우저에 의존하지 않는 순수 TypeScript 라이브러리다.
Node.js에서도 그대로 쓸 수 있어, 서버에서 PDF를 만들거나 전표를 검증하는 데 쓴다.

## 목차

1. [설치](#1-설치)
2. [파일 파싱·직렬화](#2-파일-파싱직렬화)
3. [수식](#3-수식)
4. [PDF 렌더링](#4-pdf-렌더링)
5. [무결성 (해시·서명)](#5-무결성-해시서명)
6. [서버 연계 패턴](#6-서버-연계-패턴)

### 상세 참조

- **[주요 타입 참조](types.md)** — `SlipFile`, 폰트, `StorageAdapter`, `IntegrityJwk` 등 타입별 필드와 기본값

---

## 1. 설치

UI 패키지(`elements` / `react` / `vue`)를 쓰면 core가 의존성으로 따라오므로 따로 설치하지 않아도 된다.
서버에서 core만 단독으로 쓸 때만 직접 설치한다.

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

// 발행 규칙 검증 (발행 가능한 상태인지 확인)
const errors = validateSlipFile(file);
```

- `parseSlipFile`은 JSON 문자열을 받아 `SlipFile`로 바꾼다. 구버전 파일이면 현재 스키마 버전으로
  자동 마이그레이션한다.
- `serializeSlipFile`은 `SlipFile` 객체를 JSON 문자열로 변환한다.
- `validateSlipFile`은 이미 파싱된 JSON 값(`JSON.parse` 결과 등)을 검증해 `SlipFile`로 돌려준다.
  유효하지 않으면 `SlipParseError`를 던진다.

## 3. 수식

```ts
import { parseFormula, evaluateFormula } from '@omdc-slipkit/core';

const ast = parseFormula('SUM(items.금액)');
const result = evaluateFormula(ast, {
  bindings: { /* 바인딩 값 */ },
  items: { 금액: [1000, 2000, 3000] },
});
// result → 6000
```

29종의 내장 함수를 지원한다 (SUM, IF, ROUND, TEXT 등).
`eval`이나 `new Function`은 사용하지 않으며, 등록되지 않은 함수는 파싱 단계에서 거부된다.

## 4. PDF 렌더링

```ts
import { renderSlipToPdf } from '@omdc-slipkit/core';

const pdfBytes = await renderSlipToPdf(file, {
  fonts: [{ name: 'Pretendard', data: fontBuffer }],
});
// pdfBytes: Uint8Array — PDF 파일 바이트
```

- `fonts`에 한글 폰트를 등록해야 한글이 깨지지 않는다.
- `locale` 옵션으로 수식 포맷 함수의 숫자 표기를 바꿀 수 있다 (기본 `'ko-KR'`).
- 폰트 타입 상세는 [타입 참조](types.md#font)를 참고한다.

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

SHA-256 해시 + JWS(ES256) 서명. RFC 8785(JCS) 정규화를 거치며 Web Crypto API로 구현한다.

## 6. 서버 연계 패턴

SlipKit은 서버가 없는 임베드형 라이브러리다. 외부 백엔드와의 연계는 `.slip` 파일(순수 JSON)이
계약이 된다. 자세한 아키텍처는 [ARCHITECTURE.md](../ARCHITECTURE.md)를 참고한다.

### 기본 패턴: 백엔드는 JSON만 주고받는다

1. 백엔드가 양식 `.slip`과 전표 데이터(values)를 JSON으로 내려준다
2. 브라우저의 core가 전표를 조립하고 수식을 계산하고 발행한다
3. 발행된 전표 `.slip`을 백엔드에 올려 저장한다

백엔드는 `.slip`을 해석할 필요 없이 그대로 저장·전달하면 된다.
구조 검증이 필요하면 동봉된 JSON Schema를 쓸 수 있다.

### 서버에서 PDF를 만들어야 할 때

사람 없이 일괄 발행해야 하는 경우(야간 배치 등) core를 Node에서 실행하면 된다.

```ts
import { parseSlipFile, renderSlipToPdf, computeIntegrity } from '@omdc-slipkit/core';

const file = parseSlipFile(jsonFromDb);
const issued = await computeIntegrity(file);
const pdf = await renderSlipToPdf(issued, { fonts });
```

core는 순수 TS라 Node 20 이상에서 그대로 동작한다.
