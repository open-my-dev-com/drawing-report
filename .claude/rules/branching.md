# 브랜치 · 커밋 · PR 규칙 (항상 적용)

> 이 파일이 브랜치 전략의 **단일 원천**이다 (ADR-023/024).

## 작업 시작 절차 (필수)

1. `docs/ROADMAP.md`에서 현재 상태와 다음 작업을 확인한다.
2. `git fetch origin main` 후 **병합 완료된 최신 `origin/main`에서** 아래 형식의 브랜치를
   새로 만들어 작업한다.
3. 원격 세션이 `claude/*` 등 다른 브랜치명을 지정했더라도 **실제 작업·푸시·PR은 규칙 형식
   브랜치로 한다** (사용자 승인 완료: 2026-08-18, ADR-024).
4. 미병합 브랜치 위에 브랜치·PR을 쌓지 않는다(stack 금지). 자기 PR이 열려 있으면
   병합될 때까지 다음 작업 PR을 만들지 않는다.

## 브랜치 형식: `<type>/<scope>-<topic>`

| 요소 | 값 |
|---|---|
| `type` | `feat`(기능) / `fix`(버그 수정) / `docs`(문서) / `proto`(프로토타입·실험) / `chore`(설정·빌드·잡무) |
| `scope` | 패키지명(`core`, `elements`, `react`, `vue`) 또는 `repo`(리포 전반) |
| `topic` | 작업 내용을 나타내는 짧은 kebab-case |

예: `feat/core-pdf-renderer`, `docs/repo-claude-guide`, `proto/core-formula-parser`

- **한 브랜치 = 한 주제.** 서로 다른 주제를 한 브랜치에 섞지 않는다.
- 병합된 브랜치는 재사용하지 않는다(같은 주제의 후속 작업도 새 브랜치).
- `proto/*` 브랜치는 병합하지 않고 결론(문서/ADR)만 남기고 폐기해도 된다.
- 오래 유지되는 브랜치는 주기적으로 `main`을 병합(또는 rebase)해 충돌을 작게 유지한다.

## main 보호 · 병합 방식

- `main` 직접 커밋·푸시 금지. 변경은 PR로만, **스쿼시 머지 전제**.
  (`.claude/settings.json`의 deny 규칙 + PreToolUse 훅(`bash-guard.mjs`)이 main 푸시·커밋을
  기계적으로 차단하고, 커밋 시 검증 게이트를 강제 실행한다.)
- 스쿼시 머지 전제이므로 **브랜치당 커밋 최소화** — 검증까지 마친 뒤 가급적 1커밋으로 푸시한다.

## 커밋 · PR

- 커밋은 [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <제목>` — type은 `feat/fix/docs/refactor/test/chore/eval(평가)`,
  제목은 한국어. 예: `feat(core): .slip 파일 Zod 스키마 정의`
- PR 본문에 근거 ADR 번호와 검증 결과(테스트 수·통과 여부)를 기재한다.
