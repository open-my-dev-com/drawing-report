---
paths:
  - "packages/core/**"
---

# @omdc-slipkit/core 규칙

- `@omdc-slipkit/core`는 순수 TypeScript로 유지합니다. `window`, `document`, DOM API, 브라우저 전역,
  프레임워크 API를 사용하지 않습니다(ADR-002). Node.js 전용 API도 라이브러리 코드에서는 사용하지
  않으며 `scripts/`와 테스트만 예외로 둡니다.
- **`eval`, `new Function`, 문자열로 경로를 조합한 동적 import를 사용하지 않습니다.** 수식은
  `src/formula/`의 자체 파서로만 처리합니다(ADR-010). 수식 함수는 ADR로 확정된
  `formula/functions.ts` 목록에만 추가합니다.
- `.slip` 타입은 `src/format/schema.ts`의 Zod 스키마에서 `z.infer`로 생성합니다.
  `types.ts`는 재수출에만 사용하며 인터페이스를 다시 정의하지 않습니다.
- `.slip` 스키마를 변경할 때는 다음 작업을 함께 수행합니다.
  1. `docs/SPEC.md` 갱신(SPEC이 규범이므로 구현과 어긋나면 SPEC을 우선합니다.)
  2. `src/format/version.ts`의 `CURRENT_SCHEMA_VERSION` 상향
  3. `src/format/migrate.ts`에 이전 버전에서 현재 버전으로 변환하는 단계와 관련 시험 추가
  4. JSON Schema 재생성: `pnpm --filter @omdc-slipkit/core build && pnpm --filter @omdc-slipkit/core generate:schemas`,
     `schemas/` 산출물 커밋
- **pdfme는 외부에 공개하지 않습니다**(ADR-016). pdfme 타입과 API를 공개 API인 `src/index.ts`
  export에 포함하지 않습니다. pdfme 의존성은 렌더러 인터페이스 구현 내부에서만 사용하고,
  변환 계층에서 스타일 기본값을 반드시 병합합니다. pdfme 테이블은 스타일 속성이 불완전하면
  렌더링이 실패할 수 있습니다(Q08).
- 사용자 대면 오류 메시지는 영역별 메시지 사전(`formula/messages.ts`·`format/messages.ts`·
  `layout/messages.ts`·`render/messages.ts`·`encryption/messages.ts`)에 영어·한국어·일본어로 작성합니다.
  영어를 기본 언어로 사용하고 로케일에 따라 전환합니다(ADR-060). 사용자 대면 메시지를 다른 소스에
  직접 작성하지 않습니다.
