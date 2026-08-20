# `.slip` 파일 포맷 명세 (SPEC)

> `.slip` 파일의 **공개 규범 명세**다 (ADR-022). 타 시스템은 이 문서와 동봉된
> JSON Schema만으로 `.slip` 파일을 읽고 쓸 수 있어야 한다.
> 레퍼런스 구현은 `@omdc-slipkit/core`이며, 이 문서와 구현이 어긋나면 이 문서가 우선한다.

- 상태: **Draft** (schemaVersion `0.2.0`)
- 최종 갱신: 2026-08-20
- 근거 ADR: 001, 007, 008, 011, 014, 018, 019, 020, 022

이 문서에서 **필수/금지/해야 한다**는 규범 요구사항을, *권장*은 비규범 권고를 뜻한다.

---

## 1. 개요

`.slip` 파일은 **UTF-8로 인코딩된 단일 JSON 문서**다 (ADR-007). 파일 하나가
다음 둘 중 하나를 담는다 (`kind` 필드로 구분, ADR-018):

| kind | 내용 |
|---|---|
| `template` | 양식(템플릿) — 용지·페이지·요소 정의 |
| `voucher` | 전표 — 생성 시점의 양식 **전체 스냅샷** + 기입값 + 무결성 정보 |

전표 파일은 양식 저장소 없이 **파일 단독으로 열람 가능**해야 한다(자기완결, ADR-008).

MIME 타입(비규범 권장): `application/vnd.slipkit.slip+json`

## 2. 봉투(envelope)와 버전

모든 `.slip` 문서의 최상위에는 다음 두 필드가 **필수**다:

```json
{ "schemaVersion": "0.2.0", "kind": "template" }
```

- `schemaVersion`: 이 문서가 따르는 스키마 버전. `MAJOR.MINOR.PATCH` semver 형식 필수.
- 현재 버전은 **`0.2.0`**이다. 제품 v1 안정 릴리스 시점에 `1.0.0`으로 확정한다.
  (이력: 0.1.0 최초 공개 → 0.1.1 구조 크기 상한 추가(§3.2) → 0.2.0 동적 표 열 구조·선 방향·
  타원/삼각형·글자 스타일·바인딩 정의부·샘플 값·요소 그룹 (ADR-032))

### 2.1 버전 처리 규칙 (ADR-007)

구현(리더)은 파일을 열 때:

1. `schemaVersion`이 자신이 아는 최신 버전과 같으면 그대로 검증·해석한다.
2. 더 **낮으면** 단계별 마이그레이션으로 최신 버전까지 끌어올린 뒤 해석해야 한다.
3. 더 **높으면** 해석을 시도하지 말고 명확한 오류를 내야 한다(미래 포맷).

라이터는 항상 자신이 아는 최신 `schemaVersion`으로 기록해야 한다.

## 3. 공통 자료형

| 자료형 | 규칙 |
|---|---|
| 길이 | 항상 **mm** 단위의 수. 좌표계는 용지 좌상단 원점, x→오른쪽, y→아래 (ADR-011) |
| 색상 | `#RRGGBB` 또는 `#RRGGBBAA` (대소문자 무관 hex) |
| id | 비어 있지 않은 문자열. 유일성 범위는 각 절에 명시 |
| 일시 | ISO 8601 (`date-time`, 오프셋 허용) |
| 정렬 | `left` \| `center` \| `right` |
| 비율 배열 | 양수 배열, 합이 100 (허용 오차 ±0.01) |

### 3.1 리소스 참조 `src` (ADR-007)

이미지 등 리소스 참조는 `src` 문자열 하나로 통일하며 3형식을 지원한다:

| 형식 | 예 | 용도 |
|---|---|---|
| 외부 URL | `https://cdn.example.com/logo.png` | 작성·편집 중에만 (ADR-014) |
| data URI | `data:image/png;base64,iVBOR...` | 파일 내장 |
| 내부 에셋 | `asset://logo` | 같은 문서 `assets` 항목의 `id` 참조 |

`asset://<id>` 참조는 같은 문서 본문의 `assets` 배열에 해당 `id`가 **존재해야 한다**.
(`asset://`는 추후 ZIP 컨테이너 확장의 장치이기도 하다 — ADR-007. 컨테이너가 추가되어도
스키마는 변하지 않는다.)

### 3.2 구조 크기 상한 (0.1.1)

적대적으로 큰 파일이 구현의 메모리·스택을 고갈시키지 못하도록, 아래 상한을 넘는
문서는 **거부해야 한다**:

