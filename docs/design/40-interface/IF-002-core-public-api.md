# IF-002 Core 독립 공개 API와 JSON Schema

최종 갱신: 2026-09-28

## 개요

설정 인스턴스 없이 사용할 수 있는 Core 순수 함수, 공개 타입과 JSON Schema 진입점의 책임을
정의합니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | 파일, 수식, 레이아웃, 렌더링, 암호화와 스키마 공개 API를 분류했습니다. |

## 제공 범위

| 영역 | 대표 API | 계약 |
| --- | --- | --- |
| 파일 | `parseSlipFile`, `validateSlipFile`, `serializeSlipFile` | JSON과 `SlipFile` 사이를 검증하며 변환합니다. |
| 버전 | `migrateSlipDocument`, `CURRENT_SCHEMA_VERSION` | 지원 버전을 현재 구조로 올립니다. |
| 전표 | `buildVoucher` | 양식과 값을 독립 전표로 조립합니다. |
| 수식 | `parseFormula`, `evaluateFormula`, `diagnoseFormula` | 자체 문법을 파싱·평가·진단합니다. |
| 참조 | `collectFormulaReferences`, `renameFormulaReferences` | 수식 참조를 구조적으로 조회·변경합니다. |
| 레이아웃 | `planSourcePage`, `filterVisibleOnPage` | 원본 페이지의 출력 조각과 표시 요소를 계산합니다. |
| PDF | `createPdfRenderer`, `renderSlipToPdf` | 폰트와 로케일을 적용해 PDF 바이트를 만듭니다. |
| 이미지 | `inspectImageBytes`, `inspectImageDataUrl` | MIME, 서명과 크기를 검사합니다. |
| 암호화 | `encryptSlipFile`, `decryptSlipFile` | 호출별 키로 암호화 봉투를 처리합니다. |

## 공개 타입과 오류

파일·요소·레이아웃·수식·렌더링·저장소 타입은 패키지 루트에서 내보냅니다. 호출자는
`SlipParseError`, `SlipMigrationError`, `FormulaSyntaxError`, `FormulaEvalError`,
`SlipLayoutError`, `SlipRenderError`, `SlipEncryptionError`, `SlipStorageError`로 실패 영역을
구분할 수 있습니다.

## JSON Schema

`slipFileJsonSchema()`는 현재 형식의 Draft 2020-12 객체를 반환합니다. 패키지는 다음 정적 파일도
배포합니다.

| 경로 | 용도 |
| --- | --- |
| `@omdc-slipkit/core/schemas/slip-0.1.0.schema.json` | 특정 버전 검증 |
| `@omdc-slipkit/core/schemas/slip.schema.json` | 최신 버전 별칭 |

JSON Schema는 구조 검증용이며 버전 마이그레이션, 모든 교차 필드 규칙과 렌더링 검사를 대신하지
않습니다.

## 호환성·확장 경계

패키지 루트와 `schemas/*` export만 공개 경로입니다. 내부 소스 경로를 가져오지 않습니다. 공개 이름은
tarball 허용 목록과 런타임·선언 비교 시험으로 고정합니다. API를 제거하거나 의미를 바꾸려면 공개 전
호환 근거와 가이드·시험을 함께 갱신합니다.

## 관련 설계와 근거

- 기능: FNC-001~FNC-018
- 데이터: DAT-001~DAT-010
- 오류: ERR-001~ERR-004
- `packages/core/src/index.ts`
- `scripts/verify-packages/fixtures/public-exports.json`
