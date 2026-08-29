# SlipKit MCP 사용 가이드

[English](mcp.en.md) · [日本語](mcp.ja.md)

`@omdc-slipkit/mcp`는 AI가 로컬 디렉터리의 `.slip` 양식과 전표를 읽고 만들고 고칠 수 있게 하는 stdio MCP 서버입니다. 양식에 값을 넣은 미발행 전표를 만들거나 PDF로 렌더링하는 작업도 지원합니다.

별도 터미널에서 서버를 계속 실행할 필요는 없습니다. stdio 방식에서는 MCP 클라이언트가 서버를 로컬 하위 프로세스로 시작하고 연결을 종료할 때 함께 종료합니다. 저장소 경로, 로케일, 폰트와 암호화 환경변수 이름은 서버 설정 파일인 `slipkit-mcp.json`에서 관리합니다.

> [!IMPORTANT]
> SlipKit 패키지는 아직 npm 레지스트리에 배포되지 않았습니다. 현재는 저장소에서 패키지를 빌드한 뒤 MCP 클라이언트에 연결해야 합니다.

## 준비

- Node.js 22.13 이상
- pnpm 10.33.0
- 로컬 stdio MCP 서버를 연결할 수 있는 MCP 클라이언트

저장소 루트에서 의존성을 설치하고 MCP 패키지를 빌드합니다.

```bash
pnpm install
pnpm --filter @omdc-slipkit/mcp build
mkdir slip-workspace
```

`slip-workspace`는 AI가 접근할 `.slip` 파일과 이미지를 두는 작업 디렉터리의 예시입니다. 다른 디렉터리를 사용해도 됩니다.

## MCP Inspector에서 시험하기

저장소에는 MCP 클라이언트를 따로 설정하기 전에 도구를 직접 호출해 볼 수 있는 Inspector 데모가 있습니다. MCP Inspector의 요구사항에 따라 이 데모는 Node.js 22.19 이상에서 실행해야 합니다.

```bash
pnpm demo:mcp
```

이 명령은 MCP 패키지를 빌드하고 `examples/mcp-demo/workspace`에 샘플 양식을 준비한 뒤 `http://localhost:6274`에서 Inspector를 엽니다. 연결 화면에서 **Connect**를 누르고 **Tools** 탭으로 이동하면 `slip_list`, `slip_read`, `slip_edit`, `slip_render_pdf` 등을 호출할 수 있습니다.

Inspector에서 수정하거나 생성한 파일은 데모 작업 디렉터리에만 저장되며 Git에서 제외됩니다. 샘플을 초기화하려면 Inspector를 종료한 뒤 다음 명령을 실행합니다.

```bash
pnpm demo:mcp:reset
```

구체적인 입력 예시는 [`examples/mcp-demo`](../../examples/mcp-demo)에서 확인할 수 있습니다.

## 서버 설정 파일 만들기

`slipkit-mcp.json`은 MCP 서버가 읽는 설정 파일입니다. 다음 예시는 설정 파일의 상위 디렉터리에 있는 `slip-workspace`를 작업 디렉터리로 사용합니다.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "ko"
}
```

설정 파일은 원하는 위치에 둘 수 있습니다. `rootDir`과 폰트 파일 경로는 설정 파일이 있는 디렉터리를 기준으로 해석합니다. `~`는 홈 디렉터리로 확장되지 않으므로 절대 경로나 올바른 상대 경로를 사용하세요.

| 필드 | 설명 | 생략했을 때 |
|---|---|---|
| `rootDir` | `.slip`, 이미지와 PDF를 읽고 쓸 작업 디렉터리 | 서버 프로세스의 현재 작업 디렉터리 |
| `locale` | 오류 메시지와 동봉 기본 폰트에 적용할 로케일 | 영어 |
| `fonts` | PDF 렌더링에 사용할 TTF·OTF 파일 목록 | 로케일에 맞는 동봉 폰트 |
| `encryption.keyEnv` | 현재 암호화 키를 읽을 환경변수 이름 | `SLIPKIT_MCP_KEY` |
| `encryption.previousKeysEnv` | 이전 키 목록을 읽을 환경변수 이름 | `SLIPKIT_MCP_PREVIOUS_KEYS` |

설정 파일에 정의되지 않은 필드를 넣으면 오류로 처리합니다. JSON 문법이 잘못됐거나 작업 디렉터리·폰트 파일을 찾을 수 없으면 서버가 시작되지 않고 원인을 stderr에 표시합니다.

## MCP 클라이언트에 연결

클라이언트의 stdio MCP 서버 설정에는 실행 파일과 `slipkit-mcp.json` 경로를 등록합니다. 다음 JSON의 최상위 키와 저장 위치는 클라이언트마다 다를 수 있습니다.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "--config",
        "/absolute/path/to/slipkit-mcp.json"
      ]
    }
  }
}
```

