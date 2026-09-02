# SlipKit

[English](README.md) · [日本語](README.ja.md)

SlipKit은 웹 애플리케이션에 문서 양식 설계, 데이터 입력, 조회 및 PDF 출력 기능을 추가하는 라이브러리입니다.

일반 사용자는 시각적 디자이너로 거래명세서, 청구서, 견적서 등의 양식을 만들 수 있고, 개발자는 Web Component 또는 React·Vue 컴포넌트로 해당 기능을 기존 애플리케이션에 통합할 수 있습니다.

SlipKit은 독립 실행형 서비스가 아닙니다. 사용자 인증, 권한 관리, 데이터 저장 및 서버 연계는 SlipKit을 사용하는 애플리케이션에서 담당합니다.

![SlipKit 양식 디자이너](docs/guide/images/ko/overview.png)

## 주요 기능

- 드래그 앤 드롭 방식의 문서 양식 디자이너
- 양식에 데이터를 입력하고 전표를 발행하는 작성 화면
- 발행된 전표와 양식을 확인하는 읽기 전용 뷰어
- 브라우저 및 Node.js에서 사용할 수 있는 PDF 생성 기능
- JSON 기반 `.slip` 파일을 이용한 양식·전표 저장
- 수식, 조건부 서식, 표, 이미지, 도형 및 바코드 지원
- IndexedDB 저장소와 로컬 파일 불러오기·내려받기
- 선택적 AES-256-GCM 파일 암호화
- 한국어, 영어, 일본어 UI
- Web Component와 React·Vue용 래퍼 제공

## 동작 방식

SlipKit에서는 양식과 전표를 구분합니다.

| 단계 | 구성 요소 | 역할 |
|---|---|---|
| 양식 설계 | `<slip-designer>` | 문서의 레이아웃, 파라미터, 수식 등을 편집합니다. |
| 전표 작성 | `<slip-form>` | 양식에 실제 값을 입력하고 전표를 발행합니다. |
| 전표 조회 | `<slip-viewer>` | 양식 또는 발행된 전표를 읽기 전용으로 표시합니다. |

양식과 전표는 모두 `.slip` 확장자를 사용하며, 파일 내부의 `kind` 값으로 구분됩니다. 발행된 전표에는 발행 당시의 양식이 함께 저장되므로 이후 원본 양식이 변경되어도 기존 전표의 구성이 유지됩니다.

## 현재 상태

> [!IMPORTANT]
> SlipKit은 현재 공개 전 검토 단계입니다.
>
> `@omdc-slipkit/*` 패키지는 아직 npm 레지스트리에 배포되지 않았습니다. 현재 버전은 저장소를 복제하여 데모와 소스 코드로 확인할 수 있습니다.

## 패키지 구성

SlipKit은 pnpm 워크스페이스 기반 모노레포로 구성되어 있습니다.

| 패키지 | 역할 |
|---|---|
| [`@omdc-slipkit/core`](packages/core) | `.slip` 파일 검증, 수식 평가, 전표 조립, PDF 생성 및 파일 암호화를 제공합니다. DOM에 의존하지 않아 브라우저와 Node.js에서 사용할 수 있습니다. |
| [`@omdc-slipkit/elements`](packages/elements) | Lit으로 구현된 `<slip-designer>`, `<slip-form>`, `<slip-viewer>` Web Component를 제공합니다. |
| [`@omdc-slipkit/react`](packages/react) | SlipKit Web Component를 React 컴포넌트로 사용할 수 있게 합니다. |
| [`@omdc-slipkit/vue`](packages/vue) | SlipKit Web Component를 Vue 컴포넌트로 사용할 수 있게 합니다. |
| [`@omdc-slipkit/mcp`](packages/mcp) | AI가 MCP 도구로 양식을 만들고 고칠 수 있게 하는 로컬 MCP 서버를 제공합니다. |

## 로컬에서 실행하기

### 요구 환경

- Node.js 22.13 이상
- pnpm 10.33.0(Corepack으로 관리)
- `<slip-designer>`: 1440×810 이상의 데스크톱 브라우저 표시 영역

### 저장소 준비

의존성을 설치하기 전에 Corepack을 활성화합니다. 저장소 안에서 `pnpm`을 실행하면 Corepack이 `packageManager` 필드에 지정된 pnpm 10.33.0을 선택합니다.

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
corepack enable
pnpm --version
pnpm install
```

### 데모 실행

사용하는 환경에 맞는 데모 하나를 실행합니다.

```bash
# Web Component
pnpm demo

# React
pnpm demo:react

# Vue
pnpm demo:vue
```

| 데모 | 기본 주소 | 설명 |
|---|---|---|
| [`examples/demo`](examples/demo) | `http://localhost:5173` | Web Component를 직접 사용하는 예제 |
| [`examples/react-demo`](examples/react-demo) | `http://localhost:5174` | React 래퍼를 사용하는 예제 |
| [`examples/vue-demo`](examples/vue-demo) | `http://localhost:5175` | Vue 래퍼를 사용하는 예제 |

