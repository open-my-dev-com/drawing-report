# 애플리케이션 통합 가이드

이 문서는 SlipKit의 디자이너·작성폼·뷰어를 연결하고, 각 컴포넌트에서 받은 양식과 전표를 애플리케이션에서 관리하는 방법을 설명합니다.

먼저 양식 디자이너를 실행하지 않았다면 [시작하기](getting-started.md)를 진행하세요.

이 문서를 완료하면 다음 작업을 할 수 있습니다.

- 양식과 전표 상태 구분하기
- 디자이너·작성폼·뷰어 연결하기
- 편집 결과를 브라우저 또는 서버에 저장하기
- 작성 중 전표를 이어서 작성하기
- 발행된 전표를 읽기 전용으로 표시하기

> [!IMPORTANT]
> SlipKit 컴포넌트는 화면과 편집 기능을 제공합니다.
> 사용자 인증, 권한 관리, 화면 전환, 자동 저장 및 서버 연계는 호스트 애플리케이션에서 담당합니다.

## 전체 데이터 흐름

일반적인 애플리케이션에서는 양식과 전표가 다음 순서로 이동합니다.

```mermaid
flowchart TD
    A["양식"] --> B["SlipDesigner"]
    B -->|"slip-change"| C["호스트 상태·저장소"]
    C -->|"양식 또는 작성 중 전표"| D["SlipForm"]
    D -->|"slip-change"| E["작성 중 전표"]
    D -->|"slip-issue"| F["발행된 전표"]
    E --> C
    F --> C
    C -->|"저장된 양식·전표"| G["SlipViewer"]
```

컴포넌트끼리 데이터를 직접 전달하지 않습니다. 호스트 애플리케이션이 한 컴포넌트에서 받은 파일을 저장하고 다음 컴포넌트의 `src`로 전달합니다.

## 관리해야 하는 파일

SlipKit 애플리케이션은 주로 다음 세 가지 상태를 관리합니다.

| 상태 | 파일 종류 | 설명 |
|---|---|---|
| 양식 | `kind: 'template'` | 문서의 구성, 파라미터, 수식 등을 정의합니다. |
| 작성 중 전표 | `kind: 'voucher'`, `issued: false` | 사용자가 값을 입력하고 있는 전표입니다. |
| 발행된 전표 | `kind: 'voucher'`, `issued: true` | 값이 확정되어 작성폼에서 수정할 수 없는 전표입니다. |

전표에는 생성 당시의 양식이 `templateSnapshot`으로 저장됩니다. 이후 원본 양식이 변경되어도 기존 전표는 자신의 양식 스냅샷을 사용합니다.

> [!WARNING]
> `issued: true`는 작성폼에서 입력을 막는 상태입니다. 전표가 암호학적으로 위변조되지 않았음을 증명하는 전자서명이나 무결성 보증은 아닙니다.
> 저장된 전표의 접근 권한과 변경 방지는 호스트 애플리케이션과 서버에서 처리해야 합니다.

## 컴포넌트의 입력과 출력

| 컴포넌트 | `src`로 받는 파일 | 전달하는 결과 |
|---|---|---|
| `<slip-designer>` | 양식 | `slip-change`로 편집된 양식 |
| `<slip-form>` | 양식 또는 전표 | `slip-change`로 작성 중 전표, `slip-issue`로 발행된 전표 |
| `<slip-viewer>` | 양식 또는 전표 | 없음 |

`src`에는 `SlipFile` 객체가 아니라 `serializeSlipFile`로 변환한 JSON 문자열을 전달합니다.

```ts
import { serializeSlipFile } from '@omdc-slipkit/core';

designer.src = serializeSlipFile(template);
form.src = serializeSlipFile(template);
viewer.src = serializeSlipFile(voucher);
```

## 이벤트 연결

### 환경별 이벤트 이름

| 동작 | Web Component | React | Vue |
|---|---|---|---|
| 양식 변경 | `slip-change` | `onSlipChange` | `@slip-change` |
| 전표 입력 변경 | `slip-change` | `onSlipChange` | `@slip-change` |
| 전표 발행 | `slip-issue` | `onSlipIssue` | `@slip-issue` |

