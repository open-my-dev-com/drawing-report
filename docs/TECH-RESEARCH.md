# 기술 최신동향 리서치 (2026-08 기준)

> 확정된 설계 결정(ADR)별로 2025~2026 생태계 동향을 조사한 결과.
> 결정을 뒤집는 내용이 아니라 **결정의 구현 수단을 최신 상태로 고르기 위한** 자료.
> 여기서 파생된 신규 쟁점은 OPEN-QUESTIONS.md에 등록한다 (Q-08).

---

## 1. ⚠️ 가장 중요한 발견: pdfme (ADR 전반과 관련)

[pdfme](https://github.com/pdfme/pdfme)는 우리 프로젝트와 **상당히 겹치는 오픈소스(MIT)** 다:

- TypeScript 기반, JSON 템플릿 중심의 PDF 생성 라이브러리
- **WYSIWYG 템플릿 디자이너** + 뷰어 + 생성기 제공, 브라우저/Node 양쪽 동작
- 동적 테이블 + **자동 페이지 분할** 지원, **CJK(한글 포함) 폰트·커스텀 TTF/OTF** 지원
- 주간 다운로드 3.3만+, GitHub 스타 3,400+ (2025-07 기준), 활발히 유지보수 중
- 원본 pdf-lib이 사실상 방치된 상황에서 **pdfme 팀이 자체 포크(pdfme/pdf-lib)를 유지보수** 중

우리 결정(JSON 템플릿, 브라우저 PDF 직접 생성, 자동 페이지 분할, GUI 디자이너)의 기술적 타당성을 실증하는 존재이자, "직접 다 만들 것인가, 이 위에 얹을 것인가"라는 전략 질문을 발생시킴 → **OPEN Q-08**.

우리 프로젝트와의 차이(그대로 채택할 수 없는 이유가 되는 지점):
- 디자이너가 React 기반(우리는 Web Component 배포가 확정 — 단 React 앱을 WC로 감싸는 것은 가능)
- 위변조 서명·암호화, 양식 스냅샷 내장, 저장소 어댑터, 권한 위임 인터페이스, 수식 엔진 같은 우리 확정 요구는 pdfme 범위 밖
- pdfme는 "PDF 생성 툴"이고 우리는 "전표 생애주기(작성·조회·검증·교환) 툴"

## 2. PDF 생성 (ADR-012 관련)

- 원본 [pdf-lib(Hopding)](https://github.com/pdfme/pdf-lib)은 수년째 릴리스가 없어 사실상 비유지보수. **커뮤니티는 pdfme/pdf-lib 포크를 사용하는 흐름** (버그픽스·기능 추가 지속).
- 브라우저+Node 양쪽에서 PDF를 "생성·조작"하는 카테고리에서는 여전히 pdf-lib 계열이 표준. jsPDF(간단 문서), pdfmake(선언적), PDFKit(Node 전용), Puppeteer(HTML→PDF, headless 브라우저 필요)가 대안이지만 우리 렌더 트리 방식(좌표 직접 드로잉)에는 pdf-lib 계열이 가장 적합.
- **결론: ADR-012 유효. 구현 시 pdf-lib은 pdfme 포크(`@pdfme/pdf-lib`)를 채택할 것.**

참고: [Nutrient JS PDF 라이브러리 비교](https://www.nutrient.io/blog/top-js-pdf-libraries/), [Joyfill 오픈소스 PDF 비교 2025](https://medium.com/joyfill/comparing-open-source-pdf-libraries-2025-edition-7e7d3b89e7b1)

## 3. Web Component 생태계 (ADR-003 관련)

- **React 19가 커스텀 엘리먼트를 완전 지원** — [Custom Elements Everywhere 테스트 전체 통과](https://aleks-elkin.github.io/posts/2024-12-06-react-19/). 속성/프로퍼티/이벤트를 래퍼 없이 직접 사용 가능. 즉 React용 "얇은 래퍼"는 React 18 이하 지원용으로만 필요하고, React 19+에서는 커스텀 엘리먼트를 그대로 쓰면 됨 ([`@lit/react` 필요성 논의](https://github.com/lit/lit/discussions/5068)).
- Vue는 원래부터 커스텀 엘리먼트 지원 우수. **"Web Component로 배포하면 어디서든 동작"이라는 ADR-003의 전제가 2025~26 들어 오히려 더 강화됨.**
- 구현 헬퍼로는 [Lit](https://lit.dev/docs/frameworks/react/)이 여전히 표준적 선택지 (Q-01 후보 유지).

## 4. 수식 엔진 (ADR-010 관련)

- [HyperFormula](https://github.com/handsontable/hyperformula) (Handsontable 팀, 400+ 함수)가 이 분야 대표지만 **라이선스가 GPLv3 + 상용 이중** — [비상용/오픈소스만 GPLv3 무료](https://hyperformula.handsontable.com/docs/guide/licensing.html). 우리처럼 외부 배포되는 패키지에 넣으면 설치자 전체에 GPL 전파 문제가 생기므로 **채택 불가**.
- 대안으로 MIT/Apache-2.0의 [Formualizer](https://docs.bswen.com/blog/2026-03-04-formualizer-vs-hyperformula-comparison/)(320+ 함수, 신생)가 부상 중.
- **결론: ADR-010(엄선 함수만 자체 파서로)이 라이선스 관점에서도 옳았음.** 함수 수요가 커지면 Formualizer 검토. 자체 파서 구현 시 문법은 엑셀 호환을 유지해 추후 엔진 교체 여지를 남길 것.

## 5. 스키마 검증 (ADR-007, Q-07 관련)

2025~26 TypeScript 검증 3강: [Zod 4 / Valibot / ArkType](https://jsonkit.in/blog/zod-v4-vs-valibot-vs-arktype)

- **Zod 4**: v3 대비 ~4배 빨라짐, 생태계 최대. **JSON Schema 변환이 코어에 내장**되어 우리의 "교환 포맷 스펙 공개(Q-07: JSON Schema 동봉)" 요구와 정확히 맞물림.
- **Valibot**: 트리셰이킹으로 단순 검증 시 1KB 미만 — 브라우저 배포 라이브러리에 유리.
- **ArkType**: 성능 최강(방향이 다름).
- **권고: core의 스키마 정의는 Zod 4** (타입 추론 + JSON Schema 산출 일석이조). 번들 크기가 문제 되면 Valibot 재검토.

## 6. GUI 디자이너 렌더링 기술 (ADR-005, Q-05 관련)

- 캔버스 기반이라면: [Fabric.js는 디자인 에디터용, Konva는 인터랙티브 UI용](https://www.pkgpulse.com/guides/fabricjs-vs-konva-vs-pixijs-canvas-2d-graphics-2026)이라는 구분이 정착. 자유 변형·회전이 많은 그래픽 에디터에는 Fabric.js.
- 단, **전표 디자이너는 캔버스가 필수가 아님**: pdfme를 포함한 다수의 양식 디자이너는 DOM(절대 위치 요소 + 드래그 핸들) 기반. 텍스트 편집·접근성·IME(한글 입력!) 처리가 DOM 쪽이 훨씬 수월. 우리는 요소가 사각형 중심(텍스트/표/이미지/선)이므로 **DOM 기반 디자이너 + 렌더 트리 미리보기**가 유력. 캔버스 라이브러리는 자유 도형 요구가 커질 때 재검토.

## 7. 한글 폰트 서브세팅 (ADR-012 관련)

- [subset-font](https://github.com/papandreou/subset-font) (HarfBuzz의 wasm 빌드 `hb-subset` 사용)가 사실상 표준. TTF/OTF/WOFF/WOFF2 입력, 브라우저·Node 양쪽 동작 → "사용 글자만 추려 PDF 내장" 파이프라인에 그대로 사용 가능.
- CJK 폰트에서 서브세팅은 성능상 필수라는 것이 일반적 결론. **ADR-012의 폰트 계획 실행 수단 확정: subset-font(harfbuzzjs).**

## 8. 위변조 방지 서명 (ADR-009, Q-04 관련)

- JSON 서명의 표준은 **JWS ([RFC 7515](https://datatracker.ietf.org/doc/html/rfc7515), JOSE)**. 브라우저 Web Crypto API로 구현 가능.
- 2025 모범 사례: 알고리즘 명시적 허용목록(`none` 금지), 키 회전용 `kid` 헤더, 검증자가 외부라면 **비대칭 서명(ES256 또는 EdDSA)** 사용 ([JWS 가이드](https://jsonic.io/guides/json-web-signature)).
- Q-04 논의를 위한 권고 초안: 전표 서명은 JWS(ES256) + 서명 대상은 정규화(canonicalization, JCS 계열)된 전표 전체(스냅샷 포함), 서명 키는 호스트 서버 보관(권한 위임 원칙에 부합).

## 9. 모노레포 도구 (ADR-002 구현 관련)

- 2025~26 기본값: **pnpm workspaces + Turborepo** — [소규모 팀 표준, 1시간 내 세팅](https://www.devlume.com/insights/typescript-monorepo-turborepo-vs-nx). Nx는 프로젝트 수가 크게 늘 때 이관(공식 마이그레이션 경로 존재).
- **권고: pnpm workspaces + Turborepo로 스캐폴딩.**

---

## 요약: 결정별 영향

| ADR | 리서치 결과 |
|---|---|
| ADR-003 (Web Component) | ✅ 강화됨 — React 19 완전 지원으로 래퍼 부담까지 감소 |
| ADR-007 (JSON 스키마) | ✅ 유효 — Zod 4로 정의하면 JSON Schema 공개(Q-07)까지 해결 |
| ADR-010 (자체 수식 파서) | ✅ 유효 — 대표 엔진(HyperFormula)이 GPL이라 오히려 필연 |
| ADR-011 (자동 페이지 분할) | ✅ 실현 가능성 실증 — pdfme가 동일 기능을 프로덕션에서 구현 |
| ADR-012 (렌더 트리+pdf-lib) | ✅ 유효 — 단 pdf-lib은 **pdfme 포크** 채택, 폰트는 subset-font |
| 신규 쟁점 | ⚠️ **Q-08**: pdfme를 기반으로 할지, 참조만 할지 전략 결정 필요 |
