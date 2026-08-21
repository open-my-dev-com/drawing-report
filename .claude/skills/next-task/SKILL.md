---
name: next-task
description: SlipKit 로드맵의 다음 작업을 브랜치 규칙(.claude/rules/branching.md·ADR-024)에 맞춰 시작한다. 사용자가 "다음 작업 진행", "로드맵 진행"을 요청할 때 사용.
---

로드맵의 다음 작업을 시작할 때 따르는 절차:

1. `git fetch origin main` 후 `docs/ROADMAP.md`에서 현재 상태와 다음 작업을 확인한다.
2. 열려 있는 자기 PR이 있는지 확인한다. 있으면 새 작업을 시작하지 않고 사용자에게
   병합 대기 중임을 보고한다 (PR 스택 금지, ADR-024).
3. 병합 완료된 최신 `origin/main`에서 규칙 형식(`<type>/<scope>-<topic>`)의 브랜치를 새로 만든다.
4. 작업 범위는 로드맵 항목 하나로 한정한다 (한 브랜치 = 한 주제). 새 설계 쟁점이 생기면
   `docs/OPEN-QUESTIONS.md`에 추가하고 사용자 확인으로 확정한다.
5. 구현 후 검증 게이트(`pnpm lint && pnpm -r typecheck && pnpm -r build && pnpm -r test`)를 통과시킨다.
6. `docs/ROADMAP.md` 갱신을 포함해 1커밋으로 정리한다. 커밋 제목은 한국어
   Conventional Commits (`<type>(<scope>): 제목`).
7. 푸시 후 PR을 만든다. PR 제목·본문은 `.claude/rules/branching.md`의 커밋·PR 규칙을 따른다.
