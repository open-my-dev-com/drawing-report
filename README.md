# Voucher Package Tool (가칭)

UI로 전표(양식 문서)를 쉽게 만들고, 보고, 출력할 수 있는 **임베드형 패키지 툴**.

외부 프로젝트가 이 패키지를 설치(install)하면 자신의 앱 안에서 전표 양식을 디자인하고,
데이터를 채워 전표를 발행·조회·인쇄·PDF 출력할 수 있다.

## 핵심 성격

- **범용 양식 엔진**: 거래명세서·청구서 같은 문서형 전표부터 회계 분개 전표까지, 양식(템플릿)으로 표현
- **일반 사용자용 GUI 디자이너**: 비개발자가 드래그앤드롭으로 양식을 직접 설계
- **어느 스택에서든 동작**: Web Component 기반 배포 + React/Vue 얇은 래퍼
- **인쇄·PDF 1급 지원**: 용지(A4 등) 기준 레이아웃, 화면 = 인쇄 = PDF 픽셀 일치
- **파일로 완결**: 전표는 JSON 기반 자체 스키마 파일로 저장, 위변조 방지 서명 내장

## 문서

| 문서 | 내용 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 확정된 요구사항 정리 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 설계 결정 로그(ADR) — 각 결정의 근거와 배경 |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | 아직 결정되지 않은 사항 목록 |

> **문서 운영 규칙**: 새로운 설계 결정은 반드시 DECISIONS.md에 추가하고,
> 기존 결정과 모순되는 변경은 기존 결정을 "Superseded"로 표시한 뒤 새 결정으로 기록한다.
> REQUIREMENTS.md는 항상 DECISIONS.md와 정합해야 한다.