세 데모가 제공하는 기능은 같습니다. 양식 설계, 전표 작성, PDF 미리보기, `.slip` 파일 저장과 불러오기를 확인할 수 있습니다.

데모의 자동 저장과 파일 처리처럼 프레임워크에 의존하지 않는 로직은 [`examples/shared`](examples/shared)에 공통으로 구현되어 있습니다.

MCP 도구는 [MCP Inspector 데모](examples/mcp-demo)에서 직접 호출할 수 있습니다. 이 데모는 Node.js 22.19 이상이 필요합니다.

```bash
pnpm demo:mcp
```

명령을 실행하면 샘플 작업공간과 MCP 패키지를 준비한 뒤 `http://localhost:6274`에서 Inspector를 엽니다.

## 사용 가이드

처음 사용한다면 [시작하기](docs/guide/getting-started.ko.md)에서 저장소의 데모를 실행하고 디자이너를 연결해 보세요. 저장·복원과 세 컴포넌트의 연결 방법은 [애플리케이션 통합 가이드](docs/guide/integration.ko.md)에서 이어서 설명합니다.

전체 문서는 [SlipKit 가이드](docs/guide/README.ko.md)에서 목적별로 확인할 수 있습니다.

| 문서 | 내용 |
|---|---|
| [시작하기](docs/guide/getting-started.ko.md) | 데모 실행과 양식 디자이너의 최소 연결 |
| [애플리케이션 통합 가이드](docs/guide/integration.ko.md) | 디자이너·작성폼·뷰어 연결, 저장·복원 및 서버 연계 |
| [서버 통합 가이드](docs/guide/server-integration.ko.md) | Node.js 서버에서 전표를 발행하고 PDF를 생성·보관하는 방법 |
| [양식 디자이너 사용 가이드](docs/guide/designer.ko.md) | 디자이너 화면에서 양식을 제작하는 방법 |
| [Core 사용 가이드](docs/guide/core.ko.md) | `.slip` 파일 처리, 전표 조립, 수식 평가, PDF 생성과 암호화 |
| [MCP 사용 가이드](docs/guide/mcp.ko.md) | AI를 통한 `.slip` 양식 생성·수정, 전표 조립과 PDF 확인 |
| [환경 설정 가이드](docs/guide/configuration.ko.md) | 언어·폰트·용지·바코드·프리셋·저장소 설정 |
| [수식 함수 참조](docs/guide/formula.ko.md) | 수식 작성 규칙, 지원 함수와 사용 예제 |
| [API 참조](docs/guide/api-reference.ko.md) | 함수·타입·컴포넌트·이벤트·오류의 전체 참조 |

## 기술 문서

| 문서 | 내용 |
|---|---|
| [`.slip` 파일 형식 명세](docs/SPEC.md) | `.slip` 파일의 구조와 검증 규칙 |
| [아키텍처](docs/ARCHITECTURE.md) | 패키지 구조와 외부 시스템 연계 방식 |
| [요구사항](docs/REQUIREMENTS.md) | 확정된 제품 요구사항 |
| [설계 결정 기록](docs/DECISIONS.md) | 주요 설계 결정과 그 근거 |
| [로드맵](docs/ROADMAP.md) | 개발 현황과 예정 작업 |

## 개발 명령어

`pnpm typecheck`는 워크스페이스 패키지를 빌드할 때 생성된 타입 선언 파일을 사용합니다. 저장소를 새로 복제한 뒤에는 먼저 `pnpm build`를 실행해야 합니다.

```bash
# 코드 스타일 검사
pnpm lint

# 패키지 빌드
pnpm build

# 타입 검사
pnpm typecheck

# 테스트 실행
pnpm test

# 전체 검증 게이트
pnpm verify
```

`pnpm verify:packages`는 다섯 패키지를 다시 빌드하고 tarball로 만든 뒤 공개 파일과 타입 정보를
검사합니다. 이어서 깨끗한 npm·pnpm 소비자 프로젝트에 설치해 Node.js와 Chromium 시나리오를
실행합니다. 처음 실행하기 전 관리형 브라우저를 한 번 설치하세요.

```bash
pnpm exec playwright install chromium
pnpm verify:packages
```

## 라이선스

SlipKit은 [Business Source License 1.1](LICENSE)에 따라 제공됩니다. 소스 코드는 공개되어 있지만 현재 OSI 승인 오픈소스 라이선스는 아닙니다.

자체 애플리케이션에 SlipKit을 포함하는 프로덕션 사용은 허용됩니다. 다만 SlipKit과 경쟁하는 호스팅 또는 임베드형 상용 제품·서비스로 제3자에게 제공하는 경우에는 별도의 상용 라이선스가 필요합니다.

라이선스에 정해진 전환 시점이 되면 Apache License 2.0으로 전환됩니다. 정확한 사용 조건과 전환 시점은 [LICENSE](LICENSE)를 확인해 주세요.

동봉된 Pretendard와 Noto Sans JP 폰트에는 각각 SIL Open Font License 1.1이 적용됩니다.
