# 환경 설정 가이드

[English](configuration.en.md) · [日本語](configuration.ja.md)

이 문서는 SlipKit의 언어, 폰트, 용지, 바코드, 프리셋, 저장소 및 이미지 제한을 호스트 애플리케이션에 맞게 설정하는 방법을 설명합니다.

설정은 컴포넌트의 기능 자체를 변경하기보다 다음과 같은 애플리케이션별 자원과 정책을 전달하는 데 사용합니다.

- 화면에 표시할 언어
- PDF 렌더링에 사용할 폰트
- 디자이너에서 선택할 용지와 바코드
- 애플리케이션 전용 양식 프리셋
- 디자이너의 “내 양식” 저장소
- 업로드할 수 있는 이미지 크기
- Core의 수식 로케일과 암호화 키

> [!NOTE]
> 컴포넌트 이벤트와 자동 저장 흐름은 [애플리케이션 통합 가이드](integration.md)를, 각 설정 타입의 전체 필드는 [API 참조](api-reference.md)를 확인하세요.
>
> 로컬 MCP 서버의 `slipkit-mcp.json` 설정은 [MCP 사용 가이드](mcp.md)에서 별도로 설명합니다.

## 컴포넌트 설정 한눈에 보기

| 설정 | 디자이너 | 작성 폼 | 뷰어 | 기본 동작 |
|---|:---:|:---:|:---:|---|
| `locale` | ● | ● | ● | `SlipKit` 로케일 또는 영어 UI |
| `slipkit` | ● | ● | ● | 동봉 폰트와 Core 기본 설정 사용 |
| `settings` | ● | — | — | 동봉 바코드 종류와 용지 사용 |
| `presets` | ● | — | — | 동봉 프리셋 2종 사용 |
| `storage` | ● | — | — | “내 양식” 저장·목록 기능 숨김 |
| `maxImageBytes` | ● | ● | — | 이미지 원본 파일 최대 2MB |

`locale`과 `max-image-bytes`는 HTML 속성으로 전달할 수 있습니다.

`slipkit`, `settings`, `presets`, `storage`는 객체나 함수를 포함하므로 JavaScript 프로퍼티 또는 프레임워크의 객체 prop으로 전달해야 합니다.

## 설정 전달 방법

### Web Component

문자열과 숫자는 HTML 속성으로 전달할 수 있습니다.

```html
<slip-designer
  id="designer"
  locale="ko"
  max-image-bytes="2097152"
></slip-designer>
```

객체 설정은 JavaScript 프로퍼티로 전달합니다.

```ts
import '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

import type {
  SlipDesigner,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designer =
  document.querySelector<SlipDesigner>(
    '#designer',
  );

if (!designer) {
  throw new Error(
    'slip-designer 요소를 찾을 수 없습니다.',
  );
}

const slipkit = createSlipKit({
  getFonts: () => appFonts,
  locale: 'ko-KR',
});

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};

designer.slipkit = slipkit;
designer.settings = settings;
designer.presets = appPresets;
designer.storage = templateStorage;
designer.maxImageBytes = 2 * 1024 * 1024;
```

다음과 같이 객체 이름을 HTML 속성 문자열로 작성해도 실제 객체가 전달되지는 않습니다.

```html
<!-- 잘못된 사용 -->
<slip-designer
  settings="settings"
  presets="appPresets"
  storage="templateStorage"
></slip-designer>
```

### React

React 래퍼에서는 일반 컴포넌트 prop으로 전달합니다.

```tsx
import { useMemo } from 'react';

import {
  SlipDesigner,
} from '@omdc-slipkit/react';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

export function DesignerScreen() {
  const settings =
    useMemo<SlipDesignerSettings>(
      () => ({
        getPaperSizes: () => appPaperSizes,
      }),
      [],
    );

  return (
    <SlipDesigner
      src={designerSrc}
      locale="ko"
      slipkit={slipkit}
      settings={settings}
      presets={appPresets}
      storage={templateStorage}
      maxImageBytes={2 * 1024 * 1024}
      onSlipChange={handleSlipChange}
    />
  );
}
```

> [!TIP]
> 렌더링할 때마다 `slipkit`, `settings`, `presets`, `storage` 객체를 새로 만들지 마세요.
> React에서는 모듈 범위에 선언하거나 `useMemo`를 사용하여 같은 객체를 유지하는 편이 좋습니다.

