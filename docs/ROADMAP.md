# 로드맵 / 세션 인수인계

최종 갱신: 2026-08-19 (npm 패키지명 @omdc-slipkit/*로 변경 — ADR-027. v1 로드맵 전체 완료)

## 현재 상태

- 요구사항·설계 결정 **전부 확정** (ADR-001~027) — [DECISIONS.md](DECISIONS.md)
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
- **디자이너 다중 페이지 완료**: 툴바에서 페이지 전환(◀ 1/2 ▶)·추가·삭제(최소 1페이지 유지). 요소 편집·추가·붙여넣기는 현재 페이지 대상, 페이지 조작도 되돌리기 지원 (ADR-026, Q-10 해결)

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

## v1 이후 (v2 후보 — 미정리, 다음에 사용자와 함께 정리)

- 에디터 화면 구성·버튼 아이콘 커스터마이즈 (2026-08-19 사용자 요청으로 v2 배정)
- 레이어 패널(페이지 내 요소 목록 UI), 요소 그룹화, 표 중첩 (ADR-020)
- 동적 행 표 셀 병합 (ADR-020), 프리셋 확충
- VLOOKUP류 수식 함수 (ADR-017)
- 사소 개선 후보: 뷰어·디자이너 PDF 미리보기 로직 공용화, `toText`/`toDisplayText` 상호 참조 주석
- 코드리뷰(2026-08-19)에서 보류한 항목: undo 스냅샷 총 바이트 상한(이미지 큰 양식 대비), IndexedDB `list()` 메타 분리·커서 순회(대량 저장 대비), 테스트 헬퍼 공용화, LocalFileStorage 취소 감지 폴백
- **npm 공개 전 체크리스트**: 패키지 4종에 `license`·`repository` 필드 결정·추가 필요

## 진행 방식 메모

- 모든 결정은 사용자 Q&A로 확정하며 DECISIONS.md에 ADR로 기록, REQUIREMENTS.md와 일치하도록 유지 (README의 문서 운영 규칙 참조)
- 새 쟁점은 OPEN-QUESTIONS.md에 다음 Q 번호로 추가
