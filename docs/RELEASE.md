# 배포 운영 절차

이 문서는 SlipKit 저장소의 PR 검증과 npm 배포 준비·실행·복구 절차를 설명합니다.

최종 갱신: 2026-09-09

> [!IMPORTANT]
> `@omdc-slipkit/*` 패키지는 아직 npm 레지스트리에 배포되지 않았습니다. 이 문서에 적힌 npm 조직,
> Trusted Publisher와 GitHub Environment의 외부 설정도 아직 수행하지 않았습니다. 최초 패키지 생성과
> 라이선스·버전·승인 정책을 확정하기 전에는 실제 배포를 실행하지 않습니다.

## 1. 자동 검증 범위

`.github/workflows/ci.yml`은 `main` 대상 PR과 `main` push에서 다음 작업을 실행합니다.

| 작업 | 환경 | 확인 범위 |
|---|---|---|
| `verify` | Ubuntu, Node.js 22.13·24 | 설치, lint, build, typecheck와 전체 시험 |
| `schema` | Ubuntu, Node.js 24 | JSON Schema 재생성 뒤 추적·미추적 변경이 없는지 |
| `packages` | Ubuntu, Node.js 22.13·24 | 실제 tarball, npm·pnpm 소비자 설치와 Chromium PDF |
| `mcp-windows` | Windows, Node.js 24 | MCP와 의존 패키지 빌드, Windows 저장 경로 시험 |

모든 작업은 Corepack 0.34.6과 루트 `packageManager`의 pnpm 10.33.0을 사용합니다. CI 워크플로의
기본 권한은 `contents: read`이며, checkout 자격 증명과 패키지 관리자 캐시는 남기지 않습니다.

워크플로를 바꿀 때는 로컬 검증과 GitHub-hosted runner 결과를 모두 확인합니다.

```bash
actionlint .github/workflows/ci.yml .github/workflows/release.yml
pnpm verify
pnpm exec playwright install chromium
pnpm verify:packages
git diff --check
```

## 2. 실제 배포 전 외부 설정

### 2.1 npm에서 설정할 것

npm의 Trusted Publisher는 이미 레지스트리에 존재하는 패키지에만 연결할 수 있습니다. 따라서
`@omdc-slipkit` 조직과 다섯 패키지의 최초 생성 방식은 첫 배포 정책을 확정한 뒤 별도로 처리합니다.
최초 패키지가 존재하기 전에는 이 절의 Trusted Publisher 설정을 완료할 수 없습니다.

패키지가 만들어지면 npmjs.com에서 다섯 패키지 각각에 같은 설정을 적용합니다.

1. **Packages**에서 패키지를 열고 **Settings → Trusted publishing**으로 이동합니다.
2. Publisher로 **GitHub Actions**를 선택합니다.
3. 다음 값을 입력합니다.

| npm 화면 항목 | 값 |
|---|---|
| Organization or user | `open-my-dev-com` |
| Repository | `drawing-report` |
| Workflow filename | `release.yml` |
| Environment name | `npm-publish` |
| Allowed actions | `npm publish` |

워크플로 파일명에는 경로를 붙이지 않고 파일명과 `.yml` 확장자를 정확히 입력합니다. npm은 저장할 때
GitHub 설정의 유효성을 확인하지 않으므로 대소문자와 값을 다시 확인합니다. 한 패키지에는 Trusted
Publisher를 하나만 연결할 수 있습니다.

### 2.2 GitHub에서 설정할 것

1. 저장소 **Settings → Environments**에서 `npm-publish` Environment를 만듭니다.
2. 승인자와 배포 브랜치 보호 규칙을 정하고 `main`만 실제 배포할 수 있게 합니다.
3. 다섯 npm 패키지의 Trusted Publisher 설정을 모두 마친 뒤에만 **Settings → Secrets and
   variables → Actions → Variables**에서 `NPM_TRUSTED_PUBLISHING`을 `true`로 만듭니다.