### Vue

Vue 래퍼에서도 객체 prop으로 전달합니다.

```vue
<script setup lang="ts">
import {
  SlipDesigner,
} from '@omdc-slipkit/vue';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const settings: SlipDesignerSettings = {
  getPaperSizes: () => appPaperSizes,
};
</script>

<template>
  <SlipDesigner
    :src="designerSrc"
    locale="ko"
    :slipkit="slipkit"
    :settings="settings"
    :presets="appPresets"
    :storage="templateStorage"
    :max-image-bytes="2 * 1024 * 1024"
    @slip-change="handleSlipChange"
  />
</template>
```

## UI 언어 설정

세 UI 컴포넌트는 `locale`을 지원합니다.

| 값 | 언어 | 기본 폰트 |
|---|---|---|
| `ko` | 한국어 | Pretendard Regular·Bold |
| `en` | 영어 | Pretendard Regular·Bold |
| `ja` | 일본어 | Noto Sans JP Regular |

`locale`을 생략하면 `SlipKit.locale`의 언어를 사용합니다. `slipkit`도 없거나 지원하지 않는 `locale`을 명시하면 영어를 사용합니다.

`en-US`, `ko-KR`, `ja-JP`처럼 지역 코드가 포함된 값도 사용할 수 있습니다. 이 경우 앞부분의 언어 코드로 UI 언어를 선택합니다.

```html
<slip-designer locale="ja"></slip-designer>
<slip-form locale="ja-JP"></slip-form>
<slip-viewer locale="en-US"></slip-viewer>
```

`locale`은 다음 항목에 영향을 줍니다.

- 컴포넌트 버튼과 안내 문구
- 오류 메시지
- `slipkit`을 지정하지 않았을 때 사용하는 동봉 기본 폰트

다음 항목은 자동으로 번역하지 않습니다.

- 양식 안에 직접 입력한 텍스트
- 파라미터의 논리명
- 외부에서 받은 `.slip` 파일의 내용
- 애플리케이션이 공급한 프리셋 이름과 내용

> [!IMPORTANT]
> 동봉된 거래명세서와 청구서 프리셋은 **적용 시점의 `locale`에 해당하는 언어**로 제목·표 항목·문구가 만들어집니다.
> 이미 만들어진 양식은 이후 `locale`을 바꿔도 자동으로 번역되지 않습니다.
> 다른 구성의 양식이 필요하면 직접 작성한 프리셋을 별도로 공급하세요.

## 폰트 설정

### 동봉 기본 폰트

`slipkit`을 지정하지 않으면 UI 컴포넌트가 `locale`에 맞는 기본 폰트를 불러옵니다.

| 언어 | 동봉 폰트 | 구성 |
|---|---|---|
| 한국어·영어 | Pretendard | Regular·Bold |
| 일본어 | Noto Sans JP | Regular 서브셋 |

동봉 폰트는 PDF 렌더링이 필요할 때 지연 로딩되며, 한 번 불러온 뒤에는 같은 언어에서 재사용됩니다.

일본어 기본 폰트는 일반적인 가나, 한자와 라틴 문자를 포함하는 서브셋입니다. 동봉 범위에 없는 글자나 굵은 일본어 폰트가 필요하면 사용자 폰트를 공급해야 합니다.

### 사용자 폰트 공급

사용자 폰트는 `createSlipKit`의 `getFonts`에 한 번 설정하고, 같은 인스턴스를 컴포넌트에 전달합니다.

```ts
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  getFonts: () => [
    {
      name: 'AppFont',
      data: appFontRegular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: appFontBold,
    },
  ],
});

viewer.slipkit = slipkit;
form.slipkit = slipkit;
designer.slipkit = slipkit;
```

`getFonts`는 폰트 배열이나 폰트 배열을 반환하는 `Promise`를 사용할 수 있습니다.

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import type {
  SlipFont,
} from '@omdc-slipkit/core';

async function loadFont(
  url: string,
): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `폰트를 불러오지 못했습니다: ${response.status}`,
    );
  }

  return new Uint8Array(
    await response.arrayBuffer(),
  );
}

async function loadAppFonts(): Promise<SlipFont[]> {
  const [regular, bold] = await Promise.all([
    loadFont('/fonts/AppFont-Regular.otf'),
    loadFont('/fonts/AppFont-Bold.otf'),
  ]);

  return [
    {
      name: 'AppFont',
      data: regular,
      fallback: true,
    },
    {
      name: 'AppFont-Bold',
      data: bold,
    },
  ];
}