| 대상 | 상한 |
|---|---|
| `pages` 수 | 500 |
| 페이지당 `elements` 수 | 2,000 |
| `assets` 수 | 1,000 |
| `fixedGrid.rows` | 1,000 |
| `fixedGrid.columns` | 100 |
| `fixedGrid.cells` 수 | 100,000 |
| `dynamicTable.columns` 길이 | 100 |
| `bindings` 길이 | 500 |
| `field.formula` 길이 | 10,000자 |
| 수식 중첩 깊이 (괄호·함수 인자·부호) | 100단계 |
| 값(`values` 등)의 중첩 깊이 | 256단계 |

위쪽 7개는 구조 검증(§9-1) 대상이라 동봉 JSON Schema에도 반영된다. 수식 길이·중첩과
값 깊이는 수식 파싱·평가와 무결성 정규화 시점에 강제된다. 코드에서는 `SLIP_LIMITS`
상수로 같은 값을 얻을 수 있다.

## 4. 양식 본문 (`template` / `templateSnapshot`)

```json
{
  "meta": { "title": "거래명세서", "createdAt": "2026-08-18T09:00:00+09:00" },
  "paper": { "width": 210, "height": 297, "padding": [20, 15, 20, 15] },
  "pages": [ { "elements": [ ... ] } ],
  "assets": [ { "id": "logo", "mimeType": "image/png", "src": "data:image/png;base64,..." } ]
}
```

| 필드 | 필수 | 내용 |
|---|---|---|
| `meta.title` | ✅ | 양식 이름 (비어 있지 않은 문자열) |
| `meta.createdAt` / `meta.updatedAt` | — | ISO 8601 일시 |
| `paper` | ✅ | 용지 크기(mm)와 여백. `padding`은 `[top, right, bottom, left]`. 여백 합은 용지보다 작아야 한다 |
| `pages` | ✅ | 1개 이상의 페이지. 각 페이지는 `elements` 배열 (ADR-011: 페이지는 1급 개념) |
| `assets` | ✅ | 내장 리소스 목록 (빈 배열 가능). `id`는 문서 내 유일 필수 |
| `bindings` | — | 바인딩 정의부 (ADR-032): `{ key, label? }` 배열. **물리명 `key`**는 파일·수식·백엔드 연동에, **논리명 `label`**은 화면 표시에 쓴다. `key`는 목록 안에서 유일. 정의부는 보조 정보이며 요소가 미등록 키를 쓰는 것도 허용된다 |
| `sampleValues` | — | 미리보기용 샘플 값 (ADR-032): 바인딩 물리명 → JSON 값. 발행·무결성 계산과 무관하며 전표 생성 시 복사하지 않는다 |

요소 `id`는 **문서 전체에서 유일**해야 한다(페이지가 달라도 중복 금지).

## 5. 요소 6종 (ADR-020)

모든 요소의 공통 필드:

| 필드 | 필수 | 내용 |
|---|---|---|
| `type` | ✅ | 요소 종류 판별자 (아래 6종) |
| `id` | ✅ | 문서 내 유일 id |
| `name` | ✅ | 디자이너에 표시되는 이름 |
| `position` | ✅ | `{ x, y }` mm, 용지 좌상단 기준. **음수 금지** (x, y ≥ 0) |
| `width` / `height` | ✅ | mm (0 허용 — 예: 수평선의 height) |
| `group` | — | 그룹 식별자 (ADR-032). 같은 값을 가진 요소들을 한 묶음으로 다룬다 |

색 스타일(ADR-020 — `image` 제외 전 요소): `backgroundColor`, `fontColor`,
`borderColor`, `borderWidth`(mm), `borderStyle`(`solid`|`dashed`|`dotted`) — 전부 선택.

`borderStyle`의 렌더 규칙(0.2.0, ADR-032): 파선·점선은 **직선에만** 적용된다 —
선 요소, 사각형(`radius` 미지정), 고정 그리드선. 그 밖(텍스트·필드 테두리, 동적 표,
타원·삼각형)은 `solid`로 그린다. 파선 = 2.4mm 선 + 1.2mm 간격, 점선 = 0.4mm 점 + 0.8mm 간격.

글꼴(텍스트류 — `text`·`field`·고정 그리드 셀): `fontName`, `fontSize`(pt), `alignment`,
`bold`, `underline`, `strikethrough` — 전부 선택 (0.2.0, ADR-032).
`bold`는 유효 폰트(요소 `fontName`, 없으면 대체 폰트)의 `<이름>-Bold` 폰트가 렌더 옵션에
있을 때 그 폰트로 그리며, 없으면 PDF에서 무시된다.

### 5.1 `text` — 텍스트

고정 문구. `content`(필수)에 문구를 담는다. 전표 값 치환·수식은 `field`를 사용한다.

### 5.2 `fixedGrid` — 고정 그리드 표