경로는 실제 절대 경로로 바꿔야 합니다. 설정을 저장한 뒤 MCP 클라이언트를 다시 시작하거나 MCP 서버 목록을 새로 고칩니다. `slip_list`, `slip_read` 등의 도구 7개가 보이면 연결된 상태입니다.

### 두 설정 파일의 역할

SlipKit 서버 설정과 MCP 클라이언트 설정은 역할이 다릅니다.

| 설정 | 저장하는 내용 |
|---|---|
| `slipkit-mcp.json` | 작업 디렉터리, 로케일, 커스텀 폰트, 암호화 키를 읽을 환경변수 이름 |
| MCP 클라이언트 설정 | 서버 실행 명령, `slipkit-mcp.json` 경로, 필요한 암호화 환경변수 값 |

MCP 클라이언트 설정의 위치는 다음과 같습니다.

| 클라이언트 | 저장 위치와 등록 방법 |
|---|---|
| Codex CLI | 사용자 설정 `~/.codex/config.toml`. `codex mcp add`로 등록하면 직접 TOML을 편집할 필요가 없습니다. |
| Claude Code | `local`, `user`, `project` 범위를 선택할 수 있습니다. `project` 범위는 저장소의 `.mcp.json`을 사용하며, 현재처럼 절대 경로가 필요한 개발 단계에서는 기본값인 `local` 범위가 적합합니다. |
| 그 밖의 클라이언트 | 해당 클라이언트가 지정한 사용자 또는 프로젝트 MCP 설정에 앞의 JSON과 같은 `command`, `args`, `env`를 등록합니다. |

현재 저장소에서 Codex CLI에 등록하는 예시는 다음과 같습니다.

```bash
codex mcp add slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  --config /absolute/path/to/slipkit-mcp.json
```

Claude Code에서는 다음과 같이 등록할 수 있습니다. `local` 범위를 사용하면 기기별 절대 경로를 `.mcp.json`에 공유하지 않습니다.

```bash
claude mcp add --scope local slipkit -- \
  node /absolute/path/to/drawing-report/packages/mcp/dist/cli.js \
  --config /absolute/path/to/slipkit-mcp.json
```

패키지가 npm에 배포되면 저장소를 직접 빌드하지 않고 다음처럼 실행할 수 있습니다.

```bash
codex mcp add slipkit -- \
  npx -y @omdc-slipkit/mcp --config /absolute/path/to/slipkit-mcp.json
```

이 경우에도 서버 설정 파일과 작업 디렉터리는 로컬에 유지됩니다.

## 설정 탐색과 우선순위

서버는 다음 순서로 설정 파일을 찾습니다.

1. `--config <path>`
2. `SLIPKIT_MCP_CONFIG` 환경변수
3. 첫 번째 위치 인자로 작업 디렉터리를 지정했다면 그 디렉터리의 `slipkit-mcp.json`
4. 위치 인자가 없다면 서버 프로세스의 현재 작업 디렉터리에 있는 `slipkit-mcp.json`

