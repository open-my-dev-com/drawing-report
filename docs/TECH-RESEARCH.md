# 기술 최신동향 리서치 (2026-08 기준)

> [!IMPORTANT]
> 확정된 설계 결정 내용으로 2025~2026의 전표 관련 생태계 동향을 조사한 결과 자료입니다.
> 여기서 파생된 신규 쟁점은 OPEN-QUESTIONS.md에 등록합니다.

---

## 1. pdfme

[pdfme](https://github.com/pdfme/pdfme)는 이 프로젝트에서 유용하게 활용할 수 있는 **오픈소스(MIT)** 입니다:

1) 특징 : 
- TypeScript 기반, JSON 템플릿 중심의 PDF 생성 라이브러리
- **WYSIWYG 템플릿 디자이너** + 뷰어 + 생성기 제공, 브라우저/Node 양쪽 동작
- 동적 테이블 + **자동 페이지 분할** 지원, **CJK(한글 포함) 폰트·커스텀 TTF/OTF** 지원
- 주간 다운로드 3.3만+, GitHub 스타 3,400+ (2025-07 기준), 활발히 유지보수 중
- 원본 pdf-lib이 사실상 방치된 상황에서 **pdfme 팀이 자체 포크(pdfme/pdf-lib)를 유지보수** 중

이 프로젝트의 개발 방향성(JSON 템플릿, 브라우저 PDF 직접 생성, 자동 페이지 분할, GUI 디자이너)의 기술적 타당성을 실증하는 존재로 사려됩니다.

2) 아 프로젝트와의 차이점? :
- 디자이너가 React 기반(이 쪽의 경우 Web Component, React환경, Vue환경 래퍼를 통한 배포 계획)
- 위변조 서명·암호화, 양식 스냅샷 내장, 저장소 어댑터, 권한 위임 인터페이스, 수식 엔진 같은 기능의 경우 이 프로젝트에 있고 pdfme엔 범위 밖의 내용
- pdfme는 "PDF 생성 툴"이고 우리는 "전표 작성·조회·검증·교환 툴"

## 2. 그 밖의 PDF 생성