장기 npm access token, `NODE_AUTH_TOKEN`이나 npm 쓰기 토큰은 GitHub Secrets에 추가하지 않습니다.
`id-token: write` 권한은 `release.yml`의 실제 `publish` 작업에만 있습니다.

## 3. 배포 전 사전 검증

GitHub 저장소의 **Actions → Release → Run workflow**에서 `main`을 선택하고 실행합니다.

| 입력 | 사전 검증 값 | 설명 |
|---|---|---|
| `version` | 다섯 `package.json`과 같은 정확한 SemVer | 한 패키지라도 다르면 준비 단계에서 실패 |
| `dist_tag` | `latest` 또는 `next` | npm에 적용할 dist-tag |
| `environment` | `npm-publish` | 다른 값은 허용하지 않음 |
| `dry_run` | `true` | 실제 배포 없이 검증과 `npm publish --dry-run` 실행 |

정식 버전은 `latest` 또는 `next` 태그를 사용할 수 있습니다. 하이픈이 들어간 사전 배포 버전은 `latest`를
사용할 수 없으며 `next`를 선택해야 합니다. 준비 작업은 tarball을 만들기 전에 잘못된 조합을 거부합니다.

`prepare` 작업은 `pnpm verify`, `pnpm verify:packages`를 통과한 뒤 다섯 개의 tarball과
`SHA256SUMS`·`manifest.json`을 7일 동안 보존하는 배포 산출물로 만듭니다. 이 보존 기간은 부분 배포를 처음 실패한 실행에서
재개할 수 있는 기간입니다(§5). `publish-dry-run`은 npm 11.19.1로 배포 산출물을 검증하고 배포 명령을
실행하되 레지스트리에 올리지 않습니다. 마지막 `status`의 Job Summary에서 `publish`가 실행되지 않았고
검증만 끝났는지 확인합니다.

저장소 변수가 없거나 `true`가 아니면 `dry_run=false`로 실행해도 실제 `publish` 작업은 건너뜁니다.
이 경우도 Job Summary는 배포 성공이 아니라 외부 설정이 없어 검증만 완료됐다고 표시합니다.

## 4. 실제 배포

다음 조건을 모두 확인한 뒤 `dry_run=false`로 실행합니다.

- 실행 ref가 `main`입니다.
- 다섯 패키지의 버전이 `version` 입력과 같습니다.
- npm의 다섯 패키지에 `release.yml`·`npm-publish` Trusted Publisher가 연결돼 있습니다.
- GitHub의 `npm-publish` Environment 보호 규칙과 승인이 준비돼 있습니다.
- 저장소 변수 `NPM_TRUSTED_PUBLISHING`이 정확히 `true`입니다.

Environment 승인을 거치면 같은 배포 산출물을 다시 빌드하지 않고 SHA-256을 확인한 뒤 다음 순서로
배포합니다.

1. `@omdc-slipkit/core`
2. `@omdc-slipkit/elements`
3. `@omdc-slipkit/react`
4. `@omdc-slipkit/vue`
5. `@omdc-slipkit/mcp`

각 단계는 `npm publish <tarball> --provenance --access public --tag <dist_tag>`를 실행합니다. 한
패키지가 실패하면 뒤 패키지를 시도하지 않습니다. 완료 뒤 Job Summary와 npm의 다섯 패키지에서
버전, `dist.integrity`, dist-tag와 provenance를 확인합니다.

## 5. 부분 배포 후 재개

다섯 패키지 중 일부만 올라간 상태로 `publish`가 실패하면, **처음 실패한 실행에서 `Re-run failed jobs`를
선택해 배포를 재개**합니다. 성공한 `prepare`는 다시 실행하지 않고, 해당 실행에서 만든 배포 산출물의
tarball을 그대로 사용합니다. 같은 버전의 tarball을 다시 만들지 않기 위한 절차입니다.

### 5.1 재개 절차