명시적으로 지정한 설정 파일을 읽을 수 없으면 서버가 시작되지 않습니다. 자동 탐색 위치에 파일이 없으면 기본값으로 실행합니다.

설정값의 우선순위는 다음과 같습니다.

| 설정 | 우선순위 |
|---|---|
| 작업 디렉터리 | 첫 번째 위치 인자 → `rootDir` → 현재 디렉터리 |
| 로케일 | `--locale` → `SLIPKIT_MCP_LOCALE` → `locale` → 영어 |
| 폰트 | 설정 파일의 `fonts` → 로케일에 맞는 동봉 폰트 |
| 암호화 키 | `encryption`에서 지정한 이름의 환경변수. 이름을 생략하면 기본 환경변수 이름 사용 |

기존의 위치 인자와 `--locale`은 설정 파일 값을 일시적으로 덮어쓸 때 계속 사용할 수 있습니다.

### 실행 옵션과 환경변수

| 항목 | 설명 |
|---|---|
| 첫 번째 위치 인자 | 작업 디렉터리. 생략하면 MCP 서버의 현재 작업 디렉터리를 사용합니다. |
| `--config <path>` | 사용할 `slipkit-mcp.json` 경로입니다. 상대 경로는 서버 프로세스의 현재 디렉터리를 기준으로 합니다. |
| `--locale <locale>` | 오류 메시지와 PDF 기본 폰트에 적용할 언어입니다. `ko`, `en`, `ja`를 사용할 수 있습니다. |
| `SLIPKIT_MCP_CONFIG` | `--config`가 없을 때 사용할 설정 파일 경로입니다. |
| `SLIPKIT_MCP_LOCALE` | `--locale`을 쓰지 않았을 때 적용할 언어입니다. |
| `SLIPKIT_MCP_KEY` | `.slip` 파일을 암호화하고 복호화할 현재 키입니다. 명령 인자가 아닌 환경변수로만 받습니다. |
| `SLIPKIT_MCP_PREVIOUS_KEYS` | 키 교체 전에 사용한 키를 쉼표로 구분해 지정합니다. 현재 키로 복호화하지 못하면 이전 키를 순서대로 시도합니다. |

### 암호화 설정