let fontPromise:
  Promise<SlipFont[]> | undefined;

const slipkit = createSlipKit({
  getFonts: () => {
    fontPromise ??= loadAppFonts();
    return fontPromise;
  },
});
```

> [!TIP]
> `getFonts`는 PDF를 렌더링할 때 다시 호출될 수 있습니다.
> 네트워크나 파일 시스템에서 폰트를 읽는다면 위 예제처럼 결과 `Promise`를 보관하여 같은 폰트를 반복해서 불러오지 않도록 구성하세요.

### 사용자 폰트 적용 규칙

폰트 객체는 다음 값을 사용합니다.

| 필드 | 설명 |
|---|---|
| `name` | 양식 요소가 참조할 폰트 이름 |
| `data` | TTF 또는 OTF 파일의 `Uint8Array` |
| `fallback` | 다른 폰트를 찾지 못했을 때 사용할 대체 폰트 여부 |

다음 규칙을 확인하세요.

- `fallback: true`인 폰트는 하나만 지정할 수 있습니다.
- 대체 폰트를 지정하지 않으면 목록의 첫 번째 폰트를 대체 폰트로 사용합니다.
- 같은 `name`을 가진 폰트를 여러 개 등록할 수 없습니다.
- 굵은 폰트는 기본 이름 뒤에 `-Bold`를 붙입니다.
- 기울임 폰트는 기본 이름 뒤에 `-Italic`을 붙입니다.
- 굵은 기울임 폰트는 기본 이름 뒤에 `-BoldItalic`을 붙입니다.

예를 들어 기본 폰트 이름이 `AppFont`라면 다음과 같이 구성합니다.

```ts
const fonts = [
  {
    name: 'AppFont',
    data: regular,
    fallback: true,
  },
  {
    name: 'AppFont-Bold',
    data: bold,
  },
  {
    name: 'AppFont-Italic',
    data: italic,
  },
  {
    name: 'AppFont-BoldItalic',
    data: boldItalic,
  },
];
```

필요한 변형 폰트가 등록되어 있지 않으면 해당 굵기나 기울임 효과를 적용하지 못할 수 있습니다.

### 동봉 폰트와 사용자 폰트 함께 사용

`getFonts`가 비어 있지 않은 배열을 반환하면 동봉 기본 폰트는 자동으로 추가되지 않습니다.

동봉 폰트를 사용자 폰트와 함께 사용하려면 폰트 서브패스에서 직접 불러옵니다.

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  PRETENDARD_FONTS,
} from '@omdc-slipkit/elements/fonts/pretendard';

import {
  NOTO_SANS_JP_FONTS,
} from '@omdc-slipkit/elements/fonts/noto-sans-jp';

const slipkit = createSlipKit({
  getFonts: () => [
    ...PRETENDARD_FONTS,
    ...NOTO_SANS_JP_FONTS,
    {
      name: 'AppFont',
      data: appFont,
    },
  ],
});
```

> [!CAUTION]
> 전체 폰트 파일은 번들 크기와 초기 로딩 시간에 큰 영향을 줄 수 있습니다.
> 애플리케이션에서 실제로 사용하는 문자와 굵기를 포함하는 폰트만 공급하세요.

동봉된 Pretendard와 Noto Sans JP에는 각각 SIL Open Font License 1.1이 적용됩니다. 사용자 폰트를 포함할 때는 해당 폰트의 배포 및 임베딩 조건도 확인해야 합니다.

## 디자이너 설정

`<slip-designer>`는 용지와 바코드 선택지를 `SlipDesignerSettings`로 받습니다. 폰트와 로케일은 `slipkit` 프로퍼티로 전달합니다.

```ts
import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => appPaperSizes,
    savePaperSize: saveAppPaperSize,
    getBarcodeKinds: () => [
      'qrcode',
      'code128',
      'ean13',
    ],
  };
```

### 사용자 용지 추가

디자이너에는 다음 용지가 기본으로 제공됩니다.

| 이름 | 너비 | 높이 |
|---|---:|---:|
| A4 | 210mm | 297mm |
| A5 | 148mm | 210mm |
| B5 | 176mm | 250mm |
| Letter | 215.9mm | 279.4mm |

