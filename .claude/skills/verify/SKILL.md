---
name: verify
description: SlipKit 검증 게이트를 실행합니다. 커밋 전 확인 또는 사용자가 검증을 요청할 때 사용합니다.
allowed-tools:
  - "Bash(pnpm verify)"
  - "Bash(pnpm --filter @omdc-slipkit/core generate:schemas)"
---

`pnpm verify`를 실행하고 결과를 보고합니다.

검증 단계와 실행 순서는 루트 `package.json`의 `verify` 스크립트에서 관리합니다.
이 스킬에는 같은 순서를 다시 적지 않습니다.

빌드를 타입 검사보다 먼저 실행하는 이유는 패키지 사이의 타입이 빌드 산출물(`dist/index.d.ts`)을
통해 연결되기 때문입니다. 새 export는 빌드 전에는 소비 패키지에서 확인할 수 없습니다.

- 모든 단계가 통과해야 커밋할 수 있습니다. 실패하면 원인을 수정하며, 시험을 건너뛰거나
  삭제하거나 기준을 완화해서 통과시키지 않습니다.
- `.slip` 스키마를 변경한 경우 `pnpm --filter @omdc-slipkit/core generate:schemas`를 추가 실행하고
  `packages/core/schemas/`의 변경 내역을 확인해 산출물이 커밋에 포함됐는지 검사합니다.
- 단계별 통과 여부와 패키지별 시험 수를 보고합니다.