Web Component에서는 `CustomEvent`의 `detail.file`에 결과가 들어 있습니다.

```ts
designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;
});
```

React와 Vue 래퍼는 `CustomEvent`를 벗기고 `SlipFile` 객체를 직접 전달합니다.

<details>
<summary><strong>React</strong></summary>

```tsx
<SlipDesigner
  src={designerSrc}
  onSlipChange={(file) => {
    if (file.kind === 'template') {
      setTemplate(file);
    }
  }}
/>

<SlipForm
  src={formSrc}
  onSlipChange={(file) => {
    if (file.kind === 'voucher') {
      setDraftVoucher(file);
    }
  }}
  onSlipIssue={(file) => {
    if (file.kind === 'voucher') {
      setIssuedVoucher(file);
    }
  }}
/>
```

</details>

<details>
<summary><strong>Vue</strong></summary>

```vue
<SlipDesigner
  :src="designerSrc"
  @slip-change="onTemplateChange"
/>

<SlipForm
  :src="formSrc"
  @slip-change="onVoucherChange"
  @slip-issue="onVoucherIssue"
/>
```

Vue 이벤트 처리 함수에는 `SlipFile` 객체가 직접 전달됩니다.

</details>

## 세 컴포넌트 연결하기

다음 예제는 Web Component를 이용해 양식 설계, 전표 작성, 발행 전표 조회를 연결합니다.

HTML에 각 컴포넌트를 준비합니다.

```html
<section id="designer-screen">
  <slip-designer id="designer"></slip-designer>
  <button id="start-voucher">전표 작성</button>
</section>

<section id="form-screen" hidden>
  <slip-form id="form"></slip-form>
</section>

<section id="viewer-screen" hidden>
  <slip-viewer id="viewer"></slip-viewer>
</section>
```

애플리케이션에서 양식과 전표 상태를 관리합니다.

```ts
import '@omdc-slipkit/elements';

import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import type {
  SlipDesigner,
  SlipForm,
  SlipViewer,
} from '@omdc-slipkit/elements';

import { createBlankTemplate } from './slip-template';

const designer =
  document.querySelector<SlipDesigner>('#designer');
const form =
  document.querySelector<SlipForm>('#form');
const viewer =
  document.querySelector<SlipViewer>('#viewer');

const designerScreen =
  document.querySelector<HTMLElement>('#designer-screen');
const formScreen =
  document.querySelector<HTMLElement>('#form-screen');
const viewerScreen =
  document.querySelector<HTMLElement>('#viewer-screen');
const startButton =
  document.querySelector<HTMLButtonElement>('#start-voucher');

if (
  !designer ||
  !form ||
  !viewer ||
  !designerScreen ||
  !formScreen ||
  !viewerScreen ||
  !startButton
) {
  throw new Error('SlipKit 화면 요소를 찾을 수 없습니다.');
}

let template: SlipTemplateFile = createBlankTemplate();
let draftVoucher: SlipVoucherFile | null = null;
let issuedVoucher: SlipVoucherFile | null = null;

designer.src = serializeSlipFile(template);

designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
});

form.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  draftVoucher = file;
});

form.addEventListener('slip-issue', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  issuedVoucher = file;
  draftVoucher = null;

  viewer.src = serializeSlipFile(file);

  formScreen.hidden = true;
  viewerScreen.hidden = false;
});

startButton.addEventListener('click', () => {
  const source =
    draftVoucher && canContinueVoucher(draftVoucher, template)
      ? draftVoucher
      : template;

  form.src = serializeSlipFile(source);

  designerScreen.hidden = true;
  viewerScreen.hidden = true;
  formScreen.hidden = false;
});

function canContinueVoucher(
  voucher: SlipVoucherFile,
  currentTemplate: SlipTemplateFile,
): boolean {
  if (voucher.issued) {
    return false;
  }

  return (
    JSON.stringify(voucher.templateSnapshot) ===
    JSON.stringify(currentTemplate.template)
  );
}
```

### 작성폼의 `src`를 갱신하는 시점

작성폼의 `src`는 다음 시점에 설정합니다.