애플리케이션 전용 용지는 `getPaperSizes`로 추가합니다.

```ts
import type {
  PaperSize,
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const paperSizes: PaperSize[] = [
  {
    name: '배송 라벨 100×150',
    width: 100,
    height: 150,
  },
  {
    name: '영수증 80mm',
    width: 80,
    height: 200,
  },
];

const settings: SlipDesignerSettings = {
  getPaperSizes: () => paperSizes,
};
```

사용자 용지는 기본 용지 뒤에 추가됩니다. `.slip` 파일에는 용지 이름이 아니라 실제 너비와 높이만 저장됩니다.

디자이너에서 사용자가 직접 입력한 용지를 애플리케이션에 저장하려면 `savePaperSize`를 함께 구현합니다.

```ts
const PAPER_STORAGE_KEY =
  'my-app-paper-sizes';

function readPaperSizes(): PaperSize[] {
  const json =
    localStorage.getItem(PAPER_STORAGE_KEY);

  if (!json) {
    return [];
  }

  return JSON.parse(json) as PaperSize[];
}

function writePaperSizes(
  sizes: PaperSize[],
): void {
  localStorage.setItem(
    PAPER_STORAGE_KEY,
    JSON.stringify(sizes),
  );
}

const settings: SlipDesignerSettings = {
  getPaperSizes: () => readPaperSizes(),

  savePaperSize: (size) => {
    const sizes = readPaperSizes();

    const filtered = sizes.filter(
      (item) => item.name !== size.name,
    );

    writePaperSizes([
      ...filtered,
      size,
    ]);
  },
};
```

사용자가 디자이너에서 용지를 저장하면 `savePaperSize`가 호출됩니다. 저장이 끝난 뒤 디자이너는 `getPaperSizes`를 다시 호출하여 선택 목록을 갱신합니다.

> [!NOTE]
> `savePaperSize`는 용지를 어디에 저장해야 하는지 정하지 않습니다.
> `localStorage`, IndexedDB 또는 서버 API 중 애플리케이션에 맞는 저장 방식을 호스트가 구현해야 합니다.

### 바코드 종류 제한

디자이너는 기본적으로 다음 12종의 바코드를 표시합니다.

| 값 | 표시 이름 |
|---|---|
| `qrcode` | QR Code |
| `code128` | CODE128 |
| `ean13` | EAN-13 |
| `code39` | CODE39 |
| `ean8` | EAN-8 |
| `upca` | UPC-A |
| `upce` | UPC-E |
| `itf14` | ITF-14 |
| `nw7` | NW-7 (CODABAR) |
| `japanpost` | Japan Post |
| `gs1datamatrix` | GS1 DataMatrix |
| `pdf417` | PDF417 |

애플리케이션에서 사용하는 종류만 표시하려면 `getBarcodeKinds`를 구현합니다.

```ts
import type {
  BarcodeKind,
} from '@omdc-slipkit/core';

import type {
  SlipDesignerSettings,
} from '@omdc-slipkit/elements';

const barcodeKinds: BarcodeKind[] = [
  'qrcode',
  'code128',
  'ean13',
];

const settings: SlipDesignerSettings = {
  getBarcodeKinds: () => barcodeKinds,
};
```

`getBarcodeKinds`를 생략하거나 빈 배열을 반환하면 12종 전체가 표시됩니다.

> [!NOTE]
> 이 설정은 디자이너의 선택 목록을 줄이는 기능입니다.
> 기존 `.slip` 파일에 들어 있는 다른 바코드 종류를 파일 형식에서 금지하는 정책은 아닙니다.

## 양식 프리셋 설정

디자이너에는 거래명세서와 청구서 프리셋이 기본으로 포함되어 있습니다.

애플리케이션 전용 프리셋을 제공하려면 `SlipPreset` 배열을 `presets`에 전달합니다.

