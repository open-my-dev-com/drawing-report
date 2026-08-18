# SlipKit (drawing-report) — 개발 규칙

UI로 전표 양식을 만들고 채워서 인쇄·PDF 출력하는 임베드형 패키지(`@slipkit/*`).
pnpm 모노레포: `packages/core`(순수 TS) · `elements`(Lit) · `react` · `vue`.

이 파일과 `.claude/rules/`의 규칙은 **모든 Claude Code 세션에 강제 적용**된다 (ADR-024).
로드맵도 함께 로드된다:

@docs/ROADMAP.md

## 용어

- 규칙에 붙은 **`ADR-xxx`는 `docs/DECISIONS.md`에 기록된 설계 결정 번호**다(결정 내용·근거·기각된
  대안). 규칙을 적용하다 결정의 배경이 필요하면 해당 번호를 DECISIONS.md에서 찾아 읽는다.

## 규칙 위치

- **브랜치·커밋·PR·작업 시작 절차**: `.claude/rules/branching.md` (항상 적용, 단일 원천)
- **패키지·문서별 상세 규칙** (해당 경로 작업 시 자동 적용): `.claude/rules/core.md`(순수 TS·
  eval 금지·Zod 단일 원천·스키마 변경 체크리스트·pdfme 은닉) · `ui-packages.md`(Lit·`slip-*`·
  얇은 래퍼) · `docs.md`(ADR·SPEC 일관성)

## 문서 규칙

- 새 설계 결정 → `docs/DECISIONS.md`에 ADR 추가. 기존 결정 번복은 삭제하지 않고
  `Superseded by ADR-xxx` 표시 후 새 ADR 추가.
- `docs/REQUIREMENTS.md`는 항상 DECISIONS.md와 일치하도록 함께 갱신한다.
- 새 쟁점은 임의로 결정하지 말고 `docs/OPEN-QUESTIONS.md`에 Q-09부터 추가하고 사용자에게 확인한다.
- 작업 완료 시 `docs/ROADMAP.md`의 현재 상태·다음 작업을 갱신한다.

## 코드 불변 규칙 (경로 무관)

- 수식은 자체 파서만 사용. `eval`·`new Function` 절대 금지 (ADR-010).
- `@slipkit/core`는 순수 TS — DOM·브라우저·프레임워크 API 의존 금지 (ADR-002).
- pdfme 타입·API를 공개 API에 노출 금지 (ADR-016).

## 검증 게이트 (커밋 전 필수)

- `pnpm -r typecheck && pnpm -r build && pnpm -r test` 전부 통과한 상태에서만 커밋한다.
  (PreToolUse 훅이 `git commit` 시 이 게이트를 자동 실행해 실패하면 커밋을 차단한다.)
- 실패하는 테스트를 스킵·삭제·완화로 통과시키지 않는다.
- `/verify`로 수동 실행, `/next-task`로 로드맵 다음 작업을 규칙대로 시작할 수 있다.

## 언어

- 문서·커밋 메시지·사용자 대면 오류 메시지는 한국어, 코드 식별자는 영어.
- 어색한 한자어를 쓰지 않는다 — 특히 **"정합(하다)" 금지**: 문맥에 따라 "일치한다",
  "부합한다", "어긋나지 않는다"를 쓴다.
