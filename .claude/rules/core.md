---
paths:
  - "packages/core/**"
---

# @omdc-slipkit/core 규칙

- `@omdc-slipkit/core`는 순수 TS다. `window`·`document`·DOM API·브라우저 전역·프레임워크 API 사용 금지 (ADR-002).
  Node 전용 API도 라이브러리 코드에는 금지 (scripts/·테스트는 예외).
- **`eval`·`new Function`·문자열 동적 import 절대 금지.** 수식은 `src/formula/`의 자체 파서만 사용 (ADR-010).
  수식 함수 추가는 ADR로 확정된 목록(`formula/functions.ts`) 안에서만.
- `.slip` 타입은 `src/format/schema.ts`의 Zod 스키마에서 `z.infer`로 산출한다.
  `types.ts`는 재수출 전용 — 인터페이스를 손으로 다시 정의하지 않는다.
- `.slip` 스키마 변경 시 함께 처리한다:
  1. `docs/SPEC.md` 갱신 (SPEC이 규범 — 구현과 어긋나면 SPEC 우선)
  2. `src/format/version.ts`의 `CURRENT_SCHEMA_VERSION` 상향
  3. `src/format/migrate.ts`에 이전 버전으로부터의 마이그레이션 단계 추가 + 테스트
  4. JSON Schema 재생성: `pnpm --filter @omdc-slipkit/core build && pnpm --filter @omdc-slipkit/core generate:schemas`,
     `schemas/` 산출물 커밋
- **pdfme 외부 비공개** (ADR-016): pdfme 타입·API를 공개 API(`src/index.ts` 수출)에 노출 금지.
  pdfme 의존은 렌더러 인터페이스 구현 내부에만 두고, 변환 계층에서 스타일 기본값 병합 필수
  (pdfme 테이블은 스타일 속성이 불완전하면 렌더가 깨질 수 있음 — Q08).
- 사용자 대면 오류 메시지는 한국어 (`SlipParseError` 등 기존 스타일 참조).