```ts
import {
  CURRENT_SCHEMA_VERSION,
} from '@omdc-slipkit/core';

import type {
  SlipPreset,
} from '@omdc-slipkit/elements';

const shippingLabelPreset:
  SlipPreset = {
    id: 'shipping-label',
    name: '배송 라벨',

    create: () => ({
      schemaVersion:
        CURRENT_SCHEMA_VERSION,
      kind: 'template',
      template: {
        meta: {
          title: '배송 라벨',
        },
        paper: {
          width: 100,
          height: 150,
          padding: [
            5,
            5,
            5,
            5,
          ],
        },
        parameters: [
          {
            key: 'recipientName',
            label: '수령인',
          },
          {
            key: 'address',
            label: '주소',
          },
        ],
        pages: [
          {
            elements: [
              {
                type: 'field',
                id: 'recipient-name',
                name: '수령인',
                position: {
                  x: 10,
                  y: 15,
                },
                width: 80,
                height: 10,
                parameter: 'recipientName',
                fontSize: 14,
              },
              {
                type: 'field',
                id: 'address',
                name: '주소',
                position: {
                  x: 10,
                  y: 30,
                },
                width: 80,
                height: 30,
                parameter: 'address',
              },
            ],
          },
        ],
        assets: [],
      },
    }),
  };

const appPresets: SlipPreset[] = [
  shippingLabelPreset,
];

designer.presets = appPresets;
```

`create`는 프리셋을 선택할 때마다 새로운 `SlipTemplateFile` 객체를 반환해야 합니다. 같은 객체를 계속 반환하면 이전 편집 내용이 다음 프리셋 선택에 남을 수 있습니다.

### 동봉 프리셋과 함께 표시

사용자 프리셋을 지정하면 동봉 프리셋 대신 사용자 프리셋이 표시됩니다.

두 종류를 함께 표시하려면 동봉 `presets`를 펼쳐서 전달합니다.

```ts
import {
  presets as builtInPresets,
} from '@omdc-slipkit/elements';

const appPresets = [
  ...builtInPresets,
  shippingLabelPreset,
];

designer.presets = appPresets;
```

> [!NOTE]
> 빈 배열을 전달하면 프리셋 메뉴가 비는 것이 아니라 동봉 프리셋으로 돌아갑니다.
> 현재 설정만으로 프리셋 메뉴 전체를 숨기지는 않습니다.

> [!WARNING]
> 프리셋을 선택하면 디자이너에서 편집 중인 양식 전체가 프리셋이 반환한 양식으로 교체됩니다.
> 사용자에게 프리셋을 적용하기 전에 현재 작업을 저장할 기회를 제공하세요.

## 저장소 설정

디자이너의 `storage` 프로퍼티는 다음 기능에 사용합니다.

- 내 양식으로 저장
- 저장된 양식 목록 조회
- 저장된 양식 불러오기
- 저장된 양식 삭제

`storage`를 지정하지 않으면 해당 버튼이 표시되지 않습니다.

### IndexedDB 저장소

브라우저에 양식을 저장하려면 `IndexedDbStorage`를 사용할 수 있습니다.

```ts
import {
  IndexedDbStorage,
} from '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';

const slipkit = createSlipKit({
  locale: 'ko-KR',
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    pageSize: 50,
  });

designer.storage = templateStorage;
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `dbName` | `'slipkit'` | 사용할 IndexedDB 데이터베이스 이름 |
| `pageSize` | `50` | `list`가 한 번에 반환할 항목 수 |
| `encryptOnSave` | `false` | 저장할 본문의 암호화 여부 |

여러 애플리케이션이나 실행 환경에서 데이터가 섞이지 않도록 고유한 `dbName`을 지정하는 것을 권장합니다.

> [!IMPORTANT]
> `storage`는 디자이너의 “내 양식” 기능에 사용됩니다.
> 편집할 때마다 발생하는 `slip-change`를 자동으로 저장하는 설정은 아닙니다.
> 자동 저장은 이벤트를 받아 별도로 구현해야 합니다.

자동 저장과 서버 저장소 연결은 [애플리케이션 통합 가이드](integration.md)를 참고하세요.

### 저장 내용 암호화

암호화 키와 이전 키는 `createSlipKit`에 한 번만 설정합니다. 저장 수단에서는 `encryptOnSave`로 저장 시 암호화 여부만 정합니다.

```ts
const encryptionKey =
  getEncryptionKeyFromHost();

