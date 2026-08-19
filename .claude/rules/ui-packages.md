---
paths:
  - "packages/elements/**"
  - "packages/react/**"
  - "packages/vue/**"
---

# UI 패키지 규칙 (elements · react · vue)

- **UI는 core의 소비자일 뿐이다** (ADR-003): 파일 포맷 파싱·검증·수식 평가·레이아웃 계산·PDF 생성
  로직을 UI 패키지에 구현하지 않는다. 반드시 `@omdc-slipkit/core`를 호출한다.
- `elements`는 **Lit** 웹컴포넌트 (ADR-015). 커스텀 엘리먼트 태그는 `slip-*` 접두사 (ADR-018).
- `react`/`vue`는 `elements`를 감싸는 **얇은 래퍼만** — 자체 렌더링·상태 로직 금지 (ADR-003).
- 미리보기는 PDF 변환 결과를 공유해 렌더링한다 — 화면과 PDF가 어긋나는 구조 금지 (ADR-012/016).
- DOM 캡처(스크린샷) 방식의 PDF 생성 금지 — 벡터 텍스트 유지 (ADR-012).
- UI 문구는 리소스 파일로 분리(한국어 우선, ADR-013). 하드코딩 문구를 늘리지 않는다.
