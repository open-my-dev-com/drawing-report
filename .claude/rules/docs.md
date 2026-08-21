---
paths:
  - "docs/**"
---

# 문서 규칙

- **DECISIONS.md**: 새 설계 결정은 다음 ADR 번호로 추가. 기존 결정 번복은 삭제하지 않고
  `Superseded by ADR-xxx` 표시 후 새 ADR 작성. DECISIONS와 REQUIREMENTS가 어긋나면 DECISIONS 우선.
- **REQUIREMENTS.md**: ADR 추가·변경 시 함께 갱신해 일치하도록 유지한다.
- **OPEN-QUESTIONS.md**: 새 쟁점은 다음 Q 번호로 추가하고, 사용자 확인 전에는 결정처럼 쓰지 않는다.
  해결된 쟁점은 삭제하지 않고 취소선 + 해결 ADR 링크.
- **SPEC.md**: `.slip` 포맷의 공개 규범 — 구현(`@omdc-slipkit/core`)과 어긋나면 SPEC이 우선.
  포맷 변경 시 Zod 스키마·마이그레이션·JSON Schema와 함께 갱신 (core 규칙 참조).
- **ROADMAP.md**: 작업 완료 시 현재 상태·다음 작업을 갱신한다 (세션 인수인계 문서).
- 문서는 한국어로 작성하고 상단의 "최종 갱신" 날짜를 유지한다.
