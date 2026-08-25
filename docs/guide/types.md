# 주요 타입 참조

[English](types.en.md) · [日本語](types.ja.md)

호스트 앱에서 다루게 되는 주요 타입의 필드와 기본값을 정리했습니다.
전체 스키마 상세는 [SPEC.md](../SPEC.md)를 참고해 주세요.

---

## 컴포넌트 설정 한눈에

호스트가 세 컴포넌트에 주입하는 설정을 한자리에 모았습니다. ●는 그 컴포넌트가 받는 설정입니다.

| 설정(속성) | `<slip-designer>` | `<slip-form>` | `<slip-viewer>` | 타입 | 안 주면 |
|---|:---:|:---:|:---:|---|---|
| `src` | ● | ● | ● | `string` (HTML 속성) | 빈 화면 |
| `locale` | ● | ● | ● | `'ko' \| 'en' \| 'ja'` (HTML 속성) | 한국어 |
| `settings` | ● | ● | ● | JS 프로퍼티 ([아래](#컴포넌트-설정--settings-adr-040)) | 동봉 폰트·용지 |
| `presets` | ● | — | — | `SlipPreset[]` (JS 프로퍼티) | 동봉 프리셋 2종 |
| `storage` | ● | — | — | `StorageAdapter` (JS 프로퍼티) | 저장·목록 버튼 숨김 |
| `maxImageBytes` | ● | ● | — | `number` (속성 `max-image-bytes`) | 2MB |

- **HTML 속성 vs JS 프로퍼티**: `src`·`locale`·`max-image-bytes`는 HTML 속성으로도 주지만,
  `settings`·`presets`·`storage`는 객체·함수라 **JS 프로퍼티로만** 넘깁니다(`el.storage = ...`).
- `settings`는 컴포넌트마다 모양이 다릅니다 — 디자이너는 폰트+바코드+용지(`SlipDesignerSettings`),
  작성폼·뷰어는 폰트만(`SlipFontProvider`). [상세](#컴포넌트-설정--settings-adr-040).
- 저장소에 거는 **암호화**는 컴포넌트가 아니라 어댑터 생성 옵션입니다 → [저장 시 암호화](#저장-시-암호화-선택-adr-055).

각 설정 타입의 상세는 아래 절에 있습니다: [settings](#컴포넌트-설정--settings-adr-040) ·
[SlipPreset](#slippreset) · [StorageAdapter](#storageadapter) · [Font](#font) · [RenderOptions](#renderoptions).

---

## 컴포넌트 설정 — settings (ADR-040)

컴포넌트의 `settings` 프로퍼티로 호스트가 렌더 폰트 등 자원을 공급합니다. 작성폼·뷰어는 폰트만
(`SlipFontProvider`), 디자이너는 여기에 바코드·용지를 더합니다(`SlipDesignerSettings`).

```ts
import type { SlipFontProvider, SlipDesignerSettings } from '@omdc-slipkit/elements';

interface SlipFontProvider {
  getFonts?(): SlipFont[] | Promise<SlipFont[]>;   // 렌더 폰트 (없으면 동봉 기본)
}

interface SlipDesignerSettings extends SlipFontProvider {
  getBarcodeKinds?(): BarcodeKind[] | Promise<BarcodeKind[]>;  // 바코드 고르개 후보 (없으면 12종 전부)
  getPaperSizes?():   PaperSize[]  | Promise<PaperSize[]>;     // 용지 고르개에 더할 목록 (동봉 4종 뒤에)
  savePaperSize?(size: PaperSize): void | Promise<void>;       // 사용자가 직접 만든 용지를 호스트가 보관
}
```

| 메서드 | 컴포넌트 | 안 주면 |
|---|---|---|
| `getFonts` | 디자이너·작성폼·뷰어 | `locale`에 맞는 동봉 폰트 |
| `getBarcodeKinds` | 디자이너 | 엔진이 그릴 수 있는 12종 전부 |
| `getPaperSizes` | 디자이너 | 동봉 용지 4종만 |
| `savePaperSize` | 디자이너 | 직접 입력 용지를 보관하지 않음 |

- 전부 **선택**이며 동기 배열·비동기(`Promise`) 둘 다 됩니다 — 서버 폴더에서 폰트를 받아도 됩니다.
- `settings`는 HTML 속성이 아니라 **JS 프로퍼티**로만 넘깁니다(`el.settings = { getFonts }`).
- `PaperSize`는 화면 고르개용 프리셋입니다(`{ name, width, height }`, 단위 mm) — `.slip`엔 늘 실제
  너비·높이만 담겨 파일 포맷과 무관합니다.

---

## SlipFile

`.slip` 파일의 최상위 타입입니다. `kind`로 양식(template)과 전표(voucher)를 구분합니다.

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
| `parameters?` | `ParameterDef[]` | 파라미터 정의부 — 물리명(`key`)·논리명(`label`)·값 종류(`valueType`)·하위 필드(`fields`, 목록 종류만) |
| `sampleValues?` | `Record<string, JsonValue>` | 미리보기용 샘플 값 (발행에는 미포함) |

### 전표 (voucher)

| 필드 | 타입 | 설명 |
|---|---|---|
| `schemaVersion` | `string` | 스키마 버전 |
| `kind` | `'voucher'` | 파일 종류 |
| `templateSnapshot` | 양식 본문과 동일 | 생성 시점 양식 전체 스냅샷 |
| `values` | `Record<string, JsonValue>` | 파라미터 키 → 채운 값 |
| `issued` | `boolean` | 발행 완료 여부 |

---

## Font

PDF 렌더링과 미리보기에 쓰는 폰트 객체입니다. core `RenderOptions.fonts`와 컴포넌트의
`settings.getFonts`(ADR-040)가 이 배열을 받습니다.

```ts
{ name: string; data: Uint8Array; fallback?: boolean }
```

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | `string` | — | 폰트 이름 (양식에서 지정한 이름과 매칭) |
| `data` | `Uint8Array` | — | 폰트 파일 바이트 (OTF/TTF) |
| `fallback` | `boolean` | `false` | `true`이면 대체 폰트로 사용 (하나만 지정 가능). 아무것도 지정하지 않으면 첫 번째 폰트를 대체 폰트로 씁니다 |

**미지정 시**: 컴포넌트(`<slip-designer>`, `<slip-form>`, `<slip-viewer>`)에 `settings`를
지정하지 않으면 `locale`에 맞는 동봉 폰트를 자동으로 불러옵니다(한국어·영어 Pretendard,
일본어 Noto Sans JP). 상세는 [동봉 폰트·프리셋](fonts-and-presets.md)을 참고해 주세요.

---

## SlipPreset

디자이너 프리셋 메뉴에 쓸 양식 템플릿입니다.
`<slip-designer>`의 `presets` 속성에 배열로 전달하면 동봉 프리셋 대신 표시됩니다.

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | `string` | 고유 식별자 |
| `name` | `string` | 프리셋 메뉴에 보이는 이름 |
| `create` | `() => SlipTemplateFile` | 호출하면 양식 파일을 새로 만들어 돌려줍니다 |

**미지정 시**: `presets`를 지정하지 않으면 동봉 프리셋 2종(거래명세서, 청구서)이
메뉴에 나옵니다. 동봉 프리셋의 내용은 한국어로 되어 있습니다.

---

## StorageAdapter

"내 양식 저장·불러오기" 기능에 쓸 저장소 인터페이스입니다.
`<slip-designer>`의 `storage` 속성에 전달하면 저장·목록 버튼이 나타납니다.

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';
```

| 메서드 | 시그니처 | 설명 |
|---|---|---|
| `save` | `(id: string, file: SlipFile) => Promise<void>` | 파일 저장 (같은 id면 덮어쓰기) |
| `load` | `(id: string) => Promise<SlipFile>` | 파일 불러오기 |
| `delete` | `(id: string) => Promise<void>` | 파일 삭제 |
| `list` | `(filter?: SlipListFilter, cursor?: string) => Promise<SlipListPage>` | 목록 조회 (페이징) |

오류는 `SlipStorageError`를 던지며, `code`로 원인을 구분합니다:

| code | 의미 |
|---|---|
| `'not-found'` | 해당 id의 파일이 없음 |
| `'unsupported'` | 이 어댑터가 지원하지 않는 동작 |
| `'io'` | 저장소 입출력 실패 |

**미지정 시**: `storage`를 지정하지 않으면 디자이너에 저장·목록 버튼이 나타나지 않습니다.

### 동봉 구현

| 클래스 | import | 저장 매체 |
|---|---|---|
| `IndexedDbStorage` | `@omdc-slipkit/elements` | 브라우저 IndexedDB. 제목·종류 필터, 커서 페이징 지원 |
| `LocalFileStorage` | `@omdc-slipkit/elements` | 저장은 파일 다운로드, 불러오기는 파일 선택 대화 상자. `delete`·`list`는 `unsupported` |

### 저장 시 암호화 (선택, ADR-055)

동봉 어댑터 2종은 생성 옵션 `encryption`으로 **저장할 때 자동으로 암호화**할 수 있습니다.
켜 두면 저장 시 core의 암호화(AES-256-GCM)로 `.slip` 내용을 잠그고, 불러올 때 자동으로 풉니다.

```ts
interface StorageEncryption {
  enabled: boolean;                        // 저장 시 암호화 여부 (false·생략이면 평문)
  key?: string | Uint8Array;               // 잠글 키 — 암호 또는 32바이트 원시 키 (없으면 샘플 기본키)
  previousKeys?: (string | Uint8Array)[];  // 불러올 때 추가로 시도할 예전 키들 (키 회전 대비)
}
```

```ts
import { IndexedDbStorage, type StorageEncryption } from '@omdc-slipkit/elements';

// 생성 옵션의 encryption에 넘긴다 — LocalFileStorage도 동일
const storage = new IndexedDbStorage({
  encryption: { enabled: true, key: hostKey },   // 호스트가 공급하는 암호/원시 키
});
```

| 필드 | 값 | 동작 |
|---|---|---|
| `enabled` | `boolean` | `true`면 저장 시 암호화, `false`(또는 설정 생략)면 평문 저장 |
| `key` | `string \| Uint8Array` (선택) | 저장 시 잠글 키 — 암호(passphrase) 또는 32바이트 원시 키 |
| `previousKeys` | `(string \| Uint8Array)[]` (선택) | 불러올 때 추가로 시도할 예전 키들 — 키 변경(회전) 대비 |

- `enabled: true`인데 `key`가 없으면 **데모용 샘플 기본키**(`SAMPLE_ENCRYPTION_KEY`)로 잠급니다.
  이 키는 코드에 박혀 있어 **실보안이 아닙니다** — 실제로 보호하려면 호스트가 `key`를 반드시 주세요.
- **불러오기는 설정과 무관하게** 암호화 파일을 자동 감지해 풉니다 — 옛 평문 저장분도 그대로 읽힙니다.
- `IndexedDbStorage`는 본문만 잠그고 목록 조회용 제목은 평문으로 둡니다(목록에 제목이 보이도록).
  민감한 내용은 본문 안(파라미터·직접 입력·이미지)이라 잠깁니다.
- 키 관리는 호스트 책임입니다(ADR-054). core 단독 사용 시의 암호화는 [Core 가이드 §7](core.md#7-파일-암호화-선택)을 보세요.

**중간에 켜기·키 바꾸기**

- **암호화 안 하다가 켜기**: `enabled`를 `true`로 바꾸면 그 뒤 저장분부터 잠깁니다. 이미 평문으로
  저장돼 있던 파일은 자동으로 잠기지 않고, 열었다가 **다시 저장할 때** 잠깁니다.
- **키 바꾸기(회전)**: 새 키를 `key`에, 옛 키를 `previousKeys`에 두세요. 불러올 때 현재 키가 안 맞으면
  예전 키들을 차례로 시도하므로 옛 파일도 열리고, 그 파일을 **다시 저장하면 새 키로 옮겨집니다.**
- **암호화 끄기**: `enabled: false`로 바꿔도 이미 잠긴 파일은 봉투로 남아 있습니다 — `key`(·`previousKeys`)를
  남겨 두면 계속 읽을 수 있고, 새 저장분만 평문이 됩니다.

---

## RenderOptions

`renderSlipToPdf`와 `createPdfRenderer`에 전달하는 PDF 렌더링 옵션입니다.

```ts
import type { RenderOptions } from '@omdc-slipkit/core';
```

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `fonts` | `Font[]` | — | PDF에 쓸 폰트 목록. 한글·일본어 문서는 필수 |
| `getFonts` | `() => Font[] \| Promise<Font[]>` | — | 폰트를 비동기로 공급하는 함수(서버 폴더 등). 주면 `fonts`보다 우선 (ADR-040) |
| `locale` | `string` | `'ko-KR'` | 수식 포맷 함수의 로케일 (BCP-47). 숫자 자릿수 구분 등에 영향 |
