# IF-002 Core 독립 공개 API와 JSON Schema

최종 갱신: 2026-09-28

## 개요

설정 인스턴스 없이 사용할 수 있는 Core 순수 함수, 공개 타입과 JSON Schema 진입점의 책임을
정의합니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | 파일, 수식, 레이아웃, 렌더링, 암호화와 스키마 공개 API를 분류했습니다. |

## 제공자와 소비자

`@omdc-slipkit/core`가 패키지 루트와 `schemas/*` 경로로 제공하고, 직접 통합하는 호스트와 Elements·MCP
패키지가 소비합니다. 내부 소스 경로와 빌드 산출물의 실제 파일명은 계약이 아닙니다.

## 호출 방향과 사용 조건

호출자는 외부 파일을 FNC-001로 검증한 뒤 다른 API에 전달합니다. 순수 계산 API는 공유 인스턴스 없이
호출하고, 폰트·로케일·키를 반복 사용하면 IF-001의 `SlipKit` 인스턴스를 사용합니다.

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

## 동기·비동기 처리

파싱, 마이그레이션, 전표 조립, 수식과 레이아웃 계산은 동기 결과를 반환합니다. PDF와 암호화처럼 폰트,
Web Crypto 또는 생성기를 사용하는 함수는 Promise를 반환합니다. JSON Schema 조회는 동기이며 매번
같은 현재 버전 구조를 반환합니다.

## 생명주기

독립 함수는 호출 뒤 남는 자원을 만들지 않습니다. PDF 렌더러 팩터리를 사용하면 생성한 인스턴스의
폰트 조회 결과를 재사용할 수 있으며, 호출자가 인스턴스 참조를 버리면 함께 정리됩니다.

## 반복 호출·동시 호출

순수 함수는 입력 객체를 바꾸지 않습니다. 기준 시각을 받는 날짜 함수는 같은 시각을 전달했을 때 같은
결과를 내며, 기준 시각을 생략하면 호출 시각에 따라 결과가 달라질 수 있습니다. 렌더링과 암호화 호출의
중간 상태는 서로 격리합니다. 공개 오류와 반환 객체를 다른 호출에서 재사용하거나 변경하지 않습니다.

## 오류 처리

각 API는 아래 공개 오류 종류로 실패 영역을 구분합니다. 구조 검증에 실패한 값을 부분 성공 결과로
반환하지 않으며, Promise API도 같은 오류 객체 계약을 사용합니다.

## 호환성·보안·확장 경계

패키지 루트와 `schemas/*` export만 공개 경로입니다. 내부 소스 경로를 가져오지 않습니다. 공개 이름은
tarball 허용 목록과 런타임·선언 비교 시험으로 고정합니다. API를 제거하거나 의미를 바꾸려면 공개 전
호환 근거와 가이드·시험을 함께 갱신합니다.

## 관련 설계와 근거

- 기능: FNC-001~FNC-018
- 데이터: DAT-001~DAT-010
- 오류: ERR-001~ERR-004
- `packages/core/src/index.ts`
- `scripts/verify-packages/fixtures/public-exports.json`