암호화 키 자체는 `slipkit-mcp.json`에 저장하지 않습니다. 설정 파일에는 키를 읽을 환경변수 이름만 적습니다.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "ko",
  "encryption": {
    "keyEnv": "MY_SLIP_KEY",
    "previousKeysEnv": "MY_SLIP_PREVIOUS_KEYS"
  }
}
```

실제 키 값은 서버 프로세스를 시작하는 환경에서 전달합니다.

```json
{
  "mcpServers": {
    "slipkit": {
      "command": "node",
      "args": [
        "/absolute/path/to/drawing-report/packages/mcp/dist/cli.js",
        "--config",
        "/absolute/path/to/slipkit-mcp.json"
      ],
      "env": {
        "MY_SLIP_KEY": "current-passphrase",
        "MY_SLIP_PREVIOUS_KEYS": "previous-passphrase"
      }
    }
  }
}
```

실제 키가 들어간 MCP 클라이언트 설정을 저장소에 커밋하지 마세요. 사용자·`local` 범위나 클라이언트가 제공하는 비밀 관리 기능을 사용하세요.

현재 키 환경변수가 설정되면 새로 저장하는 파일은 암호화됩니다. 평문 `.slip` 파일은 그대로 읽을 수 있지만, 암호화된 파일은 일치하는 현재 키나 이전 키가 없으면 읽을 수 없습니다. `encryption.keyEnv`를 명시했는데 해당 환경변수가 없으면 서버는 시작되지 않습니다.

### PDF 폰트

`fonts`를 생략하면 MCP 서버는 `@omdc-slipkit/elements`에 base64로 동봉된 폰트를 사용합니다. 폰트를 네트워크에서 내려받거나 운영체제 폰트를 자동으로 읽지 않습니다.

| 로케일 | 기본 폰트 |
|---|---|
| `ja`로 시작하는 로케일 | Noto Sans JP Regular 일본어 서브셋 |
| 그 밖의 로케일 | Pretendard Regular, Pretendard Bold |

요소의 `fontName`을 생략하면 해당 로케일의 기본 폰트를 사용합니다. 직접 지정할 때는 현재 등록된 폰트 이름을 사용해야 합니다. 일본어 동봉 폰트에는 Bold가 없으므로 `bold: true`를 지정해도 별도 Bold 폰트가 적용되지 않습니다.

커스텀 폰트는 설정 파일에서 등록합니다.

```json
{
  "rootDir": "../slip-workspace",
  "locale": "ko",
  "fonts": [
    {
      "name": "AppFont",
      "path": "./fonts/AppFont-Regular.ttf",
      "fallback": true
    },
    {
      "name": "AppFont-Bold",
      "path": "./fonts/AppFont-Bold.ttf"
    }
  ]
}
```

폰트 경로는 설정 파일 위치를 기준으로 해석합니다. `fallback: true`는 하나의 폰트에만 지정할 수 있으며, 지정하지 않으면 목록의 첫 번째 폰트를 대체 폰트로 사용합니다. `fonts`를 설정하면 동봉 폰트 대신 해당 목록만 등록되므로 양식에서 참조하는 모든 폰트를 포함해야 합니다. 굵기와 기울임 변형의 이름은 `AppFont-Bold`, `AppFont-Italic`, `AppFont-BoldItalic` 형식을 사용합니다.

개발 저장소에서 실행할 때는 `packages/mcp/dist`만 복사하지 말고 pnpm으로 설치된 workspace 의존성을 유지해야 합니다. npm 배포 후에는 `elements` 의존성과 동봉 폰트가 MCP 패키지와 함께 설치됩니다.

## 제공 도구

| 도구 | 용도 | 주요 입력 |
|---|---|---|
| `slip_list` | 작업 디렉터리의 `.slip` 파일을 최대 50개씩 조회합니다. | `kind`, `query`, `cursor` |
| `slip_read` | 파일 요약, 특정 페이지, 특정 요소 또는 전체 내용을 읽습니다. | `path`, `part`, `elementId`, `pageIndex` |
| `slip_save` | 완성된 JSON을 검증하고 새 `.slip` 파일로 저장합니다. | `path`, `file`, `overwrite` |
| `slip_edit` | 기존 파일에 대상을 지정한 수정 연산을 원자적으로 적용합니다. | `path`, `ops` |
| `slip_build_voucher` | 양식과 파라미터 값으로 미발행 전표를 만듭니다. | `templatePath`, `values`, `outPath`, `overwrite` |
| `slip_render_pdf` | 양식이나 전표를 PDF 파일로 렌더링합니다. | `path`, `outPath` |
| `slip_schema` | `.slip` 구조를 주제별로 안내합니다. | `topic` |

`slip://schema` 리소스는 현재 `.slip` JSON Schema 전체를 제공합니다. `slip_schema`의 `topic`은 `overview`, `elements`, `grid`, `parameters`, `formula`, `voucher`, `json-schema`입니다.

### `slip_read`의 읽기 범위

| `part` | 반환 내용 |
|---|---|
| `summary` | 페이지, 요소 id·종류·위치, 파라미터와 에셋 요약. 기본값입니다. |
| `element` | `elementId`로 지정한 요소 하나의 전체 내용 |
| `page` | `pageIndex`로 지정한 페이지 하나의 전체 내용 |
| `full` | 파일 전체 내용 |

읽기 응답의 base64 이미지 데이터는 크기 표시로 대체됩니다. `.slip` 파일의 이미지 형식은 base64 데이터 URL을 사용하며, MCP에서 이미지를 넣을 때는 `slip_edit`의 `set_image`에 작업 디렉터리 안의 파일 경로를 전달합니다. 서버가 파일을 읽어 base64 에셋으로 변환합니다.