1. **실패 지점을 확인합니다.** 처음 실패한 실행의 Job Summary와 `publish` 로그에서 마지막으로 성공한
   패키지와 실패한 패키지를 확인하고, npm에서 각 패키지의 버전·`dist.integrity`·dist-tag를 대조합니다.
2. **원인을 해결합니다.** Environment 승인 대기, Trusted Publisher 설정, 권한이나 일시적인 통신 오류를
   먼저 해결합니다. 원인을 해결하지 않은 재개는 같은 자리에서 다시 실패합니다.
3. **처음 실패한 실행에서 `Re-run failed jobs`를 선택합니다.** 실패한 `publish`와 `status`만 다시 실행되고,
   `prepare`는 성공 상태 그대로 남아 배포 산출물을 제공합니다.
4. **재개 실행을 검증합니다.** `publish`가 `prepare`의 배포 산출물을 내려받아 `SHA256SUMS`와
   `manifest.json`을 검증했는지, 이미 올라간 패키지를 건너뛰고 남은 패키지만 배포했는지, `status`의 Job
   Summary가 배포 성공으로 끝났는지 확인합니다. 마지막으로 npm에서 다섯 패키지의 버전,
   `dist.integrity`, dist-tag와 provenance를 확인합니다.

### 5.2 하지 않는 것

- `Re-run all jobs`를 쓰지 않습니다. `prepare`가 다시 돌면 tarball을 새로 만들게 됩니다.
- 새 **Run workflow** 실행으로 같은 버전을 이어서 배포하지 않습니다.
- 로컬이나 다른 실행기에서 다시 만든 tarball로 남은 패키지를 배포하지 않습니다.

### 5.3 각 패키지의 판정

재개한 `publish`는 패키지마다 레지스트리를 조회해 다음처럼 판정합니다.

| 레지스트리 조회 결과 | 처리 |
|---|---|
| E404 | 아직 없는 버전이므로 배포 |
| 해당 실행의 배포 산출물과 SHA-512 SRI가 같음 | 앞선 시도에서 같은 파일을 배포했으므로 건너뜀 |
| 다른 SRI | 다른 내용이 같은 버전에 존재하므로 즉시 중단 |
| 인증·통신 오류 | 상태를 확정할 수 없으므로 즉시 중단 |

### 5.4 재개할 수 없을 때

배포 산출물은 7일 동안 보존합니다. 이 기간이 지나 산출물이 만료됐거나 남아 있지
않거나, `prepare`를 다시 실행해야 하는 상황이면 **같은 버전의 재개를 중단합니다.** 이미 공개된 패키지와
dist-tag 상태를 확인한 뒤, 다섯 패키지의 새 버전을 정해 새 릴리스로 처음부터 실행합니다.

같은 버전의 tarball 내용을 고쳐서 재개하지도 않습니다. npm에 올라간 버전은 덮어쓸 수 없으므로, 내용
변경이 필요하면 마찬가지로 새 버전으로 처리합니다. 부분 배포된 이전 버전의 폐기·deprecate 여부는
확정된 릴리스 정책에 따라 별도로 처리합니다.

## 6. 외부 설정을 바꿀 때

- 저장소나 워크플로 파일명을 바꾸면 npm의 다섯 Trusted Publisher 설정도 함께 바꿉니다.
- Environment 이름을 바꾸려면 npm과 GitHub 설정, `release.yml` 입력 검증을 한 번에 바꿉니다.
- 실제 배포를 잠시 막을 때는 `NPM_TRUSTED_PUBLISHING`을 `true` 이외의 값으로 바꾸거나 삭제합니다.
- Trusted Publisher가 정상 동작하는 것을 확인한 뒤 npm의 기존 쓰기 토큰을 제한하거나 폐기합니다.

현재 npm 요구사항과 화면 항목은 [npm Trusted publishing 문서](https://docs.npmjs.com/trusted-publishers/),
GitHub Environment 보호 규칙은 [GitHub Deployments and environments 문서](https://docs.github.com/actions/reference/workflows-and-actions/deployments-and-environments)를 기준으로 확인합니다.
