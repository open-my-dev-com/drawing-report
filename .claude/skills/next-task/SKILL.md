---
name: next-task
description: SlipKit 로드맵의 다음 작업을 브랜치 규칙(.claude/rules/branching.md·ADR-024)에 맞춰 시작합니다. 사용자가 "다음 작업 진행", "로드맵 진행"을 요청할 때 사용합니다.
---

로드맵의 다음 작업을 시작할 때 다음 절차를 따릅니다.

1. `git fetch origin main`을 실행한 뒤 `docs/ROADMAP.md`에서 현재 상태와 다음 작업을 확인합니다.
2. 열려 있는 자신의 PR이 있는지 확인합니다. 있으면 새 작업을 시작하지 않고 사용자에게
   병합을 기다리고 있다고 알립니다(ADR-024).
3. 병합이 끝난 최신 `origin/main`에서 규칙 형식(`<type>/<scope>-<topic>`)의 브랜치를 새로 만듭니다.
4. 작업 범위는 로드맵 항목 하나로 제한합니다. 한 브랜치에는 한 주제만 담습니다. 새 설계 쟁점이
   생기면 `docs/OPEN-QUESTIONS.md`에 추가하고 사용자 확인을 받아 확정합니다.
5. 구현 후 검증 게이트(`pnpm verify`)를 통과합니다.
6. `docs/ROADMAP.md` 갱신을 포함해 한 커밋으로 정리합니다. 커밋 제목은 한국어 Conventional
   Commits 형식(`<type>(<scope>): 제목`)으로 작성합니다.
7. 푸시 후 PR을 만듭니다. PR 제목과 본문은 `.claude/rules/branching.md`의 커밋·PR 규칙을 따릅니다.