- 새 전표 작성을 시작할 때
- 저장된 작성 중 전표를 다시 열 때
- 사용자가 다른 전표로 전환할 때

> [!CAUTION]
> `slip-change`가 발생할 때마다 받은 전표를 다시 직렬화하여 같은 작성폼의 `src`로 넣지 마세요.
> `src`가 변경되면 작성폼은 파일을 다시 파싱하고 내부 입력 상태를 다시 구성합니다.
> 입력 중에는 이벤트로 받은 전표를 호스트 상태에만 보관하고, 작성폼의 `src`는 그대로 유지하는 것이 안전합니다.

React와 Vue에서도 작성폼 입력용 `formSrc`와 이벤트로 받은 `draftVoucher`를 별도 상태로 관리하는 것을 권장합니다.

## 작성 중 전표 이어서 쓰기

작성 중 전표는 생성 당시의 양식 스냅샷을 가지고 있습니다.

현재 양식이 변경된 후 예전 작성 중 전표를 그대로 이어 쓰면 사용자가 보고 있는 양식과 전표에 저장된 양식이 달라질 수 있습니다.

이어 쓰기 전에 다음 조건을 확인합니다.

- `issued`가 `false`인지
- `templateSnapshot`이 현재 양식과 같은지

앞의 `canContinueVoucher` 예제는 두 조건을 확인합니다.

조건이 맞지 않으면 다음 중 하나를 선택해야 합니다.

1. 현재 양식으로 새 전표를 시작합니다.
2. 기존 전표의 양식 스냅샷을 사용해 계속 작성합니다.
3. 사용자에게 어느 양식을 사용할지 선택하게 합니다.

> [!NOTE]
> 기존 전표의 `templateSnapshot`을 현재 양식으로 자동 교체하지 마세요.
> 양식이 달라지면 기존 입력값의 파라미터와 새 양식의 파라미터가 맞지 않을 수 있습니다.

## 변경 내용 저장하기

### 애플리케이션 상태와 저장 형식

애플리케이션 내부에서는 `SlipFile` 객체로 관리하고, 서버나 파일에 저장하는 경계에서 JSON 문자열로 변환하는 방식을 권장합니다.

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';

const json = serializeSlipFile(file);
const restored = parseSlipFile(json);
```

`parseSlipFile`은 JSON 파싱과 `.slip` 스키마 검증을 함께 수행합니다.

### 서버에 저장하기

다음 예제는 `.slip` 파일 전체를 서버에 저장하고 다시 불러옵니다.

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
} from '@omdc-slipkit/core';

export async function saveSlip(
  id: string,
  file: SlipFile,
): Promise<void> {
  const response = await fetch(
    `/api/slips/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: serializeSlipFile(file),
    },
  );

  if (!response.ok) {
    throw new Error(
      `저장에 실패했습니다: ${response.status}`,
    );
  }
}

export async function loadSlip(
  id: string,
): Promise<SlipFile> {
  const response = await fetch(
    `/api/slips/${encodeURIComponent(id)}`,
  );

  if (!response.ok) {
    throw new Error(
      `불러오기에 실패했습니다: ${response.status}`,
    );
  }

  return parseSlipFile(await response.text());
}
```

> [!IMPORTANT]
> 전표를 저장할 때 `values`만 따로 저장하지 말고 `SlipVoucherFile` 전체를 저장하세요.
> 전표의 양식 스냅샷과 발행 상태도 함께 보관되어야 나중에 같은 모습으로 조회할 수 있습니다.

### 자동 저장 요청 줄이기

`slip-change`는 편집이나 입력이 발생할 때마다 전달될 수 있습니다. 매번 서버 요청을 보내지 않고 입력이 잠시 멈춘 뒤 저장하도록 지연할 수 있습니다.

```ts
import type { SlipFile } from '@omdc-slipkit/core';

function createSaveScheduler(
  id: string,
  delay = 800,
): (file: SlipFile) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (file) => {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;

      void saveSlip(id, file).catch((error) => {
        console.error('자동 저장에 실패했습니다.', error);
      });
    }, delay);
  };
}

const saveTemplateLater =
  createSaveScheduler('current-template');
const saveDraftLater =
  createSaveScheduler('current-draft');
