# SlipKit Codex 작업 규칙

SlipKit은 전표 양식을 디자인하고 작성해 PDF로 출력하는 임베드형 패키지다.
pnpm 모노레포이며 주요 패키지는 `packages/core`, `packages/elements`, `packages/react`,
`packages/vue`, `packages/mcp`다.

## 규칙 확인

- `CLAUDE.md`를 저장소 공통 규칙의 진입 문서로 사용한다.
- 작업 전에 대상에 해당하는 `.claude/rules/*.md`를 읽는다.
  - 브랜치·커밋·PR: `.claude/rules/branching.md`
  - 문서: `.claude/rules/docs.md`
  - 코드 주석: `.claude/rules/comments.md`
  - 용어와 문구: `.claude/rules/terms.md`
  - core: `.claude/rules/core.md`
  - UI 패키지: `.claude/rules/ui-packages.md`
- GitHub 이슈나 코멘트를 다룰 때는 `.codex/rules/issue-comments.md`를 먼저 읽는다.
- 상세 규칙을 이 파일에 복제하지 않는다. 규칙 파일이 바뀌면 이 목록과 연결이 유효한지만
  확인한다.

## 작업 시작

1. `docs/ROADMAP.md`에서 현재 상태와 작업 순서를 확인한다.
2. `git status`로 기존 변경을 확인하고, 사용자가 만든 변경을 되돌리지 않는다.
3. 관련 코드와 문서를 읽어 현재 동작과 결정 근거를 확인한다.
4. 브랜치가 `.claude/rules/branching.md`의 형식과 순서를 따르는지 확인한다.

## 구현과 문서

- 기존 패키지 경계와 코드 패턴을 우선하며, 요청과 무관한 리팩터링을 섞지 않는다.
- 공개 API, 파일 형식과 저장 데이터에 영향을 주는 변경은 관련 SPEC, REQUIREMENTS,
  DECISIONS와 테스트를 함께 확인한다.
- 코드 주석은 현재 동작과 코드만으로 알기 어려운 제약만 설명한다.
- 한국어 문장은 단어 치환으로 끝내지 않고 문장 전체가 자연스러운지 확인한다.
  번역투, 방어적 표현, 작업 대화, 요청 출처와 같은 불필요한 맥락을 문서·주석·PR에 남기지 않는다.
- 문제 문구를 지적할 때는 현재 문구와 바꿀 문구를 함께 제시한다.

## GitHub 협업

- Codex가 PR을 작성할 때는 `.claude/rules/branching.md`의 모델 상태 확인 절차를 적용하지 않는다.
- PM 역할에서는 요구사항으로 결정할 수 있는 질문에 결론, 기대 동작, 예외와 검증 기준을
  구체적으로 답한다.
- `알아서 처리`, `적절히 반영`, `필요하면 수정`처럼 판단을 상대에게 넘기지 않는다.
- 같은 단계에서 확인할 수 있는 질문과 리뷰 결과는 한 번에 모아 전달한다.
- 이슈 코멘트의 번호, 상태와 상위 코멘트는 `.codex/rules/issue-comments.md`에 따라 관리한다.

## 검증

- 변경 범위에 맞는 테스트를 먼저 실행한다.
- 완료 전에는 `CLAUDE.md`의 전체 검증 게이트와 `git diff --check`를 통과한다.
- UI 변경은 실제 브라우저에서 대상 화면과 주요 상호작용을 확인한다.
- 검증하지 못한 항목은 완료한 것으로 표현하지 않고 이유와 남은 위험을 알린다.
