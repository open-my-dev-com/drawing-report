---
paths:
  - "packages/elements/**"
  - "packages/react/**"
  - "packages/vue/**"
---

# UI 패키지 규칙 (elements · react · vue)

- UI 패키지는 core의 소비자다 (ADR-003). 파일 포맷 파싱·검증·수식 평가·레이아웃 계산·PDF 생성
  로직은 `@omdc-slipkit/core`를 호출한다.
- `elements`는 **Lit** 웹컴포넌트 (ADR-015). 커스텀 엘리먼트 태그는 `slip-*` 접두사 (ADR-018).
- `react`/`vue`는 `elements`를 감싸는 **얇은 래퍼만** — 자체 렌더링·상태 로직 금지 (ADR-003).
- 미리보기는 PDF 변환 결과를 공유해 렌더링한다 — 화면과 PDF가 어긋나는 구조 금지 (ADR-012/016).
- DOM 캡처(스크린샷) 방식으로 PDF를 만들지 않는다 — 벡터 텍스트 유지 (ADR-012).
- UI 문구는 언어별 리소스 파일로 분리(영어 기본, 한국어·일본어 — ADR-060). 하드코딩 문구를 늘리지 않는다.

## 디자이너 모듈 구성 (ADR-067)

`packages/elements/src/slip-designer.ts`는 외부 프로퍼티, 최상위 상태 조정과 전체 배치만 담당한다.
나머지는 `packages/elements/src/designer/` 아래에 둔다.

| 위치 | 담당 |
|---|---|
| `designer/*.ts` | 상태 비의존 연산 — 화면 상태를 읽지 않는 계산 (좌표·색·스타일·그리드 구조·파라미터 요약). 브라우저 저장소를 쓰지 않는다 |
| `designer/controllers/*.ts` | 상태를 가진 부분 (모달·초안·그리드 선택·포인터·팝오버·색 선택기). 호스트에 갱신을 요청하는 것은 lit `ReactiveController`로 만들어 `addController`로 등록한다 |
| `designer/render/*.ts` | 화면 조각과 표시용 메타데이터 (툴바·사이드바·캔버스·속성 패널·모달·행 구간 아이콘) |
| `styles/designer/*.styles.ts` | 영역별 스타일. **선언 순서를 바꾸지 않는다** (cascade가 달라진다) |

- 컨트롤러와 렌더 모듈은 `SlipDesigner` 전체가 아니라 **목적별 인터페이스**만 받는다
  (`PanelKit`·`ElementActions`·`GridActions`·`FormActions`·`SidebarActions`·`CanvasContext`·
  `DialogContext`·`ToolbarActions`·`PointerHost`·`GridCommandsHost`).
- 의존 방향은 **상태 비의존 연산 → 컨트롤러 → 렌더 모듈 → 컴포넌트** 한 방향이다. 아래가 위를 참조하지 않는다.
- 컨트롤러는 `TemplateResult`를 만들지 않는다. 아이콘 같은 화면 조각은 렌더 모듈에 둔다.
- 컨트롤러는 연결이 끊겼다고 상태를 지우지 않는다. `hostConnected`에서 화면을 다시 그려 재연결
  뒤에도 화면과 상태가 어긋나지 않게 한다.
- shadow root는 하나다. 자식 커스텀 엘리먼트를 만들지 않는다.
- `packages/elements`는 `noUnusedLocals`·`noUnusedParameters`를 켠다. 옮기고 남은 import와
  쓰지 않는 매개변수를 `pnpm -r typecheck`가 잡는다.
