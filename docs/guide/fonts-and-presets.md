# 동봉 폰트·프리셋

[English](fonts-and-presets.en.md) · [日本語](fonts-and-presets.ja.md)

SlipKit이 동봉하는 폰트와 프리셋의 상세, 폰트를 호스트가 공급하는 방법, 그리고 언어 설정에 따른
동작을 설명합니다.

---

## 폰트 공급: `settings.getFonts` (ADR-040)

렌더 폰트는 호스트가 **공급 인터페이스**로 넘깁니다. 컴포넌트(`<slip-designer>`, `<slip-form>`,
`<slip-viewer>`)의 `settings` 속성에 `getFonts`를 구현한 객체를 주면, 미리보기·PDF가 그 폰트로
렌더됩니다. 폰트를 어디에 두는지(번들·서버 폴더 등)는 호스트가 정하므로, 라이브러리는 값을 돌려받는
pull 방식으로만 받습니다.

```ts
import type { SlipFontProvider } from '@omdc-slipkit/elements';

const settings: SlipFontProvider = {
  // 동기 배열도, 서버에서 가져오는 Promise도 됩니다.
  getFonts: () => [
    { name: 'MyFont', data: myFontBuffer },
    { name: 'MyFont-Bold', data: myFontBoldBuffer },
  ],
};

designer.settings = settings;
```

| 항목 | 형 | 설명 |
|---|---|---|
| `getFonts?` | `() => SlipFont[] \| Promise<SlipFont[]>` | 렌더에 쓸 폰트 목록. 비었거나 주지 않으면 동봉 기본 폰트를 씁니다 |

`SlipFont`는 core `RenderOptions.fonts`의 원소와 같습니다(`{ name, data, fallback? }`).

> 디자이너는 `settings`에 용지 목록 공급·저장(`getPaperSizes`/`savePaperSize`)이 더해진
> `SlipDesignerSettings`를 받습니다 — 자세한 내용은 [사용 가이드](README.md)의 용지 설정을 참고해 주세요.

---

## 동봉 기본 폰트

`settings.getFonts`로 폰트를 **주지 않으면**, 컴포넌트는 `locale`에 맞는 동봉 기본 폰트를 자동으로
불러옵니다. 각 언어로 바로 렌더되도록 언어마다 기본 폰트 1종을 담았습니다.

| 언어(`locale`) | 기본 폰트 | 두께 | 형식 | 크기(대략) |
|---|---|---|---|---|
| `ko`(기본) · `en` | Pretendard | Regular · Bold | OTF | 약 3 MB |
| `ja` | Noto Sans JP | Regular | TTF(서브셋) | 약 4.8 MB |

- Regular에 `fallback: true`가 설정되어, 다른 폰트에 없는 글자를 이 폰트가 그립니다.
- 로드는 필요한 시점에 한 번만 일어나며(비동기), 언어별로 재사용됩니다.
- 폰트 데이터는 **서브패스**로 격리되어 동적 import되므로, 해당 언어를 쓰지 않는 호스트의 번들에는
  들어가지 않습니다.
- 라이선스: Pretendard는 SIL Open Font License 1.1(`OFL-Pretendard.txt`), Noto Sans JP도
  SIL Open Font License 1.1(`OFL-NotoSansJP.txt`).

### 일본어 폰트의 범위 (ADR-042)

동봉 Noto Sans JP는 **Regular 한 두께**이며, 일본어 상용 글자(가나·상용 한자·라틴·전각/반각)로
줄인 서브셋입니다. **굵게(Bold)나 서브셋 밖의 글자**가 필요하면 `settings.getFonts`로 폰트를
공급해 주세요 — 동봉은 "기본 하나", 확장은 공급 인터페이스로 나눕니다.

### 직접 사용

동봉 폰트를 명시적으로 가져와 사용자 폰트와 함께 쓸 수도 있습니다.

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';
import notoSansJpFonts from '@omdc-slipkit/elements/fonts/noto-sans-jp';

designer.settings = {
  getFonts: () => [
    ...pretendardFonts,
    ...notoSansJpFonts,
    { name: 'MyFont', data: myFontBuffer },
  ],
};
```

`getFonts`가 목록을 돌려주면 동봉 자동 로드는 일어나지 않으므로, 필요한 동봉 폰트는 배열에
직접 포함해야 합니다.

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

하지만 프리셋의 **내용**(셀 텍스트, 파라미터 논리명, 열 제목 등)은 한국어 고정입니다.
예를 들어 거래명세서 프리셋을 선택하면 `locale="en"`이나 `locale="ja"`여도 셀에 "등록번호",
"상호"가 적혀 있습니다.

영문·일문 양식이 필요하면 `presets` 속성에 직접 만든 프리셋을 전달해 주세요.

### 직접 프리셋 만들기

```ts
import type { SlipPreset } from '@omdc-slipkit/elements';
import type { SlipTemplateFile } from '@omdc-slipkit/core';

const myPresets: SlipPreset[] = [
  {
    id: 'my-invoice',
    name: 'Invoice',
    create: (): SlipTemplateFile => ({
      schemaVersion: '0.1.0',
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
