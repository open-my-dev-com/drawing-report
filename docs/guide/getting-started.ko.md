# 시작하기

[English](getting-started.md) · [日本語](getting-started.ja.md)

이 문서는 SlipKit을 처음 사용하는 개발자가 양식 디자이너를 실행하고, 사용자가 편집한 양식 데이터를 애플리케이션에서 받는 과정까지 설명합니다.

이 문서를 완료하면 다음 작업을 할 수 있습니다.

- 유효한 빈 양식 만들기
- `<slip-designer>`로 양식 표시하기
- 사용자가 편집한 양식 받기
- 이후 저장·전표 작성 기능을 연결할 준비하기

> [!IMPORTANT]
> SlipKit은 현재 공개 전 검토 단계이며 `@omdc-slipkit/*` 패키지는 npm 레지스트리에 아직 배포되지 않았습니다.
> 지금 바로 실행하려면 저장소를 복제하여 동봉 데모를 사용해야 합니다.

## 실행 방법 선택

| 목적 | 사용할 방법 |
|---|---|
| 현재 SlipKit을 실행하고 기능 확인 | [저장소에서 데모 실행](#저장소에서-데모-실행) |
| npm 배포 후 기존 애플리케이션에 통합 | [외부 프로젝트에 연결](#외부-프로젝트에-연결) |

---

## 저장소에서 데모 실행

현재 바로 실행할 수 있는 방법입니다.

### 요구 환경

- Node.js 22.13 이상
- pnpm 10.33.0

설치된 버전은 다음 명령으로 확인할 수 있습니다.

```bash
node --version
pnpm --version
```

### 1. 저장소 준비

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
pnpm install
```

### 2. 데모 실행

사용하는 환경에 맞는 데모 하나를 실행합니다.

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| 데모 | 기본 주소 |
|---|---|
| Web Component | `http://localhost:5173` |
| React | `http://localhost:5174` |
| Vue | `http://localhost:5175` |

포트가 이미 사용 중이면 개발 서버가 다른 주소를 안내할 수 있습니다. 이 경우 터미널에 표시된 주소로 접속합니다.

데모의 기본 언어는 영어입니다. 주소에 `?locale=`을 붙이면 그 언어로 실행됩니다.

```text
http://localhost:5173/?locale=ko   # 한국어
http://localhost:5173/?locale=ja   # 일본어
```

환경 변수 `VITE_SLIPKIT_LOCALE`로 기본 언어를 지정할 수도 있습니다. 주소의 `?locale=` 값이 우선합니다.

```bash
VITE_SLIPKIT_LOCALE=ko pnpm demo
```

### 3. 기능 확인

데모를 실행하면 다음과 같은 양식 디자이너가 표시됩니다.

![SlipKit 양식 디자이너](images/ko/overview.png)

다음 항목을 순서대로 확인해 보세요.

- [ ] <kbd>프리셋</kbd>에서 거래명세서 또는 청구서 불러오기
- [ ] 텍스트나 필드 요소 추가하기
- [ ] 추가한 요소의 위치와 크기 변경하기
- [ ] 파라미터 또는 수식 설정하기
- [ ] <kbd>미리보기</kbd>에서 PDF 렌더링 결과 확인하기
- [ ] <kbd>전표 쓰기</kbd>로 이동하여 값 입력하기
- [ ] 작성한 전표 발행하기
- [ ] <kbd>발행 전표 보기</kbd>에서 발행된 전표 확인하기
- [ ] `.slip` 파일 내려받기
- [ ] PDF 파일 내려받기
- [ ] 내려받은 `.slip` 파일 다시 열기
- [ ] 새로고침 후 이전 작업이 복원되는지 확인하기

> [!NOTE]
> 화면 전환, 자동 저장, 파일 열기와 내려받기는 SlipKit 컴포넌트가 단독으로 제공하는 기능이 아닙니다.
> 동봉 데모가 SlipKit의 이벤트와 저장소 어댑터를 조합하여 구현한 사용 예시입니다.

프레임워크별 전체 구현은 다음 디렉터리에서 확인할 수 있습니다.

| 환경 | 예제 |
|---|---|
| Web Component | [`examples/demo`](../../examples/demo) |
| React | [`examples/react-demo`](../../examples/react-demo) |
| Vue | [`examples/vue-demo`](../../examples/vue-demo) |
| 공통 저장·파일 처리 | [`examples/shared`](../../examples/shared) |

---

## 외부 프로젝트에 연결

> [!WARNING]
> 이 절의 설치 명령은 `@omdc-slipkit/*` 패키지가 npm에 공개된 이후 사용할 수 있습니다.
> 현재 실행하면 `404 Not Found` 오류가 발생합니다.

다음 예제는 ESM과 TypeScript를 지원하는 Vite 등의 빌드 환경을 기준으로 합니다.

### 1. 패키지 설치

사용하는 환경에 맞는 패키지를 설치합니다.

<details>
<summary><strong>Web Component</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/elements
```

</details>

<details>
<summary><strong>React</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/react
```

React 19 이상이 필요합니다. 기존 프로젝트에 React가 없다면 함께 설치합니다.

```bash
npm install react react-dom
```

</details>

<details>
<summary><strong>Vue</strong></summary>

```bash
npm install @omdc-slipkit/core @omdc-slipkit/vue
```

Vue 3.4 이상이 필요합니다. 기존 프로젝트에 Vue가 없다면 함께 설치합니다.

```bash
npm install vue
```

</details>

> [!TIP]
> `elements`, `react`, `vue` 패키지는 내부적으로 `core`를 사용합니다.
> 하지만 애플리케이션 코드에서 `@omdc-slipkit/core`를 직접 import한다면 `core`도 직접 의존성으로 설치해야 합니다.

### 2. 시작 양식 만들기

세 환경에서 공통으로 사용할 유효한 빈 양식을 만듭니다.

`src/slip-template.ts`:

```ts
import {
  CURRENT_SCHEMA_VERSION,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

export function createBlankTemplate(): SlipTemplateFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    kind: 'template',
    template: {
      meta: {
        title: '새 양식',
      },
      paper: {
        width: 210,
        height: 297,
        padding: [10, 10, 10, 10],
      },
      pages: [
        {
          elements: [],
        },
      ],
      assets: [],
    },
  };
}
```

이 예제는 A4 크기의 빈 양식을 만듭니다. 디자이너가 표시되면 요소를 직접 추가하거나 동봉 프리셋을 불러올 수 있습니다.

> [!IMPORTANT]
> `<slip-designer>`의 `src`에는 일반 객체가 아니라 `serializeSlipFile`로 변환한 JSON 문자열을 전달해야 합니다.

### 3. 디자이너 연결

사용하는 환경에 해당하는 예제 하나만 펼쳐서 적용합니다.

<details>
<summary><strong>Web Component 예제</strong></summary>

HTML에 디자이너가 표시될 영역을 추가합니다.

`index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>SlipKit 시작하기</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }

      slip-designer {
        display: block;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <slip-designer></slip-designer>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

디자이너를 등록하고 시작 양식을 전달합니다.

`src/main.ts`:

```ts
import '@omdc-slipkit/elements';

import {
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';
import type { SlipDesigner } from '@omdc-slipkit/elements';

import { createBlankTemplate } from './slip-template';

const designer =
  document.querySelector<SlipDesigner>('slip-designer');

if (!designer) {
  throw new Error('slip-designer 요소를 찾을 수 없습니다.');
}

let template = createBlankTemplate();

designer.src = serializeSlipFile(template);

designer.addEventListener('slip-change', (event) => {
  const { file } = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
  console.log('변경된 양식:', template);
});
```

Web Component에서는 `slip-change`가 `CustomEvent`로 전달되며, 변경된 파일은 `event.detail.file`에 들어 있습니다.

</details>

<details>
<summary><strong>React 예제</strong></summary>

`src/App.tsx`:

```tsx
import { useRef, useState } from 'react';
import { SlipDesigner } from '@omdc-slipkit/react';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

import { createBlankTemplate } from './slip-template';

export default function App() {
  // 디자이너에 전달할 시작 입력은 편집 세션 동안 유지합니다.
  const [designerSrc] = useState(() =>
    serializeSlipFile(createBlankTemplate()),
  );

  // 이벤트로 받은 최신 양식은 src와 별도로 보관합니다.
  const latestTemplate =
    useRef<SlipTemplateFile | null>(null);

  function handleSlipChange(file: SlipFile): void {
    if (file.kind !== 'template') {
      return;
    }

    latestTemplate.current = file;
    console.log('변경된 양식:', file);
  }

  return (
    <main style={{ height: '100vh' }}>
      <SlipDesigner
        src={designerSrc}
        onSlipChange={handleSlipChange}
      />
    </main>
  );
}
```

React 래퍼의 `onSlipChange`에는 `CustomEvent`가 아니라 변경된 `SlipFile` 객체가 직접 전달됩니다.

</details>

<details>
<summary><strong>Vue 예제</strong></summary>

`src/App.vue`:

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { SlipDesigner } from '@omdc-slipkit/vue';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
} from '@omdc-slipkit/core';

import { createBlankTemplate } from './slip-template';

const initialTemplate = createBlankTemplate();

// 디자이너에 전달할 시작 입력은 편집 세션 동안 유지합니다.
const designerSrc = ref(
  serializeSlipFile(initialTemplate),
);

// 이벤트로 받은 최신 양식은 src와 별도로 보관합니다.
const latestTemplate =
  shallowRef<SlipTemplateFile>(initialTemplate);

function handleSlipChange(file: SlipFile): void {
  if (file.kind !== 'template') {
    return;
  }

  latestTemplate.value = file;
  console.log('변경된 양식:', file);
}
</script>

<template>
  <main class="designer-page">
    <SlipDesigner
      :src="designerSrc"
      @slip-change="handleSlipChange"
    />
  </main>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.designer-page {
  height: 100%;
}
</style>
```

Vue 래퍼의 `slip-change` 이벤트에는 변경된 `SlipFile` 객체가 직접 전달됩니다.

</details>

> [!IMPORTANT]
> `slip-change`로 받은 파일을 현재 편집 중인 디자이너의 `src`에 곧바로 다시 전달하지 마세요.
>
> `src` 변경은 새로운 외부 양식을 불러오는 동작입니다. `src`가 바뀌면 디자이너가 파일을 다시 파싱하며 선택한 요소, 현재 페이지, 실행 취소·다시 실행 기록과 편집 중인 화면 상태가 초기화됩니다.

디자이너 입력과 편집 결과는 다음과 같이 구분하여 관리합니다.

| 데이터 | 역할 | 변경 시점 |
|---|---|---|
| `designerSrc` | 디자이너에서 편집을 시작할 외부 양식 | 처음 열거나 다른 양식을 명시적으로 열 때 |
| `latestTemplate` | 사용자가 현재까지 편집한 최신 결과 | `slip-change`를 받을 때마다 |
| 저장 데이터 | 새로고침 이후에도 복원할 양식 | 자동 저장 또는 사용자의 저장 요청 시 |

다른 양식 파일을 열거나 저장된 양식을 복원할 때는 새 파일을 직렬화하여 `designerSrc`에 전달합니다. 이 경우에는 새로운 편집 세션을 시작하는 것이므로 디자이너 상태가 초기화되는 것이 정상입니다.

### 4. 실행 결과 확인

애플리케이션을 실행한 뒤 다음 내용을 확인합니다.

- [ ] A4 크기의 빈 양식이 표시됩니다.
- [ ] 디자이너의 <kbd>프리셋</kbd> 메뉴에서 기본 양식을 불러올 수 있습니다.
- [ ] 요소를 추가하거나 수정하면 콘솔에 `변경된 양식`이 출력됩니다.
- [ ] 출력된 객체의 `kind`가 `template`입니다.
- [ ] 연속해서 편집해도 선택한 요소나 현재 페이지가 초기화되지 않습니다.
- [ ] 실행 취소와 다시 실행 기록이 편집 중에 유지됩니다.
- [ ] TypeScript 오류가 발생하지 않습니다.

모든 항목을 확인했다면 SlipKit 양식 디자이너의 최소 연결이 완료된 것입니다.

---

## 변경된 양식 저장하기

> [!IMPORTANT]
> `<slip-designer>`는 편집 결과를 자동으로 영구 저장하지 않습니다.
> `slip-change`로 받은 파일을 애플리케이션에서 보관하지 않으면 새로고침하거나 화면을 닫았을 때 편집 내용이 사라집니다.

Web Component의 `slip-change`, React의 `onSlipChange`, Vue의 `slip-change`를 통해 받은 파일을 애플리케이션에서 보관해야 합니다.

이 이벤트는 사용자가 양식을 편집할 때마다 발생할 수 있습니다. 서버에 저장할 때는 키 입력이나 드래그마다 요청하지 않도록 일정 시간 동안 변경을 모아서 저장하는 방식을 권장합니다.

다음 단계에서는 일반적으로 아래 기능을 추가합니다.

1. 브라우저에 양식 임시 저장
2. 서버 API에 양식 저장
3. 저장된 양식 다시 불러오기
4. 양식을 `<slip-form>`에 전달해 전표 작성
5. 발행된 전표를 `<slip-viewer>`로 조회

---

## 자주 발생하는 문제

<details>
<summary><strong>npm에서 패키지를 찾을 수 없습니다</strong></summary>

SlipKit 패키지가 아직 공개되지 않은 상태에서는 다음과 같은 오류가 발생합니다.

```text
npm error 404 Not Found
```

현재는 [저장소에서 데모 실행](#저장소에서-데모-실행) 방법을 사용합니다.

</details>

<details>
<summary><strong>디자이너에 파일 오류가 표시됩니다</strong></summary>

`src`에 빈 객체나 일반 객체를 직접 전달했는지 확인합니다.

다음과 같은 값은 유효한 양식이 아닙니다.

```html
<slip-designer src="{}"></slip-designer>
```

`SlipTemplateFile` 객체를 만든 다음 `serializeSlipFile`로 변환해야 합니다.

```ts
designer.src = serializeSlipFile(createBlankTemplate());
```

</details>

<details>
<summary><strong>@omdc-slipkit/core를 찾을 수 없습니다</strong></summary>

애플리케이션 코드에서 `core`를 직접 import한다면 직접 의존성으로 설치해야 합니다.

```bash
npm install @omdc-slipkit/core
```

</details>

<details>
<summary><strong>컴포넌트가 화면에 보이지 않습니다</strong></summary>

부모 요소에 높이가 없는지 확인합니다. 디자이너를 전체 화면으로 표시하려면 부모와 디자이너에 높이를 지정합니다.

```css
html,
body,
#app {
  height: 100%;
}

slip-designer {
  display: block;
  height: 100%;
}
```

</details>

<details>
<summary><strong>새로고침하면 편집 내용이 사라집니다</strong></summary>

SlipKit 컴포넌트는 편집 내용을 자동으로 영구 저장하지 않습니다. `slip-change`로 받은 파일을 IndexedDB, 서버 또는 애플리케이션 상태에 저장해야 합니다.

</details>

<details>
<summary><strong>편집할 때마다 선택한 요소나 페이지가 초기화됩니다</strong></summary>

`slip-change`로 받은 파일을 현재 편집 중인 디자이너의 `src`에 다시 전달하고 있는지 확인합니다.

다음과 같은 양방향 연결은 피해야 합니다.

```tsx
const [template, setTemplate] = useState(createBlankTemplate);

<SlipDesigner
  src={serializeSlipFile(template)}
  onSlipChange={setTemplate}
/>
```

사용자가 편집할 때마다 `template`이 변경되고 새 `src`가 전달되므로 디자이너가 파일을 다시 불러옵니다.

디자이너의 시작 입력과 최신 편집 결과를 분리하세요.

```tsx
const [designerSrc] = useState(() =>
  serializeSlipFile(createBlankTemplate()),
);

const latestTemplate =
  useRef<SlipTemplateFile | null>(null);

<SlipDesigner
  src={designerSrc}
  onSlipChange={(file) => {
    if (file.kind === 'template') {
      latestTemplate.current = file;
    }
  }}
/>
```

</details>

---

## 다음 문서

- [양식 디자이너 사용 가이드](designer.ko.md): 화면에서 양식을 만드는 방법
- [Core API 가이드](core.ko.md): Node.js에서 파일 검증과 PDF 생성
- [수식 함수 참조](formula.ko.md): 양식에서 사용할 수 있는 수식
