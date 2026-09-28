# 배포 운영 절차

이 문서는 SlipKit의 버전 준비 PR, npm 배포, GitHub Release 생성과 실패 복구 절차를 설명합니다.

최종 갱신: 2026-09-29

## 1. 현재 배포 구성

다섯 공개 패키지는 npm의 `omdc` 조직에서 같은 버전으로 배포합니다.

| 패키지 | 용도 |
|---|---|
| `@omdc/slipkit` | Core API |
| `@omdc/slipkit-elements` | Web Components와 동봉 폰트 |
| `@omdc/slipkit-react` | React 래퍼 |
| `@omdc/slipkit-vue` | Vue 래퍼 |
| `@omdc/slipkit-mcp` | 로컬 MCP 서버 |

최초 버전 `0.1.0`은 패키지 생성과 Trusted Publisher 연결을 위해 수동으로 배포했습니다. 다섯
패키지에는 GitHub Actions Trusted Publisher와 `npm-publish` Environment가 연결되어 있으며,
저장소 변수 `NPM_TRUSTED_PUBLISHING`은 `true`입니다. 장기 npm access token과
`NODE_AUTH_TOKEN`은 사용하지 않습니다.

`0.1.0`의 GitHub Release는 소급해 만들지 않습니다. `0.1.1` 배포에서 Core만 npm에 접수된 뒤
자동 검토 대기를 실패로 잘못 판단했습니다. 다섯 패키지는 `0.1.2`부터 이 문서의 보완된
자동화 절차를 적용합니다.

## 2. 자동 검증 범위

`.github/workflows/ci.yml`은 `main` 대상 PR과 `main` push에서 다음 작업을 실행합니다.

| 작업 | 환경 | 확인 범위 |
|---|---|---|
| `verify` | Ubuntu, Node.js 22.13·24 | 설치, lint, build, typecheck와 전체 시험 |
| `schema` | Ubuntu, Node.js 24 | JSON Schema 재생성 뒤 추적·미추적 변경이 없는지 |
| `packages` | Ubuntu, Node.js 22.13·24 | 실제 tarball, npm·pnpm 소비자 설치와 Chromium PDF |
| `mcp-windows` | Windows, Node.js 24 | MCP와 의존 패키지 빌드, Windows 저장 경로 시험 |

워크플로를 바꿀 때는 다음 검증을 실행합니다.

```bash
actionlint .github/workflows/ci.yml .github/workflows/release.yml
pnpm verify
pnpm verify:packages
git diff --check
```

## 3. 버전 준비 PR

배포할 버전은 Release 워크플로를 실행하기 전에 PR로 검토합니다. AI가 버전 변경을 맡더라도 이
PR이 병합되기 전에는 실제 배포를 안내하거나 실행하지 않습니다.

1. 변경 내용을 기준으로 다음 SemVer를 정합니다.
2. 다섯 `package.json`의 버전을 같은 값으로 변경합니다.
3. `docs/releases/버전.md`에 한국어, 일본어, 영어 순서로 릴리즈 원문을 작성합니다.
4. README, 가이드, `SECURITY.md`와 `ROADMAP.md`에서 공개 상태나 버전 설명을 확인합니다.
5. 변경 시험과 전체 검증을 실행합니다.
6. PR 본문에 변경 전·후 버전, SemVer 변경 이유, dist-tag, 배포 대상, 릴리즈 원문, 공개 문서,
   검증 결과와 병합 후 워크플로 입력을 적습니다.

버전은 `.slip` 파일의 `schemaVersion`과 별도로 관리합니다. 현재는 패키지 간 호환성을 명확하게
유지하기 위해 다섯 공개 패키지의 버전을 함께 올립니다.

### 3.1 릴리즈 원문 형식

`docs/releases/버전.md`는 다음 세 제목을 순서대로 포함해야 합니다. 각 구역에는 해당 언어로 실제
변경 내용을 적습니다.

```markdown
# SlipKit 0.1.2

## 한국어

한국어 릴리즈 원문

## 日本語

日本語のリリース本文

## English

English release text
```

Release 준비와 워크플로 시험은 현재 패키지 버전에 해당하는 파일이 있는지, 세 구역이 비어 있지
않은지 확인합니다.

## 4. 선택적 dry-run

실제 배포 전에 배포 명령만 시험해야 할 때 GitHub의 **Actions → Release → Run workflow**에서
다음 입력으로 실행합니다. dry-run은 선택 사항이며 실제 배포의 선행 조건이 아닙니다.

| 입력 | 값 |
|---|---|
| `version` | 다섯 `package.json`과 같은 정확한 SemVer |
| `dist_tag` | 정식 버전은 `latest` 또는 `next`, 사전 배포 버전은 `next` |
| `environment` | `npm-publish` |
| `dry_run` | `true` |

`prepare`는 전체 검증을 거친 뒤 다섯 tarball, `manifest.json`과 `SHA256SUMS`를 만듭니다. 이
배포 산출물은 부분 배포 재개를 위해 7일 동안 보존합니다. `publish-dry-run`은 같은 산출물로
`npm publish --dry-run`을 실행합니다. dry-run은 npm이나 GitHub Release를 변경하지 않습니다.

Job Summary에서 준비·tarball 검증·dry-run이 성공했고 `publish`와 `release`가 실행되지 않았는지
확인합니다.

## 5. 실제 배포와 GitHub Release

준비 PR을 `main`에 병합한 뒤 GitHub의 **Actions → Release → Run workflow**에서 정확한
`version`, `dist_tag`, `environment=npm-publish`, `dry_run=false`를 입력해 한 번 실행합니다.
`npm-publish` Environment 승인이 필요하면 승인 후 계속합니다.

