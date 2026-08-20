# 로드맵 / 세션 인수인계

최종 갱신: 2026-08-20 (B-8 좌표 기준점 완료 — B 묶음 전부 완료. 사용자 확인·피드백 대기, 피드백 반영 후 C-9 파일 포맷 0.2.0 진행)

## 현재 상태

- 요구사항·설계 결정 **전부 확정** (ADR-001~030) — [DECISIONS.md](DECISIONS.md)
- `main` = 기준 브랜치 (부트스트랩 브랜치를 개명). 이후 작업은 [`.claude/rules/branching.md`](../.claude/rules/branching.md) 규칙대로 분기
- pnpm 모노레포 스캐폴딩 완료(4패키지 빌드·타입체크·테스트 통과) — PR [#1](https://github.com/open-my-dev-com/drawing-report/pull/1)
- **파일 포맷 완료**: [SPEC.md](SPEC.md) 규범 명세 + `.slip` 본문 상세 Zod 스키마(요소 6종·발행 규칙 검증) + schemaVersion 마이그레이션 계층 + JSON Schema 산출·동봉 (ADR-007/008/014/019/020/022)
- **수식 엔진 완료**: 자체 토크나이저·파서(`eval` 금지, 미등록 함수는 파싱 단계 거부) + 평가기(IF/AND/OR 지연 평가, `items.금액` 범위 참조) + 함수 29종 (ADR-010/017)
- **PDF 렌더러 완료**: `.slip` → pdfme 변환 계층(요소 6종 매핑, 고정 그리드는 선·사각형·텍스트 분해, 표 스타일 기본값 병합) + pdfme 외부 비공개(공개 API에 pdfme 노출 0건) + field 수식 평가 연동 + 자동 페이지 분할 확인 (ADR-011/016)
- **무결성 완료**: RFC 8785(JCS) 정규화 + SHA-256 해시 + JWS(ES256) 서명·검증, 외부 의존 없이 Web Crypto API 직접 구현 (ADR-019, SPEC §8)
- **뷰어 완료**: `<slip-viewer>` Lit 웹컴포넌트 — `.slip` → PDF 렌더링 → iframe 미리보기. 화면·PDF 불일치가 구조적으로 불가능 (ADR-012/016). UI 문구 리소스 파일 분리 (ADR-013)
- **디자이너 코어 완료**: `<slip-designer>` Lit 웹컴포넌트 — 양식 편집기 기본 기능. 캔버스에 용지·요소 표시, 요소 선택·드래그 이동, 속성 패널 편집, 6종 요소 추가·삭제, 되돌리기·다시 실행, PDF 미리보기 전환 (ADR-020)
- **디자이너 스냅·크기 조절 완료**: 드래그·크기 조절 시 다른 요소 가장자리·중앙선과 용지 여백선에 자동으로 붙고 정렬 안내선 표시(Alt로 해제). 선택 요소에 8방향 크기 조절 핸들(최소 2mm) (ADR-020)
- **디자이너 복사·붙여넣기 완료**: 툴바 버튼·Ctrl+C/V로 선택 요소를 복사해 5mm씩 계단식으로 어긋난 위치에 새 요소로 추가(새 id 부여, 되돌리기 지원). 입력 필드 안에서는 단축키를 가로채지 않음 (ADR-020)
- **디자이너 프리셋 완료 — GUI 디자이너(ADR-020 범위) 전부 완료**: 거래명세서·청구서 프리셋 2종 동봉(`presets` 공개 API). 툴바 선택 상자로 프리셋을 불러 양식 전체를 교체(되돌리기 지원). 프리셋 유효성은 실제 core 스키마(`parseSlipFile`)로 테스트
- **저장소 어댑터 완료**: 인터페이스(`StorageAdapter`)·오류(`SlipStorageError`)는 core, 브라우저 구현 2종은 elements — `IndexedDbStorage`(save/load/delete/list, 제목·종류 필터, 커서 페이징) + `LocalFileStorage`(save=다운로드, load=파일 선택, delete/list는 `unsupported` 오류) (ADR-021/025, Q-09 해결)
- **국제화 반영 완료**: 수식 포맷 함수 로케일 지정(`RenderOptions.locale`, ADR-013) + UI 영어 사전·`locale` 전환(뷰어·디자이너·래퍼·저장소 어댑터, 기본 한국어, ADR-028)
- **디자이너 다중 페이지 완료**: 툴바에서 페이지 전환(◀ 1/2 ▶)·추가·삭제(최소 1페이지 유지). 요소 편집·추가·붙여넣기는 현재 페이지 대상, 페이지 조작도 되돌리기 지원 (ADR-026, Q-10 해결)
- **주석 표준 TSDoc 완료**: 선언 설명 주석은 TSDoc 블록, 구현 설명은 `//` 유지 (ADR-029, 규칙 `.claude/rules/comments.md`). 공개 API 전체에 문서 주석 채움 + 공개 함수에 `@param`·`@returns`·`@throws` 기본 채움
- **TSDoc 형식 lint 게이트 완료**: eslint 최소 구성(`tsdoc/syntax` 단일 규칙) 도입, 검증 게이트가 `pnpm lint && pnpm -r typecheck && build && test` 4단계로 확장 (ADR-030, Q-11 해결). `@param`·`@returns` 누락은 도구가 못 잡으므로 지침·리뷰로 유지

## 다음 작업 (권장 순서)

1. ~~`chore/repo-monorepo-setup` → main PR 병합~~ → **완료** (#1)
2. ~~`feat/core-file-format` — SPEC.md + 상세 Zod 스키마 + 마이그레이션 + JSON Schema~~ → **완료** (#2)
3. ~~`feat/core-formula-parser` — 수식 파서·평가기, 함수 29종 구현 (ADR-010/017)~~ → **완료**
4. ~~`feat/core-pdf-renderer` — 우리 포맷 → pdfme 템플릿 변환 계층 + pdfme 외부 비공개 (ADR-016)~~ → **완료**
5. ~~`feat/core-integrity` — SHA-256 해시 + JWS(ES256) 서명, JCS(RFC 8785) 정규화 (ADR-019, [SPEC.md](SPEC.md) §8이 규범)~~ → **완료**
6. ~~`feat/elements-viewer` — `<slip-viewer>` 실제 렌더링 (미리보기 = PDF 변환 결과 공유)~~ → **완료**
7. ~~`feat/elements-designer-*` — GUI 디자이너 (ADR-020 범위)~~ → **전부 완료**
   - ~~`feat/elements-designer-core` — 캔버스·선택·이동·속성 편집·추가·삭제·되돌리기·미리보기~~ → **완료**
   - ~~`feat/elements-designer-snap` — 스냅·정렬 안내선, 크기 조절 핸들~~ → **완료**
   - ~~`feat/elements-designer-clipboard` — 복사·붙여넣기~~ → **완료**
   - ~~`feat/elements-designer-presets` — 거래명세서·청구서 프리셋~~ → **완료**
8. ~~`feat/core-storage-adapters` — 로컬 파일·IndexedDB 어댑터 (ADR-021)~~ → **완료** (구현 위치는 ADR-025)

### 마무리 단계 (기능 작업 전부 완료 후)

9. `chore/repo-final-review` — 총괄 리뷰·시스템 점검·보안 점검 → **완료** (2026-08-19)
   - **점검 완료(이상 없음)**: 불변 규칙 위반 0건(`eval` 0건 ADR-010, pdfme 공개 API 노출 0건 ADR-016, core 순수 TS ADR-002), 패키지 의존 방향 단방향(react/vue → elements → core), 수식 함수 29종 ADR-017 일치, 무결성 구현 SPEC §8 일치(해시 대상·JCS 정규화·JWS ES256), JSON Schema 산출물이 현재 스키마와 동일함 직접 확인, 금지어 잔존 0건
   - **이 브랜치에서 처리**: 의존성 취약점 해소(esbuild low 1건 → override로 0건), 미사용 코드·중복 타입 정리, 하드코딩 UI 문구 2건 strings.ts 경유, 문서 표기 갱신(ADR 범위·날짜·SPEC 좌표 음수 금지 명시)
   - ~~① `fix/core-spec-alignment` — 비율 합 오차 경계(±0.01 포함으로), assets 항목 자기 `asset://` 참조 검증, `validateSlipFile`·`supportsVersions` 테스트 보강~~ → **완료**
   - ~~② `fix/repo-framework-wrappers` — react/vue 래퍼에 `SlipDesigner`·`fonts`·`slip-change` 노출~~ → **완료**
   - ~~③ `feat/elements-designer-pages` — 디자이너 페이지 전환·추가·삭제 UI (Q-10 → ADR-026, v1 포함 확정)~~ → **완료**
   - **후속 전부 완료 → 9번 종료.** 남은 로드맵 항목은 10번(결합 테스트)뿐
   - 기록해 둔 사소 개선 후보(처리 보류): 뷰어·디자이너 PDF 미리보기 로직 공용화, `toText`/`toDisplayText` 문자열화 규칙 상호 참조 주석
10. ~~`chore/repo-integration-test` — 시스템 결합 테스트 + 데모 앱~~ → **완료** (2026-08-19)
   - 결합 시나리오 테스트(모킹 없음): 디자이너로 양식 편집 → `.slip` 직렬화·재파싱 → 전표 값·수식 평가 → 실제 PDF 렌더 → 해시·서명 기록·검증·위조 감지 → IndexedDB 저장·조회
   - react/vue 래퍼 실동작 테스트: 실제 react-dom·vue로 마운트해 `src`/`fonts` 전달과 `slip-change` 수신 확인
   - **데모 앱 동봉**(`examples/demo`): `pnpm demo`로 브라우저에서 전체 기능 확인. 라이브러리 소스 직접 참조라 수정이 바로 반영됨. 호스트 앱 연동 예시 겸용

## v2 계획 (확정 — [ADR-031](DECISIONS.md), 2026-08-19)

테마: **디자이너 사용 편의**. 사용자가 데모 화면을 직접 점검하며 낸 요구를 기반으로 범위 확정.
기술 방향: Lit 유지 + 자체 CSS 디자인 토큰, 기본 한글 폰트 Pretendard 동봉. 상세는 ADR-031.

### 권장 순서 (한 브랜치 = 한 항목, v1과 동일한 진행 방식)

**A. 기초 품질 — 즉시 체감되는 결함·미이행 해소**

1. ~~`fix/elements-designer-line-preview` — 선 캔버스 대각선 표시 버그 (PDF는 직선인데 캔버스만 사선)~~ → **완료**
2. ~~`feat/elements-default-font` — Pretendard Regular·Bold 동봉, 폰트 미지정 시 자동 사용 (미리보기 한글 깨짐 해소, ADR-012 이행)~~ → **완료**
3. ~~`feat/elements-designer-live-style` — 캔버스에 글자 크기·정렬·색 즉시 반영~~ → **완료** (고정 그리드 셀 문구·병합 표시, 동적 표 머리행 배경 포함)
4. ~~`chore/elements-designer-ui-polish` — CSS 디자인 토큰 정리, 속성 패널 가로 스크롤 제거, 툴바 아이콘 버튼+툴팁, 정렬 아이콘 토글, 색 피커(팔레트+색상판+투명도)~~ → **완료** (테두리 굵기 편집 추가. 테두리 모양(파선 등)은 PDF 변환 미지원이라 UI 제외 — 지원 시점에 함께 추가)
   - ~~후속 조정 (2026-08-20): 툴바를 아이콘+아래 작은 이름+기능 그룹 묶음으로, 색 입력을 색 버튼 하나로 통합(누르면 팔레트·색상판·투명도 펼침), 색 미지정을 없음 표시로~~ → **완료**

**B. 편집 상호작용**

5. ~~`feat/elements-designer-draw-create` — 도구 선택 후 드래그로 위치·크기 지정 생성 (클릭만 하면 기본 크기)~~ → **완료** (도구 버튼 눌림 표시·점선 미리보기·Esc 취소. 이전 UI 작업(A-4) 추가 수정도 함께 처리: 프리셋 선택 상자를 아이콘 버튼+메뉴로, 색 버튼 한 번에 견본·색상판·색조·투명도가 전부 펼쳐지게(별도 창 없음), 속성 패널 라벨 폭 고정으로 입력 박스 시작 위치 통일)
6. ~~`feat/elements-designer-form-settings` — 요소 미선택 시 양식 설정 패널: 제목·용지 크기·방향·여백 (v1 §10 용지 설정 이행)~~ → **완료** (용지 프리셋 A4·A5·B5·Letter+직접 입력, 방향 전환은 너비·높이 맞바꿈 — 파일 포맷 불변. 여백 합이 용지를 넘는 값은 무시)
7. ~~`feat/elements-designer-sidebar` — 왼쪽 사이드바: 페이지 썸네일(클릭 이동), 요소(레이어) 목록, 바인딩 값 목록~~ → **완료** (썸네일에 요소 축소 상자 표시·현재 페이지 강조, 요소 목록 클릭 선택, 바인딩은 양식 전체에서 모아 클릭 시 페이지 이동+선택. 미리보기 모드에선 숨김)
8. ~~`feat/elements-designer-anchor` — 좌표 기준점 선택(좌상~우하 9점): 속성 패널 X·Y를 선택한 기준점으로 표시·입력, 기준 변경 시 자동 환산. 파일에는 늘 좌상단 좌표로 저장(포맷 불변) — 2026-08-20 추가~~ → **완료** (3×3 점 격자로 선택, 기준 변경만으로는 파일이 바뀌지 않음. **B 묶음 전부 완료 — 사용자 확인·피드백 후 C 진행**)

**C. 파일 포맷 0.2.0 + 표·도형·글자**

9. `feat/core-format-0-2` — 스키마 개정: 동적 표 열 구조(키·제목·너비 분리), **선 시작·끝점(자유선·사선 — 필수, 2026-08-19 확정. A-1의 캔버스 선 표시가 그려지지 않는 문제도 이 방식으로 함께 해소)**, 타원·삼각형, 굵게·밑줄·취소선, `sampleValues`, 요소 그룹 필드, **바인딩 정의부(2026-08-20 확정): 물리명 `key` + 논리명 `label` 목록 — 화면에는 논리명, 파일·수식·백엔드 연동은 물리명. 동봉 프리셋 바인딩도 camelCase 물리명 + 한국어 논리명으로 전환**. SPEC·마이그레이션·JSON Schema 동시 갱신
10. `feat/elements-designer-table-edit` — 표 내부 편집: 고정 그리드 행·열·셀 텍스트·병합, 동적 표 열 편집 (콤마 나열 입력 폐지)
11. `feat/elements-designer-shape-text` — 도형 그리기(선·타원·삼각형)·글자 스타일(굵게·밑줄·취소선) UI

**D. 데이터·작성 흐름**

12. `feat/elements-designer-formula-modal` — 수식 편집 모달: 함수 29종 분류·설명·클릭 삽입, 바인딩 목록, 실시간 문법 검사, 결과 미리 계산
13. `feat/elements-designer-sample-preview` — 샘플 데이터(`sampleValues`) 편집 + 채운 상태로 PDF 미리보기 + **사이드바에서 바인딩 등록·삭제·논리명 편집(2026-08-20 확정 — 요소 없이도 바인딩을 미리 정의해 필드·수식에서 골라 쓰게)**
14. `feat/elements-slip-form` — 전표 작성폼 `<slip-form>`: 값 입력·동적 표 행 추가·수식 즉시 계산·발행(무결성 기록)
15. `feat/elements-user-presets` — 프리셋 주입 API + "내 양식으로 저장"·제목별 목록 불러오기 + 양식 제목 편집
16. `chore/demo-usability` — 데모 자동 저장·복원, 기술 용어 없는 문구, 파일명 지정

**E. 고급 편집 (v3 후보에서 v2로 승격 — 2026-08-19, "완성된 도구를 만든 뒤 MCP를 연다")**

17. `feat/core-formula-lookup` — VLOOKUP류(범위 검색) 함수 추가 (세부 목록은 착수 시 ADR-017 개정)
18. `feat/elements-designer-grouping` — 요소 그룹화 UI: 묶기/해제, 그룹 단위 선택·이동 (스키마 필드는 9번에 선반영)
19. `feat/core-table-merge` — 동적 표 셀 병합: 스키마 0.3.0 + 변환 계층(분해 렌더 검토) + 디자이너 편집
20. `feat/core-table-nesting` — 표 중첩: 스키마 0.3.0 범위 + 변환 + 디자이너 편집
21. `feat/elements-presets-more` — 동봉 프리셋 확충 (견적서·영수증 등)

## v3 = MCP + AI (미정리 — 착수 전 사용자와 정리)

- **MCP 제공 + AI 전표 자동 생성**만 다룬다 (2026-08-19 사용자 지정. 사전 리서치 완료 — 실현성 높음)
- 편집 기능이 충분히 완성된 뒤 연동을 여는 것이 무난하다는 판단으로 고급 편집은 v2 E 묶음으로 승격

## 유지보수 백로그 (버전 무관)

- 사소 개선: 뷰어·디자이너 PDF 미리보기 로직 공용화, `toText`/`toDisplayText` 상호 참조 주석
- 코드리뷰(2026-08-19) 보류 항목: undo 스냅샷 총 바이트 상한, IndexedDB `list()` 메타 분리·커서 순회, 테스트 헬퍼 공용화, LocalFileStorage 취소 감지 폴백
- **npm 공개 전 체크리스트**: 패키지 4종에 `license`·`repository` 필드 결정·추가 필요

## 진행 방식 메모

- 모든 결정은 사용자 Q&A로 확정하며 DECISIONS.md에 ADR로 기록, REQUIREMENTS.md와 일치하도록 유지 (README의 문서 운영 규칙 참조)
- 새 쟁점은 OPEN-QUESTIONS.md에 다음 Q 번호로 추가
