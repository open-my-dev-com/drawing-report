---
paths:
  - "packages/elements/**"
  - "packages/react/**"
  - "packages/vue/**"
---

# UI 패키지 규칙(elements·react·vue)

- UI 패키지는 core를 사용합니다(ADR-003). 파일 형식 파싱과 검증, 수식 평가, 레이아웃 계산,
  PDF 생성은 `@omdc-slipkit/core`를 호출해 처리합니다.
- `elements`는 **Lit** 웹 컴포넌트입니다(ADR-015). 커스텀 엘리먼트 태그에는 `slip-*` 접두사를
  사용합니다(ADR-018).
- `react`와 `vue`는 `elements`를 감싸는 얇은 래퍼만 제공합니다. 자체 렌더링이나 상태 로직을
  구현하지 않습니다(ADR-003).
- 미리보기는 PDF 변환 결과를 사용해 렌더링합니다. 화면과 PDF가 서로 다른 렌더링 구조를 사용하지
  않습니다(ADR-012/016).
- DOM을 캡처한 스크린샷으로 PDF를 만들지 않으며 벡터 텍스트를 유지합니다(ADR-012).
- UI 문구는 영어·한국어·일본어 리소스 파일로 관리하며 영어를 기본값으로 사용합니다(ADR-060).
  사용자 대면 문구를 컴포넌트에 직접 작성하지 않습니다.

## 디자이너 모듈 구성 (ADR-067)

`packages/elements/src/slip-designer.ts`는 외부 프로퍼티, 최상위 상태 관리와 전체 배치만 담당합니다.
나머지 코드는 `packages/elements/src/designer/` 아래에 둡니다.

| 위치 | 담당 |
|---|---|
| `designer/*.ts` | 화면 상태와 무관한 계산을 둡니다. 좌표, 색, 스타일, 그리드 구조, 파라미터 요약, 수식 계산 문맥과 검사가 해당하며 브라우저 저장소는 사용하지 않습니다. |
| `designer/controllers/*.ts` | 모달, 초안, 그리드 선택, 포인터, 팝오버와 색 선택기의 상태를 관리합니다. 화면 갱신이 필요한 컨트롤러는 Lit의 `ReactiveController`로 만들어 `addController`로 등록합니다. |
| `designer/render/*.ts` | 툴바, 사이드바, 캔버스, 속성 패널, 모달과 행 구간 아이콘처럼 화면에 표시할 내용을 만듭니다. |
| `styles/designer/*.styles.ts` | 영역별 스타일을 둡니다. CSS 적용 순서가 달라지므로 선언 순서를 바꾸지 않습니다. |

- 컨트롤러와 렌더 모듈은 `SlipDesigner` 전체가 아니라 **목적별 인터페이스**만 받습니다.
  (`PanelKit`·`ElementActions`·`GridActions`·`FormActions`·`SidebarActions`·`CanvasContext`·
  `DialogContext`·`ToolbarActions`·`PointerHost`·`GridCommandsHost`).
- 의존 방향은 **화면 상태와 무관한 계산 → 컨트롤러 → 렌더 모듈 → 컴포넌트** 한 방향으로 유지합니다.
  뒤에 있는 계층에서 앞 계층을 참조하며, 앞 계층은 뒤 계층을 참조하지 않습니다.
- 컨트롤러는 `TemplateResult`를 만들지 않습니다. 아이콘처럼 화면에 표시할 내용은 렌더 모듈에 둡니다.
- 수식·조건식의 계산 문맥은 `designer/formula-context.ts`, 검사는 `designer/formula-check.ts`
  한 곳만 사용합니다(ADR-068). 캔버스, 인라인 입력, 수식 모달에서 계산 문맥을 따로 만들지 않습니다.
- 연결을 해제할 때 컨트롤러 상태를 초기화하지 않습니다. `hostConnected`에서 화면을 다시 그려
  재연결 후에도 화면과 상태가 일치하도록 합니다.
- shadow root는 하나만 사용하며 자식 커스텀 엘리먼트를 만들지 않습니다.
- `tsconfig.base.json`은 모든 패키지와 예제에 `noUnusedLocals`와 `noUnusedParameters`를 적용합니다.
  모듈을 분리한 뒤 남은 미사용 import와 매개변수는 `pnpm -r typecheck`로 확인합니다.