```

이후 이벤트에서 예약 저장을 호출합니다.

```ts
designer.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'template') {
    return;
  }

  template = file;
  saveTemplateLater(file);
});

form.addEventListener('slip-change', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  draftVoucher = file;
  saveDraftLater(file);
});
```

발행 이벤트는 지연하지 않고 즉시 저장하는 편이 좋습니다.

```ts
form.addEventListener('slip-issue', (event) => {
  const file = (
    event as CustomEvent<{ file: SlipFile }>
  ).detail.file;

  if (file.kind !== 'voucher') {
    return;
  }

  void saveSlip(`voucher-${crypto.randomUUID()}`, file)
    .catch((error) => {
      console.error('발행 전표 저장에 실패했습니다.', error);
    });
});
```

## 디자이너의 저장소 어댑터

`<slip-designer>`의 `storage` 프로퍼티에 `StorageAdapter`를 전달하면 디자이너에 다음 기능이 나타납니다.

- 내 양식으로 저장
- 저장한 양식 목록
- 저장한 양식 불러오기
- 저장한 양식 삭제

브라우저 IndexedDB를 사용하려면 다음과 같이 연결합니다.

```ts
import { IndexedDbStorage } from '@omdc-slipkit/elements';

const templateStorage = new IndexedDbStorage({
  dbName: 'my-app-templates',
});

designer.storage = templateStorage;
```

> [!IMPORTANT]
> `storage` 프로퍼티는 디자이너의 “내 양식” 기능에 사용하는 저장소입니다.
> 편집할 때마다 자동으로 저장하거나 작성 중 전표를 저장해 주는 기능은 아닙니다.
> 자동 저장은 별도로 `slip-change` 이벤트를 받아 구현해야 합니다.

`storage`는 객체이므로 HTML 속성 문자열로 전달할 수 없습니다.

```html
<!-- 잘못된 사용 -->
<slip-designer storage="templateStorage"></slip-designer>
```

JavaScript 프로퍼티 또는 프레임워크의 객체 prop으로 전달합니다.

```ts
designer.storage = templateStorage;
```

### 서버 저장소 어댑터

서버 API를 디자이너의 “내 양식” 기능과 연결하려면 `StorageAdapter`를 구현합니다.

<details>
<summary><strong>서버 StorageAdapter 예제</strong></summary>

```ts
import {
  parseSlipFile,
  serializeSlipFile,
  type SlipFile,
  type SlipListPage,
  type StorageAdapter,
} from '@omdc-slipkit/core';

async function requireSuccess(
  response: Response,
): Promise<Response> {
  if (!response.ok) {
    throw new Error(
      `저장소 요청에 실패했습니다: ${response.status}`,
    );
  }

  return response;
}

