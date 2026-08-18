# 브랜치 전략 (ADR-023)

> 이후 모든 작업은 이 규칙대로 브랜치를 분기해 진행한다.

최종 갱신: 2026-08-18

## 브랜치 규칙

### `main`
- 항상 배포/공유 가능한 안정 상태를 유지한다.
- **직접 커밋 금지.** 변경은 작업 브랜치에서 Pull Request로만 병합한다.
- 병합 방식은 squash merge를 기본으로 한다(작업 브랜치의 중간 커밋을 압축해 이력을 깔끔하게 유지).

### 작업 브랜치: `<type>/<scope>-<topic>`

| 요소 | 값 | 예 |
|---|---|---|
| `type` | `feat`(기능) / `fix`(버그 수정) / `docs`(문서) / `proto`(프로토타입·실험) / `chore`(설정·빌드·잡무) | |
| `scope` | 패키지명(`core`, `elements`, `react`, `vue`) 또는 `repo`(리포 전반) | |
| `topic` | 작업 내용을 나타내는 짧은 kebab-case | |

예시:
- `feat/core-file-format` — .slip 파일 포맷 스키마 구현
- `feat/elements-designer-canvas` — 디자이너 캔버스 요소 배치
- `proto/core-formula-parser` — 수식 파서 실험
- `docs/repo-spec-draft` — SPEC.md 초안
- `chore/repo-monorepo-setup` — 모노레포 초기 설정

### 규칙

1. **한 브랜치 = 한 주제.** 서로 다른 주제를 한 브랜치에 섞지 않는다.
2. 브랜치는 항상 최신 `main`에서 분기한다.
3. 병합된 브랜치는 재사용하지 않는다(같은 주제의 후속 작업도 새 브랜치).
4. `proto/*` 브랜치는 병합하지 않고 결론(문서/ADR)만 남기고 폐기해도 된다.
5. 오래 유지되는 브랜치는 주기적으로 `main`을 병합(또는 rebase)해 충돌을 작게 유지한다.

## 커밋 규칙

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따른다:

```
<type>(<scope>): <제목>

<본문(선택)>
```

- `type`: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `eval`(실측·평가)
- `scope`: 패키지명 또는 생략
- 제목은 한국어로 명확하게. 예: `feat(core): .slip 파일 Zod 스키마 정의`

## 초기 정착 경과 (기록)

- 프로젝트 부트스트랩(요구사항 Q&A·ADR-001~023·pdfme 실측)은 `claude/package-voucher-tool-dorcwu` 브랜치에서 진행되었다.
- 이 브랜치가 `main`에 병합되는 시점부터 위 규칙이 전면 적용된다.
