# SlipKit 사용 가이드

[English](README.en.md)

호스트 앱에 SlipKit을 설치하고 양식 디자이너·전표 작성폼·뷰어를 붙이는 방법을 설명한다.

## 목차

1. [설치](#1-설치)
2. [빠른 시작](#2-빠른-시작)
3. [컴포넌트 API](#3-컴포넌트-api)
4. [이벤트](#4-이벤트)
5. [저장소 어댑터](#5-저장소-어댑터)
6. [폰트 설정](#6-폰트-설정)
7. [언어 설정](#7-언어-설정)

### 관련 문서

- **[Core API 가이드](core.md)** — 파싱·수식·PDF 렌더링·무결성·서버 연계 (Node.js 단독 사용 포함)
- **[주요 타입 참조](types.md)** — `SlipFile`, 폰트, `SlipPreset`, `StorageAdapter`, `IntegrityJwk` 등 타입별 필드와 기본값
- **[동봉 폰트·프리셋](fonts-and-presets.md)** — Pretendard 폰트 상세, 동봉 프리셋(거래명세서·청구서)의 구성과 언어 처리

---

## 1. 설치

```bash
# 바닐라 (Web Component 직접 사용)
npm install @omdc-slipkit/elements

# React
npm install @omdc-slipkit/react
# peerDependency: react >= 19

# Vue
npm install @omdc-slipkit/vue
# peerDependency: vue >= 3.4
```

`@omdc-slipkit/core`는 elements·react·vue가 의존하므로 따로 설치하지 않아도 된다.
서버에서 core만 단독으로 쓸 때(Node에서 PDF 생성 등)만 직접 설치한다.

```bash
npm install @omdc-slipkit/core
```

## 2. 빠른 시작

### 바닐라 (Web Component)

```html
<script type="module">
  import '@omdc-slipkit/elements';
  import { serializeSlipFile } from '@omdc-slipkit/core';

  const designer = document.querySelector('slip-designer');

  // 변경 감지
  designer.addEventListener('slip-change', (e) => {
    const file = e.detail.file;  // SlipFile 객체
    console.log('양식이 바뀜:', file);
  });
</script>

<slip-designer src="{}"></slip-designer>
```

### React

```tsx
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/react';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';

function App() {
  const [template, setTemplate] = useState(initialTemplate);

  return (
    <SlipDesigner
      src={serializeSlipFile(template)}
      onSlipChange={(file) => {
        if (file.kind === 'template') setTemplate(file);
      }}
    />
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/vue';
import { serializeSlipFile, type SlipFile } from '@omdc-slipkit/core';
import { shallowRef } from 'vue';

const template = shallowRef(initialTemplate());
const src = computed(() => serializeSlipFile(template.value));

function onDesignerChange(file: SlipFile) {
  if (file.kind === 'template') template.value = file;
}
</script>

<template>
  <SlipDesigner :src="src" @slip-change="onDesignerChange" />
</template>
```

> Vue에서 `slip-` 접두사를 커스텀 엘리먼트로 인식하도록 빌드 설정을 추가하면 래퍼 없이
> `<slip-designer>`를 직접 써도 된다.

## 3. 컴포넌트 API

### `<slip-designer>` — 양식 디자이너

양식(template)을 시각적으로 편집하는 GUI 에디터.

| 속성 | 타입 | 설명 |
|---|---|---|
| `src` | `string` | `.slip` JSON 문자열 (template 파일) |
| `locale` | `'ko' \| 'en'` | UI 언어 (기본: `'ko'`) |
| `fonts` | `Font[]` | PDF 미리보기에 쓸 사용자 폰트 |
| `presets` | `SlipPreset[]` | 프리셋 메뉴에 쓸 양식 목록 — 지정하면 동봉 프리셋 대신 표시 |
| `storage` | `StorageAdapter` | "내 양식 저장·불러오기"에 쓸 저장소 어댑터 |

| 이벤트 | detail | 설명 |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | 편집으로 양식이 바뀔 때마다 발생 |

### `<slip-form>` — 전표 작성폼

양식에 값을 채우고 발행하는 입력 화면. 오른쪽에 채운 상태의 PDF 미리보기를 보여준다.

| 속성 | 타입 | 설명 |
|---|---|---|
| `src` | `string` | `.slip` JSON 문자열 (양식 또는 작성 중 전표) |
| `locale` | `'ko' \| 'en'` | UI 언어 (기본: `'ko'`) |
| `fonts` | `Font[]` | PDF 미리보기에 쓸 사용자 폰트 |
| `signingKey` | `IntegrityJwk` | 발행 시 서명에 쓸 ES256 개인키 (JWK). 없으면 해시만 기록 |

| 이벤트 | detail | 설명 |
|---|---|---|
| `slip-change` | `{ file: SlipFile }` | 값을 채울 때마다 작성 중 전표를 내보냄 |
| `slip-issue` | `{ file: SlipFile }` | 발행이 완료되면 무결성 기록이 담긴 전표를 내보냄 |

### `<slip-viewer>` — 뷰어

발행된 전표나 양식을 PDF로 렌더링해 보여주는 읽기 전용 뷰어.

| 속성 | 타입 | 설명 |
|---|---|---|
| `src` | `string` | `.slip` JSON 문자열 |
| `locale` | `'ko' \| 'en'` | UI 언어 (기본: `'ko'`) |
| `fonts` | `Font[]` | PDF 렌더링에 쓸 사용자 폰트 |

## 4. 이벤트

컴포넌트가 보내는 이벤트는 `CustomEvent`이며 `detail.file`에 현재 `.slip` 파일 객체가 담긴다.
**호스트 앱은 이 이벤트로 컴포넌트 안의 데이터를 받는다** — 컴포넌트가 직접 저장하지 않으므로,
이벤트를 받아 저장하지 않으면 편집 내용이 사라진다.

```ts
// 바닐라
designer.addEventListener('slip-change', (e) => {
  const file = e.detail.file;  // SlipFile
});

// React
<SlipDesigner onSlipChange={(file) => { /* SlipFile */ }} />

// Vue
<SlipDesigner @slip-change="(file) => { /* SlipFile */ }" />
```

### 이벤트 종류와 용도

| 이벤트 | 발생 시점 | 파일 종류 | 호스트 앱이 하는 일 |
|---|---|---|---|
| `slip-change` (디자이너) | 양식을 편집할 때마다 | `template` | 양식 자동 저장, 상태 동기화 |
| `slip-change` (작성폼) | 전표에 값을 채울 때마다 | `voucher` | 작성 중 전표 임시 저장 (새로고침 후 이어 쓰기) |
| `slip-issue` (작성폼) | 발행 버튼을 누르면 | `voucher` (무결성 기록 포함) | 발행 완료된 전표를 서버에 저장 |

### 활용 예시

```ts
// 디자이너: 양식이 바뀌면 서버에 저장
designer.addEventListener('slip-change', (e) => {
  const template = e.detail.file;
  fetch('/api/templates/' + templateId, {
    method: 'PUT',
    body: serializeSlipFile(template),
  });
});

// 작성폼: 발행이 끝나면 전표를 서버에 올린다
form.addEventListener('slip-issue', (e) => {
  const voucher = e.detail.file;
  fetch('/api/vouchers', {
    method: 'POST',
    body: serializeSlipFile(voucher),
  });
});
```

## 5. 저장소 어댑터

`StorageAdapter` 인터페이스를 구현하면 "내 양식 저장·불러오기" 기능을 쓸 수 있다.
elements 패키지에 브라우저용 구현 2종이 들어 있다.

### IndexedDB 저장소

브라우저의 IndexedDB에 양식을 저장한다. 제목·종류 필터와 커서 페이징을 지원한다.

```ts
import { IndexedDbStorage } from '@omdc-slipkit/elements';

const store = new IndexedDbStorage({ dbName: 'my-app-slips' });
```

### 로컬 파일 저장소

저장은 파일 다운로드, 열기는 파일 선택 대화 상자로 동작한다.

```ts
import { LocalFileStorage } from '@omdc-slipkit/elements';

const localFile = new LocalFileStorage();
await localFile.save('거래명세서.slip', file);  // 다운로드
const file = await localFile.load('');           // 파일 선택
```

### 직접 구현

서버 API로 양식을 관리하려면 `StorageAdapter` 인터페이스를 직접 구현하면 된다.

```ts
import type { StorageAdapter } from '@omdc-slipkit/core';

const serverStorage: StorageAdapter = {
  async save(key, file) { /* POST /api/slips */ },
  async load(key) { /* GET /api/slips/:key */ },
  async delete(key) { /* DELETE /api/slips/:key */ },
  async list(options?) { /* GET /api/slips?title=...&cursor=... */ },
};
```

## 6. 폰트 설정

SlipKit은 Pretendard Regular·Bold를 기본 폰트로 동봉한다. 폰트를 지정하지 않으면
자동으로 사용되어 한글이 깨지지 않는다.

사용자 폰트를 추가하려면 `fonts` 속성에 배열로 전달한다.

```ts
import pretendardFonts from '@omdc-slipkit/elements/fonts/pretendard';

// 동봉 폰트를 명시적으로 전달
designer.fonts = pretendardFonts;

// 사용자 폰트 추가
designer.fonts = [
  ...pretendardFonts,
  { name: 'NotoSans', data: notoSansArrayBuffer },
];
```

## 7. 언어 설정

UI 언어는 `locale` 속성으로 바꾼다. 기본값은 한국어(`'ko'`).

```html
<slip-designer locale="en"></slip-designer>
```

```tsx
<SlipDesigner src={src} locale="en" />
```

수식 함수의 결과 포맷(숫자 자릿수 구분 등)도 로케일에 따라 바뀐다.

서버에서 `.slip` 파일을 직접 다루거나 PDF를 만들어야 하면 **[Core API 가이드](core.md)**를 참고한다.