행 수가 고정된 그리드 틀(공급자 정보란 등). **셀 병합을 지원**한다 (ADR-020).

| 필드 | 필수 | 내용 |
|---|---|---|
| `rows` / `columns` | ✅ | 1 이상의 정수 |
| `columnWidthPercentages` | ✅ | 길이 = `columns`, 합 100 |
| `rowHeightPercentages` | — | 생략 시 행 높이 균등. 지정 시 길이 = `rows`, 합 100 |
| `cells` | ✅ | 셀 배열. 명시하지 않은 좌표는 빈 셀 |

셀: `row`/`column`(0-기반, 필수), `rowSpan`/`colSpan`(기본 1), `content`(필수),
색 스타일·글꼴 필드 선택. 셀(병합 범위 포함)은 그리드를 **벗어나거나 서로 겹치면 안 된다**.

### 5.3 `dynamicTable` — 동적 행 표

데이터 행 수에 따라 늘어나는 표. **자동 페이지 분할 대상**이다 (ADR-011).

| 필드 | 필수 | 내용 |
|---|---|---|
| `columns` | ✅ | 열 정의 배열 (1개 이상, ADR-032): `{ key, title, widthPercentage }`. `key` = 행 객체에서 값을 읽는 물리 키(목록 안 유일), `title` = 머리행 표시 제목, `widthPercentage` 합 100 |
| `repeatHead` | ✅ | 페이지 분할 시 머리행 반복 여부 |
| `binding` | ✅ | 전표 `values`에서 행 배열을 담는 키 |

`height`는 첫 페이지에서 표가 차지할 수 있는 최대 높이이며, 넘치는 행은
다음 페이지로 자동 분할된다. 동적 행 표의 셀 병합은 v1에서 지원하지 않는다 (ADR-020).

렌더 시 행 데이터는 `values[binding]`의 각 객체에서 **각 열의 `key`로** 읽는다.
예: `columns`의 key가 `["item", "amount"]`이면 행 객체 `{ "item": "노트", "amount": 3000 }`을
기대한다. 제목(`title`)을 바꿔도 데이터·수식은 깨지지 않는다.
(0.1.x의 `head`/`headWidthPercentages`는 마이그레이션 시 `key = title = 옛 제목`인
`columns`로 변환된다 — 기존 전표 값과 그대로 호환.)

### 5.4 `image` — 이미지

`src`(필수, §3.1의 3형식). 색 스타일 필드는 없다.
PDF 렌더 시 외부 URL 참조는 거부된다 — 렌더하려면 `data:` 또는 `asset://`로
내장되어 있어야 한다 (ADR-014와 같은 원칙).

### 5.5 `shape` — 선/사각형/타원/삼각형

`shape`(필수): `line` | `rect` | `ellipse` | `triangle` (0.2.0에서 타원·삼각형 추가, ADR-032).
선의 두께·색은 `borderWidth`/`borderColor`로 지정한다.

| 필드 | 필수 | 내용 |
|---|---|---|
| `lineDirection` | — | 선 전용 (기본 `horizontal`): `horizontal`(상자 세로 중앙의 수평선) | `vertical`(가로 중앙의 수직선) | `down`(좌상→우하 대각선) | `up`(좌하→우상 대각선). 임의 선분은 상자(position·width·height)와 방향으로 표현한다 |
| `radius` | — | 사각형 전용 모서리 반경(mm). 파선·점선 테두리와 동시 지정 금지(곡선 구간은 분해 렌더 불가) |

타원·삼각형은 상자에 내접해 그린다. 삼각형은 위 꼭짓점·아래 밑변 고정이다.
타원·삼각형의 테두리는 `solid`로만 그려진다 (`borderStyle` 렌더 규칙 참조).

### 5.6 `field` — 입력 필드

전표 작성 시 값이 채워지는 자리.

| 필드 | 필수 | 내용 |
|---|---|---|
| `binding` | ✅ | 전표 `values`의 키 |
| `formula` | — | 표시 전 가공 수식 (ADR-010/017). 예: `FORMAT_NUMBER(SUM(items.금액))` |

수식 문법·함수 목록(29종)은 ADR-017을 따르며 별도 문서로 상세화한다.
수식 길이·중첩 깊이는 §3.2 상한을 따른다 (초과 시 파싱 단계에서 거부).

## 6. 양식 파일 (`kind: "template"`)

```json
{ "schemaVersion": "0.2.0", "kind": "template", "template": { ...양식 본문(§4)... } }
```

## 7. 전표 파일 (`kind: "voucher"`)

