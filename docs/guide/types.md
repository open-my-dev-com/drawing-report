# 주요 타입 참조

[English](types.en.md)

호스트 앱에서 다루게 되는 주요 타입의 필드와 기본값을 정리한다.
전체 스키마 상세는 [SPEC.md](../SPEC.md)를 참고한다.

---

## SlipFile

`.slip` 파일의 최상위 타입. `kind`로 양식(template)과 전표(voucher)를 구분한다.

```ts
import type { SlipFile } from '@omdc-slipkit/core';
```

### 양식 (template)

| 필드 | 타입 | 설명 |
|---|---|---|
| `schemaVersion` | `string` | 스키마 버전 (semver) |
| `kind` | `'template'` | 파일 종류 |
| `template` | 객체 | 양식 본문 (아래 참조) |

양식 본문(`template`):

| 필드 | 타입 | 설명 |
|---|---|---|
| `meta` | `{ title, createdAt?, updatedAt? }` | 양식 메타정보 |
| `paper` | `PaperSize` | 용지 크기·여백 (단위: mm) |
| `pages` | `SlipPage[]` | 페이지 배열 (최소 1) |
| `assets` | `AssetEntry[]` | 내장 리소스 (이미지 등) |
| `bindings?` | `BindingDef[]` | 바인딩 정의부 — 물리명(`key`)과 논리명(`label`) |
| `sampleValues?` | `Record<string, JsonValue>` | 미리보기용 샘플 값 (발행에는 미포함) |

### 전표 (voucher)

| 필드 | 타입 | 설명 |
|---|---|---|
| `schemaVersion` | `string` | 스키마 버전 |
| `kind` | `'voucher'` | 파일 종류 |
| `templateSnapshot` | 양식 본문과 동일 | 생성 시점 양식 전체 스냅샷 |
| `values` | `Record<string, JsonValue>` | 바인딩 키 → 채운 값 |
| `issued` | `boolean` | 발행 완료 여부 |
| `integrity?` | `Integrity` | 해시·서명 기록 (발행 시 필수) |

---

## Font

PDF 렌더링과 미리보기에 쓰는 폰트 객체. `RenderOptions.fonts`와 컴포넌트의 `fonts` 속성이
이 배열을 받는다.

```ts
{ name: string; data: Uint8Array; fallback?: boolean }
```

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 폰트 이름 (양식에서 지정한 이름과 매칭) |
| `data` | `Uint8Array` | — | 폰트 파일 바이트 (OTF/TTF) |
| `fallback` | `boolean` | `false` | `true`이면 대체 폰트로 사용 (하나만 지정 가능). 아무것도 지정하지 않으면 첫 번째 폰트를 대체 폰트로 쓴다 |

**미지정 시**: 컴포넌트(`<slip-designer>`, `<slip-form>`, `<slip-viewer>`)에 `fonts`를
지정하지 않으면 동봉 Pretendard(Regular + Bold)를 자동으로 불러온다.
상세는 [동봉 폰트·프리셋](fonts-and-presets.md)을 참고한다.

---

## SlipPreset

디자이너 프리셋 메뉴에 쓸 양식 템플릿.
`<slip-designer>`의 `presets` 속성에 배열로 전달하면 동봉 프리셋 대신 표시된다.

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | `string` | 고유 식별자 |
| `name` | `string` | 프리셋 메뉴에 보이는 이름 |
| `create` | `() => SlipTemplateFile` | 호출하면 양식 파일을 새로 만들어 돌려준다 |

**미지정 시**: `presets`를 지정하지 않으면 동봉 프리셋 2종(거래명세서, 청구서)이
메뉴에 나온다. 동봉 프리셋의 내용은 한국어로 되어 있다.

---

## StorageAdapter

"내 양식 저장·불러오기" 기능에 쓸 저장소 인터페이스.
`<slip-designer>`의 `storage` 속성에 전달하면 저장·목록 버튼이 나타난다.

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';
```

| 메서드 | 시그니처 | 설명 |
|---|---|---|
| `save` | `(id: string, file: SlipFile) => Promise<void>` | 파일 저장 (같은 id면 덮어쓰기) |
| `load` | `(id: string) => Promise<SlipFile>` | 파일 불러오기 |
| `delete` | `(id: string) => Promise<void>` | 파일 삭제 |
| `list` | `(filter?: SlipListFilter, cursor?: string) => Promise<SlipListPage>` | 목록 조회 (페이징) |

오류는 `SlipStorageError`를 던지며, `code`로 원인을 구분한다:

| code | 의미 |
|---|---|
| `'not-found'` | 해당 id의 파일이 없다 |
| `'unsupported'` | 이 어댑터가 지원하지 않는 동작이다 |
| `'io'` | 저장소 입출력 실패 |

**미지정 시**: `storage`를 지정하지 않으면 디자이너에 저장·목록 버튼이 나타나지 않는다.

### 동봉 구현

| 클래스 | import | 저장 매체 |
|---|---|---|
| `IndexedDbStorage` | `@omdc-slipkit/elements` | 브라우저 IndexedDB. 제목·종류 필터, 커서 페이징 지원 |
| `LocalFileStorage` | `@omdc-slipkit/elements` | 저장은 파일 다운로드, 불러오기는 파일 선택 대화 상자. `delete`·`list`는 `unsupported` |

---

## IntegrityJwk

무결성 서명·검증에 쓰는 EC P-256 키(JWK 형식).

```ts
import type { IntegrityJwk } from '@omdc-slipkit/core';
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `kty` | `string` | 키 타입 (`'EC'`) |
| `crv` | `string` | 곡선 (`'P-256'`) |
| `x` | `string` | 공개키 x 좌표 (base64url) |
| `y` | `string` | 공개키 y 좌표 (base64url) |
| `d` | `string` | 개인키 (base64url) — 서명에만 필요, 검증에는 불필요 |
| `kid` | `string` | 키 식별자 (선택) |

키쌍을 직접 만들려면:

```ts
import { generateSigningKeyPair } from '@omdc-slipkit/core';

const { privateKey, publicKey } = await generateSigningKeyPair();
```

**미지정 시**: `<slip-form>`에 `signingKey`를 지정하지 않으면 발행 시 해시(SHA-256)만 기록하고
서명은 하지 않는다.

---

## RenderOptions

`renderSlipToPdf`와 `createPdfRenderer`에 전달하는 PDF 렌더링 옵션.

```ts
import type { RenderOptions } from '@omdc-slipkit/core';
```

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `fonts` | `Font[]` | — | PDF에 쓸 폰트 목록. 한글 문서는 필수 |
| `locale` | `string` | `'ko-KR'` | 수식 포맷 함수의 로케일 (BCP-47). 숫자 자릿수 구분 등에 영향 |
