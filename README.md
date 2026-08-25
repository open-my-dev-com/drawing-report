# SlipKit

[English](README.en.md) · [日本語](README.ja.md)

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
- 수식, 표, 이미지, 도형 및 바코드 지원
- IndexedDB와 로컬 파일 기반 저장소 어댑터
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

> SlipKit은 현재 공개 전 검토 단계입니다.

`@omdc-slipkit/*` 패키지는 아직 npm 레지스트리에 배포되지 않았습니다. 현재 버전은 저장소를 복제하여 데모와 소스 코드로 확인할 수 있습니다.

## 패키지 구성

SlipKit은 pnpm 워크스페이스 기반 모노레포로 구성되어 있습니다.

| 패키지 | 역할 |
|---|---|
| [`@omdc-slipkit/core`](packages/core) | `.slip` 파일 검증, 수식 평가, 전표 조립, PDF 생성 및 파일 암호화를 제공합니다. DOM에 의존하지 않아 브라우저와 Node.js에서 사용할 수 있습니다. |
| [`@omdc-slipkit/elements`](packages/elements) | Lit으로 구현된 `<slip-designer>`, `<slip-form>`, `<slip-viewer>` Web Component를 제공합니다. |
| [`@omdc-slipkit/react`](packages/react) | SlipKit Web Component를 React 컴포넌트로 사용할 수 있게 합니다. |
| [`@omdc-slipkit/vue`](packages/vue) | SlipKit Web Component를 Vue 컴포넌트로 사용할 수 있게 합니다. |

## 로컬에서 실행하기

### 요구 환경

- Node.js 20 이상
- pnpm 10.33.0

### 저장소 준비

```bash
git clone https://github.com/open-my-dev-com/drawing-report.git
cd drawing-report
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

## 사용 가이드

애플리케이션에 SlipKit을 연결하는 방법은 다음 문서에서 확인할 수 있습니다.

| 문서 | 내용 |
|---|---|
| [사용 가이드](docs/guide/README.md) | 패키지 구성, 빠른 시작, 컴포넌트 API, 이벤트 및 저장소 연계 |
| [양식 디자이너 가이드](docs/guide/designer.md) | 디자이너 화면과 양식 제작 기능 |
| [Core API 가이드](docs/guide/core.md) | 파일 처리, 전표 조립, 수식 평가 및 PDF 생성 |
| [수식 함수 참조](docs/guide/formula.md) | 지원하는 수식 함수와 사용 예제 |
| [타입 참조](docs/guide/types.md) | 주요 타입과 필드 정의 |
| [폰트 및 프리셋](docs/guide/fonts-and-presets.md) | 기본 폰트, 사용자 폰트 및 양식 프리셋 설정 |

## 기술 문서

| 문서 | 내용 |
|---|---|
| [`.slip` 파일 형식 명세](docs/SPEC.md) | `.slip` 파일의 구조와 검증 규칙 |
| [아키텍처](docs/ARCHITECTURE.md) | 패키지 구조와 외부 시스템 연계 방식 |
| [요구사항](docs/REQUIREMENTS.md) | 확정된 제품 요구사항 |
| [설계 결정 기록](docs/DECISIONS.md) | 주요 설계 결정과 그 근거 |
| [로드맵](docs/ROADMAP.md) | 개발 현황과 예정 작업 |

## 개발 명령어

```bash
# 코드 스타일 검사
pnpm lint

# 타입 검사
pnpm typecheck

# 패키지 빌드
pnpm build

# 테스트 실행
pnpm test
```

## 라이선스

SlipKit은 [Business Source License 1.1](LICENSE)에 따라 제공됩니다. 소스 코드는 공개되어 있지만 현재 OSI 승인 오픈소스 라이선스는 아닙니다.

자체 애플리케이션에 SlipKit을 포함하는 프로덕션 사용은 허용됩니다. 다만 SlipKit과 경쟁하는 호스팅 또는 임베드형 상용 제품·서비스로 제3자에게 제공하는 경우에는 별도의 상용 라이선스가 필요합니다.

라이선스에 정해진 전환 시점이 되면 Apache License 2.0으로 전환됩니다. 정확한 사용 조건과 전환 시점은 [LICENSE](LICENSE)를 확인해 주세요.

동봉된 Pretendard와 Noto Sans JP 폰트에는 각각 SIL Open Font License 1.1이 적용됩니다.