### `slip_edit` 연산

| `action` | 수정 대상 |
|---|---|
| `set_meta` | 양식 메타데이터 |
| `set_paper` | 용지 설정 |
| `set_page`, `add_page`, `remove_page` | 페이지 |
| `set_element`, `add_element`, `remove_element` | id로 지정한 요소 |
| `add_parameter`, `set_parameter`, `remove_parameter` | key로 지정한 파라미터 |
| `set_cell` | 그리드 id와 0부터 시작하는 행·열로 지정한 셀 |
| `set_image` | id로 지정한 이미지 요소 |
| `set_values` | 미발행 전표의 값 |

연산은 입력 순서대로 사본에 적용한 뒤 파일 전체를 검증합니다. 연산 하나라도 실패하거나 최종 파일이 유효하지 않으면 아무것도 저장하지 않습니다.

`set_element`와 같은 `fields` 기반 연산은 전달한 필드만 덮어씁니다. 바꾸지 않을 필드는 입력에서 생략하고, 삭제할 필드는 `null`로 지정하세요. 단, `set_values`의 `null`은 삭제 표시가 아니라 실제 전표 값으로 저장됩니다.

#### 조건부 서식 수정 예

다음 연산은 `total` 필드의 값이 음수일 때 글자를 빨간색 굵은 글씨로 표시합니다.

```json
{
  "path": "invoice",
  "ops": [
    {
      "action": "set_element",
      "id": "total",
      "fields": {
        "conditionalFormats": [
          {
            "condition": "total < 0",
            "fontColor": "#FF0000",
            "bold": true
          }
        ]
      }
    }
  ]
}
```

그리드 셀은 `set_cell`을 사용합니다. `conditionalFormats`를 전달하면 기존 규칙 목록 전체를 교체하며, `null`로 지정하면 모든 규칙을 삭제합니다. 지원 필드와 조건식 문법은 각각 `slip_schema`의 `elements` 또는 `grid`, `formula` 주제에서 확인할 수 있습니다.

## 권장 작업 흐름

### 새 양식 만들기

1. `slip_schema`의 `overview`를 읽습니다.
2. 필요한 요소에 맞게 `elements`, `grid`, `parameters`, `formula` 주제를 추가로 읽습니다.
3. 완성된 양식 JSON을 `slip_save`로 저장합니다.
4. `slip_render_pdf`로 PDF를 만들어 배치와 스타일을 확인합니다.

### 기존 양식 고치기

1. `slip_read` 기본 요약으로 페이지와 요소 id를 확인합니다.
2. 필요한 경우에만 `element`나 `page`를 읽습니다.
3. `slip_edit`로 변경할 대상만 수정합니다.
4. `slip_render_pdf`로 변경 결과를 확인합니다.

기존 파일의 작은 변경에 `slip_save` 또는 `slip_read`의 `full`을 사용하지 마세요. 요약으로 대상을 찾고 `slip_edit`로 지목해 수정하면 관련 없는 요소가 빠지거나 바뀌는 실수를 줄일 수 있습니다.

### 전표와 PDF 만들기

1. `slip_build_voucher`에 양식 경로, 파라미터 값과 출력 경로를 전달합니다.
2. 값을 고쳐야 하면 `slip_edit` 안의 `set_values`를 사용합니다.
3. `slip_render_pdf`로 실제 값이 반영된 PDF를 만듭니다.

MCP 서버가 만드는 전표는 `issued: false`인 미발행 전표입니다. 전표 발행은 사용자 확인과 권한 검사를 할 수 있는 호스트 애플리케이션에서 처리해야 합니다. 발행된 전표는 MCP로 수정할 수 없습니다.

## 파일 접근과 안전 범위

