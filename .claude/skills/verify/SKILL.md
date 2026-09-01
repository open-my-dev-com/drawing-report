---
name: verify
description: SlipKit 검증 게이트를 실행한다. 커밋 전 확인 또는 사용자가 검증을 요청할 때 사용.
allowed-tools:
  - "Bash(pnpm verify)"
  - "Bash(pnpm --filter @omdc-slipkit/core generate:schemas)"
---

`pnpm verify`를 실행하고 결과를 보고한다.

검증 단계와 실행 순서는 루트 `package.json`의 `verify` 스크립트에서 관리합니다.
이 스킬에는 같은 순서를 다시 적지 않습니다.

build가 typecheck보다 앞에 있는 이유는, 패키지 사이 타입이 빌드 산출물(`dist/index.d.ts`)로
이어져 있어 새 export가 build 전에는 소비 패키지에 보이지 않기 때문이다.

- 통과해야 커밋 가능 상태다. 실패하면 원인을 고친다 —
  실패하는 테스트를 스킵·삭제·완화로 통과시키지 않는다.
- `.slip` 스키마를 변경한 경우 `pnpm --filter @omdc-slipkit/core generate:schemas`를 추가 실행하고
  `packages/core/schemas/`의 diff를 확인해 산출물이 커밋에 포함됐는지 검사한다.
- 보고 형식: 단계별 통과 여부 + 패키지별 테스트 수.
