# 동봉 폰트·프리셋

[English](fonts-and-presets.en.md)

SlipKit이 동봉하는 폰트와 프리셋의 상세, 그리고 언어 설정에 따른 동작을 설명합니다.

---

## 동봉 폰트: Pretendard

SlipKit은 **Pretendard Regular**과 **Pretendard Bold** 두 가지를 동봉합니다.

| 항목 | 내용 |
|---|---|
| 서체 | Pretendard |
| 두께 | Regular (기본), Bold |
| 형식 | OTF |
| 라이선스 | SIL Open Font License 1.1 |
| 크기 | 합계 약 3 MB (base64 인코딩 포함) |

### 자동 로드

컴포넌트(`<slip-designer>`, `<slip-form>`, `<slip-viewer>`)에 `fonts` 속성을 **지정하지 않으면**
Pretendard를 자동으로 불러옵니다. 한글이 깨지지 않도록 Regular에 `fallback: true`가 설정되어 있습니다.

로드는 필요한 시점에 한 번만 일어납니다 — 컴포넌트가 처음 렌더링될 때 비동기로 가져옵니다.

### 직접 사용

동봉 폰트를 명시적으로 가져와 사용자 폰트와 함께 쓸 수도 있습니다.

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';

// 동봉 폰트만 쓸 때
designer.fonts = pretendardFonts;

// 사용자 폰트를 추가할 때
designer.fonts = [
  ...pretendardFonts,
  { name: 'NotoSans', data: notoSansBuffer },
];
```

`fonts` 속성을 지정하면 자동 로드가 일어나지 않으므로, 한글이 필요하면 `pretendardFonts`를
배열에 포함해야 합니다.

---

## 동봉 프리셋

디자이너에 프리셋 2종이 동봉되어 있습니다.

| 프리셋 | 구성 |
|---|---|
| **거래명세서** | 공급자·공급받는 자 정보(등록번호·상호·주소 등), 품목 표(품명·규격·수량·단가·금액), 합계 수식 |
| **청구서** | 청구 정보, 금액 내역 표, 합계·부가세 수식 |

### 프리셋과 언어

프리셋 메뉴의 **이름**(거래명세서, 청구서)은 `locale`에 따라 번역됩니다 —
영어로 전환하면 "Transaction statement", "Invoice"로 표시됩니다.

하지만 프리셋의 **내용**(셀 텍스트, 바인딩 논리명, 열 제목 등)은 한국어 고정입니다.
예를 들어 거래명세서 프리셋을 선택하면 `locale="en"`이어도 셀에 "등록번호", "상호"가 적혀 있습니다.

영문 양식이 필요하면 `presets` 속성에 직접 만든 프리셋을 전달해 주세요.

### 직접 프리셋 만들기

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

const myPresets: SlipPreset[] = [
  {
    id: 'my-invoice',
    name: 'Invoice',
    create: (): SlipTemplateFile => ({
      schemaVersion: '0.2.0',
      kind: 'template',
      template: {
        meta: { title: 'Invoice' },
        paper: { width: 210, height: 297, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
        pages: [{ elements: [] }],
        assets: [],
      },
    }),
  },
];
```

```html
<slip-designer .presets=${myPresets}></slip-designer>
```

`presets`를 지정하면 동봉 프리셋 대신 전달한 목록이 메뉴에 나타납니다.