- 모든 입력·출력 경로는 MCP 서버를 시작할 때 지정한 작업 디렉터리 안으로 제한됩니다.
- 저장 경로에 `.slip` 확장자가 없으면 자동으로 붙습니다.
- `slip_edit` 연산 묶음은 전체가 유효할 때만 저장됩니다.
- `slip_save`와 `slip_build_voucher`는 기존 파일을 기본적으로 덮어쓰지 않습니다. 명시적으로 `overwrite: true`를 전달해도 발행된 전표는 교체할 수 없습니다.
- PDF 출력 경로에는 `.slip` 확장자를 사용할 수 없습니다.
- `set_image`는 PNG, JPEG, GIF, WebP 파일을 지원하며 파일당 최대 크기는 2MB입니다.
- 서버는 임의 코드 실행, 네트워크 접속, 사용자 인증 또는 전표 발행 기능을 제공하지 않습니다.

`slip_edit`에는 요소·페이지·파라미터 삭제 연산이 있습니다. 사용자 확인 정책은 MCP 클라이언트의 도구 승인 설정에서 구성하세요.

## Node.js에서 저장소 재사용

`FileSystemStorage`는 MCP 서버와 같은 경로 제한과 암호화 규칙을 사용하는 `StorageAdapter` 구현입니다.

```ts
import { FileSystemStorage } from '@omdc-slipkit/mcp';

const key = process.env.SLIPKIT_MCP_KEY;
if (!key) throw new Error('SLIPKIT_MCP_KEY가 필요합니다.');

const previousKeys = process.env.SLIPKIT_MCP_PREVIOUS_KEYS
  ?.split(',')
  .map((key) => key.trim())
  .filter((key) => key !== '');

const storage = new FileSystemStorage({
  rootDir: '/absolute/path/to/slip-workspace',
  locale: 'ko',
  encryption: {
    key,
    ...(previousKeys?.length ? { previousKeys } : {}),
  },
});

const template = await storage.load('invoice');
await storage.save('archive/invoice', template);
```

서버를 직접 구성할 때는 `createSlipMcpServer(options)`를 사용할 수 있습니다. 이 함수는 연결되지 않은 `McpServer`와 `FileSystemStorage`를 반환하며, 전송 연결은 호출자가 담당합니다. CLI와 같은 설정 해석이 필요하면 `resolveServerOptions({ cwd, configPath, env })`로 `options`를 만든 뒤 전달합니다.

## 문제 해결

| 현상 | 확인할 내용 |
|---|---|
| MCP 도구가 보이지 않음 | MCP 패키지를 빌드했는지, `cli.js`와 `--config` 경로가 맞는지, 클라이언트를 재시작했는지 확인합니다. 서버 시작 오류는 클라이언트의 MCP 로그나 stderr에서 확인합니다. |
| `Could not read the config file` | `--config` 또는 `SLIPKIT_MCP_CONFIG` 경로와 파일 읽기 권한을 확인합니다. |
| `Working directory not found` | `rootDir` 경로와 디렉터리 존재 여부를 확인합니다. 상대 경로는 설정 파일 위치가 기준입니다. |
| `Font file ... not found` | `fonts[].path`와 파일 읽기 권한을 확인합니다. 상대 경로는 설정 파일 위치가 기준입니다. |
| 암호화 파일을 읽지 못함 | 설정의 `keyEnv`·`previousKeysEnv`가 가리키는 환경변수에 현재 파일을 복호화할 키가 있는지 확인합니다. |
| 수정 후 파일이 바뀌지 않음 | 도구 응답의 검증 오류를 확인합니다. 검증에 실패하면 기존 파일은 변경되지 않습니다. |
| PDF 출력 실패 | 출력 경로의 상위 디렉터리가 있는지와 쓰기 권한을 확인합니다. |

## 관련 문서

- [Core 사용 가이드](core.md)
- [서버 통합 가이드](server-integration.md)
- [API 참조](api-reference.md)