- 원본 [pdf-lib(Hopding)](https://github.com/pdfme/pdf-lib)은 수년째 릴리스가 없어 사실상 비유지보수. **커뮤니티는 pdfme/pdf-lib 포크를 사용하는 흐름** (버그픽스·기능 추가 지속).
- 브라우저+Node 양쪽에서 PDF를 "생성·조작"하는 카테고리에서는 여전히 pdf-lib 계열이 표준. jsPDF(간단 문서), pdfmake(선언적), PDFKit(Node 전용), Puppeteer(HTML→PDF, headless 브라우저 필요)가 대안이지만 우리 렌더 트리 방식(좌표 직접 드로잉)에는 pdf-lib 계열이 가장 적합.

> 참고자료
> [Nutrient JS PDF 라이브러리 비교](https://www.nutrient.io/blog/top-js-pdf-libraries/)
> [Joyfill 오픈소스 PDF 비교 2025](https://medium.com/joyfill/comparing-open-source-pdf-libraries-2025-edition-7e7d3b89e7b1)

## 3. Web Component 생태계

- React와 Vue이외에도 각각의 웹 환경에 맞는 패키지 지원을 원하여 채택하였습니다.

1) React
- **React 19는 커스텀 엘리먼트를 완전 지원** 
> [Custom Elements Everywhere 테스트 전체 통과](https://aleks-elkin.github.io/posts/2024-12-06-react-19/). 
> 속성/프로퍼티/이벤트를 래퍼 없이 직접 사용 가능. 즉 React용 "얇은 래퍼"는 React 18 이하 지원용으로만 필요하고, React 19+에서는 커스텀 엘리먼트를 그대로 쓰면 됨 ([`@lit/react` 필요성 논의](https://github.com/lit/lit/discussions/5068)).

2) Vue
- Vue는 원래부터 커스텀 엘리먼트 지원 우수. 

3) 그 외
- 구현 헬퍼로는 [Lit](https://lit.dev/docs/frameworks/react/)이 여전히 표준적 선택지입니다.

## 4. 수식 엔진 (함수 지원 엔진)

>　[!NOTE]
> 결론부터 말하면 모든 함수가 필요한 상황이 아니므로 이 내용은 자체 제작으로 결정하였습니다.

- [HyperFormula](https://github.com/handsontable/hyperformula) (Handsontable 팀, 400+ 함수)가 이 분야 대표지만 **라이선스가 GPLv3 + 상용 이중** — [비상용/오픈소스만 GPLv3 무료](https://hyperformula.handsontable.com/docs/guide/licensing.html). 우리처럼 외부 배포되는 패키지에 넣으면 설치자 전체에 GPL 전파 문제가 생기므로 **채택 불가**.
- 대안으로 MIT/Apache-2.0의 [Formualizer](https://docs.bswen.com/blog/2026-03-04-formualizer-vs-hyperformula-comparison/)(320+ 함수, 신생)가 부상 중.

## 5. 스키마 검증

> 2025~26 TypeScript 검증 3강: [Zod 4 / Valibot / ArkType](https://jsonkit.in/blog/zod-v4-vs-valibot-vs-arktype)

- **Zod 4**: v3 대비 ~4배 빨라짐, 생태계 최대. **JSON Schema 변환이 코어에 내장**되어 우리의 "교환 포맷 스펙 공개(Q-07: JSON Schema 동봉)" 요구와 정확히 맞물림.
- **Valibot**: 트리셰이킹으로 단순 검증 시 1KB 미만 — 브라우저 배포 라이브러리에 유리.
- **ArkType**: 성능 최강(방향이 다름).
- **권고: core의 스키마 정의는 Zod 4** (타입 추론 + JSON Schema 산출 일석이조). 번들 크기가 문제 되면 Valibot 재검토.

## 6. GUI 디자이너 렌더링 기술

- 아예 전부가 캔버스 기반이라면: [Fabric.js는 디자인 에디터용, Konva는 인터랙티브 UI용](https://www.pkgpulse.com/guides/fabricjs-vs-konva-vs-pixijs-canvas-2d-graphics-2026)이라는 구분이 정착. 자유 변형·회전이 많은 그래픽 에디터에는 Fabric.js.
- 단, **전표 디자이너는 캔버스가 필수가 아님**: pdfme를 포함한 다수의 양식 디자이너는 DOM(절대 위치 요소 + 드래그 핸들) 기반. 텍스트 편집·접근성·IME(한글 입력!) 처리가 DOM 쪽이 훨씬 수월. 우리는 요소가 사각형 중심(텍스트/표/이미지/선)이므로 **DOM 기반 디자이너 + 렌더 트리 미리보기**가 유력. 캔버스 라이브러리는 자유 도형 요구가 커질 때 재검토.

## 7. 전표의 위변조 방지 서명

- JSON 서명의 표준은 **JWS ([RFC 7515](https://datatracker.ietf.org/doc/html/rfc7515), JOSE)**. 브라우저 Web Crypto API로 구현 가능합니다.
- 2025 모범 사례: 알고리즘 명시적 허용목록(`none` 금지), 키 회전용 `kid` 헤더, 검증자가 외부라면 **비대칭 서명(ES256 또는 EdDSA)** 사용 ([JWS 가이드](https://jsonic.io/guides/json-web-signature)).

## 8. 모노레포 도구

- 2025~26 기본값: **pnpm workspaces + Turborepo** — [소규모 팀 표준, 1시간 내 세팅](https://www.devlume.com/insights/typescript-monorepo-turborepo-vs-nx). Nx는 프로젝트 수가 크게 늘 때 이관(공식 마이그레이션 경로 존재).