```json
{
  "schemaVersion": "0.2.0",
  "kind": "voucher",
  "templateSnapshot": { ...양식 본문(§4)... },
  "values": { "total": 3000, "items": [ { "품명": "노트", "금액": 3000 } ] },
  "issued": true,
  "integrity": { "contentHash": "<sha-256 hex>", "signature": "<JWS>" }
}
```

| 필드 | 필수 | 내용 |
|---|---|---|
| `templateSnapshot` | ✅ | **생성 시점 양식 전체의 복사본** (ADR-008). 이후 원본 양식이 바뀌어도 전표는 불변 |
| `values` | ✅ | 바인딩 키 → 값(JSON 값). `dynamicTable.binding` 키에는 객체 배열을 담는다 |
| `issued` | ✅ | 발행(확정) 여부 |
| `integrity` | 발행 시 ✅ | §8 무결성 정보 |

### 7.1 발행(issued) 규칙

`issued: true`인 파일은:

1. `integrity.contentHash`가 **필수**다 (ADR-019).
2. `templateSnapshot` 안의 어떤 `src`도 **외부 URL이면 안 된다** — 발행 시점에
   base64(`data:`) 또는 `asset://` 내장 리소스로 변환해야 한다 (ADR-014, 파일 단독 완결).
3. 발행된 전표의 내용은 이후 **수정하면 안 된다**(수정은 해시 검증 실패로 탐지된다).

`issued: false`(작성 중)인 파일은 외부 URL 참조와 `integrity` 생략이 허용된다.

## 8. 무결성 (ADR-019)

> 이 절이 규범이며, 계산 구현은 `@omdc-slipkit/core`의 integrity 모듈에서 제공된다
> (로드맵 `feat/core-integrity`).

### 8.1 정규화 (canonicalization)

해시·서명 계산 전에 문서를 **RFC 8785 (JSON Canonicalization Scheme, JCS)** 로
정규화한다 — 같은 내용이면 항상 같은 바이트가 되도록(키 정렬, 수 표현, UTF-8).

### 8.2 contentHash (필수)

- 대상: **`integrity` 필드를 제거한 문서 전체** (봉투 + `templateSnapshot` + `values` + `issued`).
  스냅샷을 포함하므로 스냅샷 위조도 탐지된다 (ADR-019).
- 계산: 대상을 JCS 정규화한 UTF-8 바이트의 **SHA-256**, 소문자 hex 64자.
- 키 없이도 훼손·변조를 탐지할 수 있는 기본 무결성 계층이다.

### 8.3 signature (선택)

- 호스트가 키를 제공하면 **JWS(ES256), compact serialization**으로 발행자를 증명한다.
- JWS 페이로드: `contentHash`의 hex 문자열(UTF-8 바이트).
- 서명 키 관리·서명 주체는 호스트 책임이다 (ADR-004 권한 위임 원칙에 부합 — 통상 호스트 서버가 서명).

### 8.4 암호화 (선택, ADR-009)

파일 내용 암호화는 옵션이며 키 관리는 호스트 책임이다. 암호화된 파일은
표준 교환성이 제한된다. 상세 방식은 추후 부록으로 확정한다.

## 9. 검증 수준

1. **구조 검증**: 동봉 JSON Schema(§10)로 언어 무관 기계 검증.
2. **교차 규칙 검증**: JSON Schema로 표현되지 않는 교차 필드 규칙 — 비율 합 100,
   그리드 셀 범위·겹침, `asset://` 참조 해소, 요소/에셋 id 유일성, §7.1 발행 규칙.
   레퍼런스 구현(`parseSlipFile`)이 기준이다.
3. **무결성 검증**: §8 해시·서명 확인.

## 10. JSON Schema 동봉 (ADR-022)

`@omdc-slipkit/core` 패키지의 `schemas/` 디렉터리에 Zod 스키마에서 산출한
JSON Schema(draft 2020-12)를 동봉한다:

- `schemas/slip-<schemaVersion>.schema.json` — 버전별
- `schemas/slip.schema.json` — 최신 별칭
- `$id`: `urn:slipkit:schema:slip:<schemaVersion>`

코드에서는 `slipFileJsonSchema()`로 같은 것을 얻을 수 있다.
재생성: `pnpm --filter @omdc-slipkit/core build && pnpm --filter @omdc-slipkit/core generate:schemas`.

## 11. 확장 예약 (비규범)

- **ZIP 컨테이너** (ADR-007): 대용량 리소스가 필요해지면 현재 JSON을 manifest로 하는
  ZIP 컨테이너를 추가한다. `asset://` 참조가 그대로 컨테이너 내 파일을 가리키게 되며
  스키마 변경은 없어야 한다.
- **동적 행 표 셀 병합, 요소 그룹화** 등은 v2 (ADR-020).
