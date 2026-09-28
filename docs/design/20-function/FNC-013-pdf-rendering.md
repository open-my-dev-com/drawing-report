# FNC-013 PDF 변환과 렌더링

최종 갱신: 2026-09-28

## 개요

검증된 양식 또는 전표를 출력 페이지 계획과 pdfme 스키마로 바꾸고 PDF 바이트를 만드는 전체 흐름을
정의합니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | 페이지 계획, 요소 변환, 폰트 조회와 PDF 생성 순서를 정의했습니다. |

## 호출 조건

`renderSlipToPdf()`, `createPdfRenderer()` 또는 `SlipKit.render()`가 양식·전표를 출력할 때 호출합니다.

## 입력·출력

| 구분 | 항목 | 조건 |
| --- | --- | --- |
| 입력 | `SlipFile`과 `RenderOptions` | 파일은 현재 스키마를 따르고 폰트 제공 함수는 비동기일 수 있습니다. |
| 출력 | `Uint8Array` | 완성된 PDF 파일 바이트입니다. |

## 사전·사후 조건

양식은 샘플 값, 전표는 스냅샷과 실제 값을 사용합니다. 같은 입력·폰트·기준 시각은 화면과 같은 내용과
페이지 구성을 만들어야 합니다.

## 정상 처리 흐름

```mermaid
flowchart LR
    File[양식 또는 전표] --> Fonts[폰트 조회]
    Fonts --> Plan[출력 페이지 계획]
    Plan --> Convert[pdfme 스키마 변환]
    Convert --> Generate[PDF 생성]
    Generate --> Bytes[PDF 바이트]
```

## 분기와 예외 흐름

요소 종류별로 글자·수식·그리드·이미지·도형·선·바코드를 변환합니다. 공백 수식은 빈 값으로
표시합니다. 페이지 계획, 글자, 이미지, 바코드와 PDF 생성 실패는 원인을 포함한 `SlipLayoutError`
또는 `SlipRenderError`입니다.

## 데이터 조회·변경

입력 파일은 바꾸지 않습니다. 렌더 인스턴스는 폰트 조회 Promise를 재사용하고, 변환 한 번 동안
그리드 항목과 이미지 검사 결과를 캐시합니다.

## 하위 기능과 시퀀스

FNC-002·FNC-005, FNC-007~FNC-012와 FNC-014를 사용한 뒤 pdfme 생성기를 호출합니다.

## 오류·복구

일부 페이지만 반환하지 않습니다. 실패 원인을 고친 뒤 전체 PDF를 다시 생성합니다.

## 검증 기준

모든 요소 종류, 다중 페이지·반복 그리드, 양식·전표, 세 로케일과 폰트, Node.js·Chromium 결과,
PDF 서명과 페이지 수를 시험합니다.

## 관련 설계와 근거

- 데이터: DAT-002~DAT-009
- 인터페이스: IF-001·IF-002
- 오류: ERR-003
- `packages/core/src/render/convert.ts`
- `packages/core/src/render/pdfme-renderer.ts`