export const serverStorage: StorageAdapter = {
  async save(id, file): Promise<void> {
    await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: serializeSlipFile(file),
        },
      ),
    );
  },

  async load(id): Promise<SlipFile> {
    const response = await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
      ),
    );

    return parseSlipFile(await response.text());
  },

  async delete(id): Promise<void> {
    await requireSuccess(
      await fetch(
        `/api/slips/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        },
      ),
    );
  },

  async list(filter, cursor): Promise<SlipListPage> {
    const params = new URLSearchParams();

    if (filter?.kind) {
      params.set('kind', filter.kind);
    }

    if (filter?.query) {
      params.set('query', filter.query);
    }

    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await requireSuccess(
      await fetch(`/api/slips?${params.toString()}`),
    );

    return await response.json() as SlipListPage;
  },
};
```

목록 API는 다음 형태를 반환해야 합니다.

```json
{
  "items": [
    {
      "id": "template-001",
      "kind": "template",
      "title": "거래명세서",
      "updatedAt": "2026-08-25T09:00:00.000Z"
    }
  ],
  "nextCursor": "다음 페이지가 있을 때 사용할 값"
}
```

서버는 저장 요청으로 받은 JSON을 신뢰하지 말고 `parseSlipFile` 또는 `validateSlipFile`로 검증해야 합니다.

</details>

## 로컬 파일 열기와 내려받기

`LocalFileStorage`는 브라우저의 파일 선택 창과 다운로드 기능을 제공합니다.

```ts
import { LocalFileStorage } from '@omdc-slipkit/elements';

const localFiles = new LocalFileStorage();

await localFiles.save('거래명세서.slip', template);

const opened = await localFiles.load('');

if (opened.kind === 'template') {
  template = opened;
  designer.src = serializeSlipFile(opened);
}
```

> [!NOTE]
> `LocalFileStorage`는 파일 목록 조회와 삭제를 지원하지 않습니다.
> 따라서 디자이너의 `storage`로 전달하기보다 애플리케이션의 <kbd>파일 열기</kbd>와 <kbd>내려받기</kbd> 기능에서 직접 사용하는 것이 적합합니다.

외부에서 받은 `.slip` 파일은 사용하기 전에 항상 파싱과 검증을 거쳐야 합니다. `LocalFileStorage.load`는 내부에서 이 검증을 수행합니다.

## 발행된 전표 조회하기

발행된 전표는 `<slip-viewer>`에 전달해 읽기 전용으로 표시할 수 있습니다.

```ts
viewer.src = serializeSlipFile(issuedVoucher);
```

React:

```tsx
<SlipViewer src={serializeSlipFile(issuedVoucher)} />
```

Vue:

```vue
<SlipViewer :src="serializeSlipFile(issuedVoucher)" />
```

`<slip-viewer>`는 양식과 전표를 모두 표시할 수 있으며 파일을 변경하는 이벤트는 발생시키지 않습니다.

## 오류 처리

애플리케이션에서는 다음 실패를 구분해 처리하는 것이 좋습니다.

| 실패 | 처리 예 |
|---|---|
| 잘못된 `.slip` 파일 | 파일이 유효하지 않다는 안내 표시 |
| 서버 저장 실패 | 편집 내용이 저장되지 않았음을 표시하고 재시도 |
| 저장된 파일 없음 | 새 양식 또는 새 전표로 시작 |
| 파일 선택 취소 | 오류 알림 없이 기존 화면 유지 |
| 발행 실패 | 입력 화면을 유지하고 발행 오류 표시 |
| PDF 렌더링 실패 | 원본 `.slip` 파일을 유지하고 다시 시도 |

> [!CAUTION]
> 자동 저장이 실패했는데 성공한 것처럼 표시하지 마세요.
> 화면 상태와 서버 상태가 다를 수 있으므로 마지막 저장 성공 시각이나 저장 실패 상태를 사용자에게 보여주는 것이 좋습니다.

## 피해야 할 구현

- `slip-change`가 발생할 때마다 같은 작성폼의 `src` 갱신
- `storage` 프로퍼티를 자동 저장 기능으로 오해
- 작성 중 전표의 `values`만 저장
- 현재 양식과 다른 스냅샷을 가진 전표를 확인 없이 이어 쓰기
- `issued: true`를 전자서명이나 위변조 방지로 해석
- 서버에서 받은 `.slip` JSON을 검증하지 않고 사용
- 저장 실패를 무시하고 성공 상태 표시
- 발행 전표를 원본 양식 변경에 맞춰 자동 수정

## 통합 확인 목록

- [ ] 디자이너의 `slip-change`에서 양식을 받습니다.
- [ ] 작성폼의 `slip-change`에서 작성 중 전표를 받습니다.
- [ ] 작성폼의 `slip-issue`에서 발행된 전표를 받습니다.
- [ ] 양식과 전표를 서로 다른 상태 또는 저장 키로 관리합니다.
- [ ] 자동 저장 요청을 적절히 지연합니다.
- [ ] 발행 이벤트는 즉시 저장합니다.
- [ ] 작성 중 전표를 이어 쓰기 전에 양식 스냅샷을 확인합니다.
- [ ] 외부와 주고받는 `.slip` 파일을 검증합니다.
- [ ] 저장 실패와 렌더링 실패를 사용자에게 표시합니다.
- [ ] 발행된 전표를 뷰어에서 읽기 전용으로 표시합니다.

## 관련 문서

- [시작하기](getting-started.md)
- [양식 디자이너 사용 가이드](designer.md)
- [Core API 가이드](core.md)
- [수식 함수 참조](formula.md)