워크플로는 `prepare`가 만든 산출물을 다시 빌드하지 않고 다음 순서로 처리합니다.

1. `@omdc/slipkit`
2. `@omdc/slipkit-elements`
3. `@omdc/slipkit-react`
4. `@omdc/slipkit-vue`
5. `@omdc/slipkit-mcp`

각 패키지는 `npm publish --provenance --access public --tag`로 배포합니다. npm은 배포 명령을
받은 뒤 자동 검토가 끝날 때까지 해당 버전을 `Validating` 상태로 둘 수 있습니다. 이 상태에서는
npm 웹 화면에 버전이 보이더라도 공개 조회가 `E404`를 반환할 수 있습니다. `publish` 작업은 명령의
표준 출력과 표준 오류를 로그에 남기고, SRI와 dist-tag를 공개 조회할 수 있을 때까지 10초 간격으로
최대 15분 동안 확인합니다. 확인이 끝나야 다음 패키지를 배포합니다. SRI가 다르면 즉시 중단하며,
제한 시간 안에 공개되지 않거나 dist-tag가 일치하지 않아도 실패합니다.

다섯 패키지의 배포가 끝나면 `release` 작업이 npm에서 다음 항목을 다시 확인합니다.

- `manifest.json`과 npm `dist.integrity`가 같은지
- 요청한 dist-tag가 새 버전을 가리키는지
- Trusted Publishing provenance attestation이 존재하는지
- 공개된 정확한 다섯 버전을 설치한 뒤 `npm audit signatures --include-attestations`가 통과하는지

확인이 끝나야 검증한 커밋에 `v버전` 태그와 GitHub Release를 만듭니다. Release 본문에는
`docs/releases/버전.md`에서 검토한 세 언어 원문을 사용하고 다음 파일을 자산으로 첨부합니다.

- 다섯 npm tarball
- `manifest.json`
- `SHA256SUMS`

같은 태그나 Release가 이미 있으면 커밋, 본문, 공개 상태와 자산 digest가 모두 같은지 검사합니다.
내용이 다르면 덮어쓰지 않고 실패합니다.

## 6. 실패 후 재개

실제 실행에서 `publish` 또는 `release`가 실패하면 **처음 실패한 실행에서 Re-run failed jobs**를
선택합니다. 새 Run workflow를 시작하거나 `Re-run all jobs`를 선택하지 않습니다.

### 6.1 npm 배포 중 실패

재개한 `publish`는 같은 실행의 배포 산출물을 내려받아 해시를 확인하고 패키지별로 다음과 같이
판정합니다.

| 레지스트리 조회 결과 | 처리 |
|---|---|
| E404 | 아직 없는 버전이므로 배포 |
| 배포 산출물과 SHA-512 SRI가 같음 | 이미 같은 파일을 배포했으므로 건너뜀 |
| 다른 SRI | 다른 내용이 같은 버전에 있으므로 즉시 중단 |
| 인증·통신 오류 | 상태를 확정할 수 없으므로 즉시 중단 |

위 표는 배포 명령을 실행하기 전의 판정입니다. 배포 명령이 성공한 뒤에는 npm 자동 검토 중 발생하는
E404와 일시적인 조회 오류를 최대 15분 동안 다시 확인합니다. 이때 SRI 불일치는 기다리지 않고 즉시
중단합니다. 제한 시간을 넘긴 실행은 실패로 남기고 npm 웹 화면에서 해당 버전이 `Published`인지
확인한 뒤 처음 실패한 실행의 `Re-run failed jobs`로 재개합니다.

### 6.2 GitHub Release 생성 중 실패

npm 배포가 모두 성공하고 `release`만 실패했다면 Re-run failed jobs는 `release`와 `status`만 다시
실행합니다. npm에 다시 publish하지 않으며, 기존 태그·Release가 있으면 내용이 같은지 확인한 뒤
누락된 자산만 올립니다.

### 6.3 재개할 수 없는 경우

배포 산출물이 7일 후 만료됐거나 다른 SRI가 이미 공개됐다면 같은 버전의 재개를 중단합니다. npm에
공개된 상태를 확인하고 새 버전의 준비 PR부터 다시 시작합니다. 아직 어떤 패키지도 npm이 접수하지
않았다면 같은 버전과 원본 산출물로 재개할 수 있습니다. 하나라도 접수된 뒤 원본 산출물로 재개할 수
없으면 다섯 패키지를 다음 patch 버전으로 함께 올려 새 릴리스로 복구합니다. npm에 올라간 버전을 삭제한
뒤 같은 버전으로 다시 배포하지 않습니다.

## 7. 외부 설정 변경

- 저장소나 워크플로 파일명을 바꾸면 다섯 npm 패키지의 Trusted Publisher도 함께 바꿉니다.
- Environment 이름을 바꾸면 npm과 GitHub 설정, 워크플로 입력 검증을 함께 바꿉니다.
- 실제 배포를 막을 때는 `NPM_TRUSTED_PUBLISHING`을 `true` 이외의 값으로 바꾸거나 삭제합니다.
- `id-token: write`는 npm에 배포하는 `publish` 작업에만 둡니다.
- GitHub Release를 만드는 `release` 작업에는 `contents: write`만 둡니다.

현재 외부 서비스 설정은 [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers/)과
[GitHub Deployments and environments](https://docs.github.com/actions/reference/workflows-and-actions/deployments-and-environments)를 기준으로 확인합니다.
