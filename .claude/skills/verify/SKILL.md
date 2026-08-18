---
name: verify
description: SlipKit 검증 게이트를 실행한다 (전 패키지 typecheck·build·test). 커밋 전 확인 또는 사용자가 검증을 요청할 때 사용.
allowed-tools:
  - "Bash(pnpm -r typecheck)"
  - "Bash(pnpm -r build)"
  - "Bash(pnpm -r test)"
  - "Bash(pnpm --filter @slipkit/core generate:schemas)"
---

검증 게이트를 순서대로 실행하고 결과를 보고한다:

1. `pnpm -r typecheck`
2. `pnpm -r build`
3. `pnpm -r test`

- 세 단계 전부 통과해야 커밋 가능 상태다. 실패하면 원인을 고친다 —
  실패하는 테스트를 스킵·삭제·완화로 통과시키지 않는다.
- `.slip` 스키마를 변경한 경우 `pnpm --filter @slipkit/core generate:schemas`를 추가 실행하고
  `packages/core/schemas/`의 diff를 확인해 산출물이 커밋에 포함됐는지 검사한다.
- 보고 형식: 단계별 통과 여부 + 패키지별 테스트 수.
