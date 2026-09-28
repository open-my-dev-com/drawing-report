# IF-008 React와 Vue 래퍼

최종 갱신: 2026-09-28

## 개요

React와 Vue 애플리케이션에서 SlipKit Web Component를 프레임워크 속성·이벤트·참조 모델에 맞게
사용하는 계약을 정의합니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | 두 프레임워크 래퍼의 속성, 이벤트, 참조와 기본값 복원 계약을 정의했습니다. |

## 공통 원칙

래퍼는 `SlipViewer`, `SlipDesigner`, `SlipForm`을 제공하며 도메인 기능을 다시 구현하지 않습니다.
`@omdc-slipkit/elements`를 불러와 사용자 정의 요소를 등록하고 JavaScript 프로퍼티와 CustomEvent를
프레임워크 방식으로 연결합니다.

선택형 설정을 생략하면 요소에 쓰지 않습니다. 전달했던 설정을 제거하면 최초 마운트 때 읽은 요소의
기본값으로 되돌립니다. 따라서 `maxImageBytes` 같은 숫자 기본값이 `undefined`나 `0`으로 바뀌지
않습니다.

## React 계약

| 래퍼 입력 | 요소 연결 |
| --- | --- |
| `src`, `locale`, `slipkit` | 같은 이름의 요소 프로퍼티 |
| `settings`, `presets`, `storage`, `maxImageBytes` | 디자이너 전용 프로퍼티 |
| `onSlipChange`, `onSlipIssue` | CustomEvent의 `detail.file`을 받는 콜백 |
| `ref` | 실제 `slip-*` 요소 |

표준 HTML 속성과 DOM 이벤트를 호스트 요소에 전달하되 `children`과 `dangerouslySetInnerHTML`은
지원하지 않습니다. `className`은 `class` 속성으로 변환합니다. 전용 속성은 전개한 속성보다
우선합니다.

## Vue 계약

Vue 래퍼는 같은 설정을 props로 받고 `slip-change`, `slip-issue`를 Vue 이벤트로 내보냅니다.
컴포넌트 ref는 Vue 컴포넌트 인스턴스이며 `$el`이 실제 `slip-*` 요소를 가리킵니다. 발행 뒤
`formRef.value.$el.reset()`으로 같은 양식의 새 전표를 시작할 수 있습니다.

Vue가 선언하지 않은 `class`, `style`, `id`, `aria-*`, `data-*`, `tabindex`와 DOM 이벤트는 루트
사용자 정의 요소로 전달됩니다.

## 생명주기와 오류

React는 layout effect로 설정을 첫 화면 전에 적용하고 effect로 이벤트를 연결·해제합니다. Vue는
`watchPostEffect`로 반응형 props를 요소에 반영합니다. 래퍼는 내부 요소의 파싱·렌더링 오류를 별도
형식으로 바꾸지 않습니다.

## 호환성 경계

React 19 이상, Vue 3.4 이상을 peer dependency로 사용합니다. 래퍼의 공개 계약은 export된 컴포넌트와
React props 타입입니다. Vue 내부의 `$el`은 Vue 표준 동작으로 접근하며 별도 도메인 메서드를 래퍼에
복제하지 않습니다.

## 관련 설계와 근거

- 인터페이스: IF-004~IF-007
- 화면: SCR-001·SCR-014·SCR-015
- `packages/react/src/index.tsx`
- `packages/vue/src/index.ts`
- [ADR-003](../../DECISIONS.md)