const slipkit = createSlipKit({
  locale: 'ko-KR',
  encryption: {
    key: encryptionKey,
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

이전 키로 저장한 파일도 읽어야 한다면 `previousKeys`를 지정합니다.

```ts
const slipkit = createSlipKit({
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

> [!WARNING]
> `encryptOnSave: true`인데 `SlipKit`에 암호화 키가 없으면 저장이 실패합니다.
> 라이브러리는 샘플 키를 대신 사용하지 않습니다. 운영 키는 호스트에서 관리하세요.

IndexedDB 암호화는 `.slip` 본문을 보호하지만 목록에 필요한 다음 메타데이터는 평문으로 저장합니다.

- 저장 키
- 파일 종류
- 양식 제목
- 마지막 수정 시각

제목까지 민감한 정보라면 별도의 저장소 구현이나 서버 측 보호 정책을 사용해야 합니다.

### 파일 열기와 내려받기

`SlipFileExchange`는 파일 내려받기와 파일 선택 창을 제공합니다. 목록·삭제 기능이 없으며 `StorageAdapter`를 구현하지 않습니다.

```ts
import {
  SlipFileExchange,
} from '@omdc-slipkit/elements';

const files =
  new SlipFileExchange(slipkit, {
    encryptOnSave: true,
  });

await files.download('document.slip', file);
const opened = await files.open();
```

`encryptOnSave: false`여도 암호화된 파일을 열 때는 `SlipKit`의 현재 키와 이전 키를 순서대로 시도합니다.

## 이미지 크기 제한

`<slip-designer>`와 `<slip-form>`은 사용자가 업로드하는 이미지의 최대 원본 파일 크기를 제한할 수 있습니다.

기본값은 2MB입니다.

### Web Component

```html
<slip-designer
  max-image-bytes="1048576"
></slip-designer>

<slip-form
  max-image-bytes="1048576"
></slip-form>
```

### React

```tsx
<SlipDesigner
  src={designerSrc}
  maxImageBytes={1024 * 1024}
/>

<SlipForm
  src={formSrc}
  maxImageBytes={1024 * 1024}
/>
```

### Vue

```vue
<SlipDesigner
  :src="designerSrc"
  :max-image-bytes="1024 * 1024"
/>

<SlipForm
  :src="formSrc"
  :max-image-bytes="1024 * 1024"
/>
```

이 제한은 다음 이미지 선택에 적용됩니다.

- 디자이너에서 추가하는 고정 이미지
- 디자이너에서 입력하는 이미지 샘플 값
- 작성폼에서 입력하는 변동 이미지

이미지는 `data:` Base64 문자열로 `.slip` 파일에 포함되므로 변환 후 크기가 원본보다 약 33% 커질 수 있습니다.

> [!NOTE]
> `maxImageBytes`는 사용자가 새로 선택하는 원본 이미지 파일을 검사합니다.
> 외부에서 불러온 기존 `.slip` 파일 전체 크기를 제한하거나 이미 포함된 이미지를 자동으로 축소하지는 않습니다.

애플리케이션에서 허용할 이미지 크기를 정할 때는 다음 항목을 함께 고려하세요.

- 브라우저 메모리 사용량
- IndexedDB 또는 서버 저장 용량
- API 요청 본문 크기 제한
- PDF 렌더링 시간
- 전표 한 건에 포함될 수 있는 이미지 개수

## Core 설정

`@omdc-slipkit/core`에서는 `createSlipKit`에 공통 설정을 전달합니다.

```ts
import {
  createSlipKit,
} from '@omdc-slipkit/core';

const slip = createSlipKit({
  getFonts: () => appFonts,
  locale: 'ko-KR',
  encryption: {
    key: currentKey,
    previousKeys: [
      previousKey,
    ],
  },
});
```

| 설정 | 용도 |
|---|---|
| `getFonts` | PDF 렌더링에 사용할 폰트 공급 |
| `locale` | `FORMAT_NUMBER` 등의 표시 형식과 오류 메시지에 사용할 BCP-47 로케일 (기본 `'en-US'`) |
| `encryption.key` | `encrypt`와 `decrypt`가 기본으로 사용할 키 |
| `encryption.previousKeys` | 이전 키로 암호화된 파일을 복호화할 때 사용할 키 목록 |

UI 컴포넌트와 저장 수단에 같은 `slipkit`을 전달하면 폰트·수식·PDF 렌더링·저장소 오류 메시지가 한 인스턴스의 설정을 재사용합니다. 컴포넌트 `locale`을 생략하면 UI 언어도 `SlipKit.locale`을 따릅니다.

컴포넌트 `locale`은 UI 언어만 따로 지정해야 할 때 사용합니다.

| 설정 | 예 | 역할 |
|---|---|---|
| 컴포넌트 `locale` | `'ko'`, `'en'`, `'ja'` | UI 문구. `slipkit`이 없을 때는 동봉 폰트도 선택 |
| Core `locale` | `'ko-KR'`, `'en-US'`, `'ja-JP'` | 숫자와 날짜 수식 포맷, 오류 메시지 언어 |

Core 사용 흐름과 PDF 생성 방법은 [Core 사용 가이드](core.md)를 참고하세요.

## 권장 설정 구성

애플리케이션 전역에서 동일한 설정을 사용한다면 한 파일에서 생성하여 공유하는 방법을 권장합니다.

`src/slipkit-config.ts`:

```ts
import { createSlipKit } from '@omdc-slipkit/core';
import {
  IndexedDbStorage,
  getPresets,
  type SlipDesignerSettings,
  type SlipPreset,
} from '@omdc-slipkit/elements';

const fontPromise =
  loadAppFonts();

export const slipkit = createSlipKit({
  locale: 'ko-KR',
  getFonts: () => fontPromise,
  encryption: {
    key: currentKey,
    previousKeys: [previousKey],
  },
});

export const designerSettings:
  SlipDesignerSettings = {
    getPaperSizes: () => [
      {
        name: '배송 라벨 100×150',
        width: 100,
        height: 150,
      },
    ],

    getBarcodeKinds: () => [
      'qrcode',
      'code128',
    ],
  };

export const designerPresets:
  SlipPreset[] = [
    ...getPresets('ko'),
    shippingLabelPreset,
  ];

export const templateStorage =
  new IndexedDbStorage(slipkit, {
    dbName: 'my-app-templates',
    encryptOnSave: true,
  });
```

컴포넌트에서는 필요한 설정만 전달합니다.

```tsx
<SlipDesigner
  src={designerSrc}
  slipkit={slipkit}
  settings={designerSettings}
  presets={designerPresets}
  storage={templateStorage}
/>

<SlipForm
  src={formSrc}
  slipkit={slipkit}
/>

<SlipViewer
  src={viewerSrc}
  slipkit={slipkit}
/>
```

이렇게 구성하면 폰트·로케일·암호화 키를 `SlipKit`에서 한 번만 관리하고 컴포넌트와 저장 수단이 같은 설정을 사용하게 됩니다.

## 피해야 할 설정

- 객체 설정을 HTML 속성 문자열로 전달
- React 렌더링마다 새로운 `slipkit`, `settings`, 저장소 인스턴스 생성
- `getFonts`가 호출될 때마다 같은 폰트를 네트워크에서 다시 다운로드
- 사용자 폰트를 공급하면서 필요한 기본 폰트가 자동으로 추가된다고 가정
- 둘 이상의 폰트에 `fallback: true` 지정
- 굵은 폰트를 기본 폰트와 같은 이름으로 등록
- `locale`이 양식 안의 문구까지 번역한다고 가정
- 빈 `presets` 배열로 프리셋 메뉴가 숨겨진다고 가정
- `storage`를 자동 저장 설정으로 해석
- `SlipFileExchange`를 디자이너의 `storage`로 사용
- 운영 암호화 키를 코드에 하드코딩
- Base64 변환 이후의 파일 크기 증가를 고려하지 않고 이미지 제한 설정

## 완료 확인

- [ ] `SlipKit`에 폰트·로케일·암호화 키를 한 번만 설정했습니다.
- [ ] UI 언어를 다르게 쓰는 컴포넌트에만 `locale`을 재정의했습니다.
- [ ] 출력할 문자와 스타일에 필요한 폰트를 공급했습니다.
- [ ] 폰트 공급 결과를 재사용하도록 구성했습니다.
- [ ] 애플리케이션에 필요한 사용자 용지와 바코드 종류를 설정했습니다.
- [ ] 사용자 프리셋의 `create`가 매번 새 양식을 반환합니다.
- [ ] 디자이너 저장소와 자동 저장의 역할을 구분했습니다.
- [ ] 운영 환경의 암호화 키를 호스트에서 관리합니다.
- [ ] 저장 및 전송 환경에 맞는 이미지 크기 제한을 설정했습니다.
- [ ] React·Vue에서 설정 객체와 저장소 인스턴스를 재사용합니다.

## 관련 문서

- [시작하기](getting-started.md)
- [양식 디자이너 사용 가이드](designer.md)
- [애플리케이션 통합 가이드](integration.md)
- [Core 사용 가이드](core.md)
- [API 참조](api-reference.md)
