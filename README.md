# SlipKit

UI로 전표(양식 문서)를 쉽게 만들고, 보고, 출력할 수 있는 **임베드형 패키지 툴**.

외부 프로젝트가 이 패키지를 설치(install)하면 자신의 앱 안에서 전표 양식을 디자인하고,
데이터를 채워 전표를 발행·조회·인쇄·PDF 출력할 수 있다.

- npm 스코프: `@omdc-slipkit/*` (`core` / `elements` / `react` / `vue`)
- 파일 확장자: `.slip`
- 커스텀 엘리먼트: `<slip-designer>`, `<slip-form>`, `<slip-viewer>` 등

## 핵심 성격

- **범용 양식 엔진**: 거래명세서·청구서 같은 문서형 전표부터 회계 분개 전표까지, 양식(템플릿)으로 표현
- **일반 사용자용 GUI 디자이너**: 비개발자가 드래그앤드롭으로 양식을 직접 설계 (셀 병합·색 스타일·undo 지원)
- **어느 스택에서든 동작**: Web Component(Lit) 기반 배포 + React/Vue 얇은 래퍼
- **인쇄·PDF 1급 지원**: 용지(A4 등) 기준 레이아웃, 화면 = 인쇄 = PDF 일치. PDF 엔진은 pdfme(직접 검증 완료, 외부 비공개)
- **파일로 완결**: 전표는 JSON 기반 `.slip` 파일로 저장 — 양식 스냅샷 내장, SHA-256 해시 필수 + JWS 서명 옵션

## 로컬에서 바로 보기 (데모)

별도 서버 없이 전부 브라우저 안에서 동작한다. 클론 후:

```bash
pnpm install
pnpm demo         # 바닐라 → http://localhost:5173
pnpm demo:react   # React  → http://localhost:5174
pnpm demo:vue     # Vue    → http://localhost:5175
```

양식 만들기(요소 추가·드래그·스냅·표·도형·수식·샘플 데이터·내 양식 저장)와
전표 쓰기(값 입력·수식 즉시 계산·발행)를 한 화면에서 오가며 만져볼 수 있다.
편집 내용은 브라우저에 자동 저장되어 새로고침해도 이어서 작업할 수 있고,
파일로 내려받기·열기로 `.slip` 파일을 주고받을 수 있다.
데모는 라이브러리 소스를 직접 참조하므로 코드를 고치면 새로고침 없이 바로 반영된다.

**데모 3종은 기능이 같고 붙이는 방법만 다르다** — 쓰는 프레임워크에 맞는 예시를 골라 보면 된다.

| 예시 | 붙이는 방법 |
|---|---|
| [`examples/demo`](examples/demo) | 커스텀 엘리먼트를 그대로 (`<slip-designer>`·`<slip-form>`) |
| [`examples/react-demo`](examples/react-demo) | `@omdc-slipkit/react` 래퍼 컴포넌트 + 훅 |
| [`examples/vue-demo`](examples/vue-demo) | `@omdc-slipkit/vue` 래퍼 컴포넌트 + SFC |

무엇을 저장하고 언제 이어 쓰는지 같은 **화면과 무관한 로직은
[`examples/shared`](examples/shared)** 한곳에 두고 세 데모가 함께 쓴다.

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 개발 규칙 — 모든 Claude Code 세션에 자동 적용 (ADR-024) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 로드맵 · 세션 인수인계 — 현재 상태와 다음 작업 |
| [docs/SPEC.md](docs/SPEC.md) | `.slip` 파일 포맷 공개 규범 명세 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 아키텍처 — 외부 시스템 연계 (다이어그램 포함) |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 확정된 요구사항 정리 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 설계 결정 로그(ADR-001~031) — 각 결정의 근거와 배경 |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | 미결 사항 목록 (현재 전부 해결됨) |
| [.claude/rules/branching.md](.claude/rules/branching.md) | 브랜치·커밋·PR 규칙 — 모든 작업은 이 규칙대로 분기 (ADR-023/024) |
| [docs/Q08-PDFME-EVAL.md](docs/Q08-PDFME-EVAL.md) | pdfme 평가 보고서 |
| [docs/TECH-RESEARCH.md](docs/TECH-RESEARCH.md) | 기술 동향 리서치 (2026-08) |

> **문서 운영 규칙**: 새로운 설계 결정은 반드시 DECISIONS.md에 추가하고,
> 기존 결정과 모순되는 변경은 기존 결정을 "Superseded"로 표시한 뒤 새 결정으로 기록한다.
> REQUIREMENTS.md는 항상 DECISIONS.md와 일치해야 한다.
