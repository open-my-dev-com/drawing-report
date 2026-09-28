# 설계 대상 등록부

최종 갱신: 2026-09-28

## 개요

기본설계에서 작성할 문서 74개의 식별자, 파일 경로, 작성 상태와 근거를 관리합니다. 대상은 현재
구현에서 독립적인 입력·처리·상태·출력을 가진 단위로 정했으며 소스 함수나 버튼 하나마다 나누지
않았습니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | 74개 설계 대상을 등록하고 구현·규범 문서와의 기술 검토를 모두 마쳤습니다. |

## 상태 기준

| 상태 | 의미 |
| --- | --- |
| 예정 | 대상과 근거는 확정했지만 파일을 만들지 않았습니다. |
| 작성 중 | 문서 파일을 만들었고 내용 검토가 남았습니다. |
| 작성 완료 | 내용 작성과 문서 형식 검증을 마쳤습니다. |
| 검토 완료 | 실제 구현과의 기술적 사실 확인까지 마쳤습니다. |

## 요약

| 유형 | 수량 |
| --- | ---: |
| 공통 설계 | 6 |
| 화면 설계 | 17 |
| 기능 설계 | 25 |
| 데이터 설계 | 11 |
| 인터페이스 설계 | 10 |
| 오류 설계 | 5 |
| 합계 | 74 |

## 작업 단계

| 순서 | 커밋 단계 | 문서 범위 | 수량 |
| ---: | --- | --- | ---: |
| 1 | 공통·데이터 설계 | `SYS-001`~`SYS-006`, `DAT-001`~`DAT-011` | 17 |
| 2 | 공개 인터페이스 설계 | `IF-001`~`IF-010` | 10 |
| 3 | Core 기능 설계 | `FNC-001`~`FNC-018` | 18 |
| 4 | UI·MCP 기능 설계 | `FNC-019`~`FNC-025` | 7 |
| 5 | 디자이너 화면 설계 | `SCR-001`~`SCR-013`, `SCR-017` | 14 |
| 6 | 실행 화면·오류 설계 | `SCR-014`~`SCR-016`, `ERR-001`~`ERR-005` | 8 |

각 단계는 앞 단계의 문서 검증과 커밋을 마친 뒤 시작합니다. 문서 파일을 추가하는 커밋에서 해당
대상의 상태를 `작성 중` 이상으로 바꾸고 추적표를 함께 갱신합니다. 전체 단계가 끝난 뒤 하나의 PR로
검토합니다.

## 공통 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| SYS-001 | 시스템 개요와 적용 범위 | `docs/design/00-common/SYS-001-system-overview.md` | 검토 완료 | ARCHITECTURE 1~2, REQUIREMENTS 2~3 |
| SYS-002 | 패키지 구성과 책임 | `docs/design/00-common/SYS-002-package-architecture.md` | 검토 완료 | ARCHITECTURE 3, ADR-002·003 |
| SYS-003 | 실행 환경과 배포 구성 | `docs/design/00-common/SYS-003-runtime-deployment.md` | 검토 완료 | ARCHITECTURE 6·13, REQUIREMENTS 4 |
| SYS-004 | 보안과 신뢰 경계 | `docs/design/00-common/SYS-004-security-boundaries.md` | 검토 완료 | ARCHITECTURE 12·14, REQUIREMENTS 14 |
| SYS-005 | 국제화와 접근성 | `docs/design/00-common/SYS-005-i18n-accessibility.md` | 검토 완료 | REQUIREMENTS 13, ADR-013·028·042·060 |
| SYS-006 | 공통 설정과 생명주기 | `docs/design/00-common/SYS-006-configuration-lifecycle.md` | 검토 완료 | ARCHITECTURE 5·11, ADR-056·064 |

## 화면 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| SCR-001 | 디자이너 기본 화면 | `docs/design/10-screen/SCR-001-designer-main.md` | 검토 완료 | SlipDesigner, REQUIREMENTS 5 |
| SCR-002 | 캔버스와 용지 편집 | `docs/design/10-screen/SCR-002-designer-canvas.md` | 검토 완료 | designer/render/canvas, F-01~F-27 |
| SCR-003 | 요소 목록과 추가 | `docs/design/10-screen/SCR-003-element-sidebar.md` | 검토 완료 | designer/render/sidebar·toolbar |
| SCR-004 | 속성 패널 | `docs/design/10-screen/SCR-004-property-panel.md` | 검토 완료 | designer/render/property-panel |
| SCR-005 | 페이지 관리 | `docs/design/10-screen/SCR-005-page-management.md` | 검토 완료 | SlipDesigner 페이지 조작, ADR-026 |
| SCR-006 | 그리드 행·셀 편집 | `docs/design/10-screen/SCR-006-grid-editor.md` | 검토 완료 | grid-props·grid-model·grid-edit |
| SCR-007 | 수식 편집 모달 | `docs/design/10-screen/SCR-007-formula-dialog.md` | 검토 완료 | formula-modal, ADR-068 |
| SCR-008 | 조건부 서식 편집 | `docs/design/10-screen/SCR-008-conditional-format.md` | 검토 완료 | conditional-formats, ADR-062 |
| SCR-009 | 파라미터 관리 | `docs/design/10-screen/SCR-009-parameter-management.md` | 검토 완료 | form-props·parameters, ADR-047 |
| SCR-010 | 샘플 값 편집 모달 | `docs/design/10-screen/SCR-010-sample-values-dialog.md` | 검토 완료 | sampleModal·sample-draft |
| SCR-011 | 이미지 선택 모달 | `docs/design/10-screen/SCR-011-image-dialog.md` | 검토 완료 | imageModal·image-pick |
| SCR-012 | 내 양식 저장·목록·삭제 모달 | `docs/design/10-screen/SCR-012-saved-forms-dialogs.md` | 검토 완료 | saveModal·myFormsModal·confirmDeleteModal |
| SCR-013 | 출력 결과 미리보기 | `docs/design/10-screen/SCR-013-output-preview.md` | 검토 완료 | SlipDesigner PDF 미리보기 |
| SCR-014 | 전표 작성 폼 | `docs/design/10-screen/SCR-014-voucher-form.md` | 검토 완료 | SlipForm, REQUIREMENTS 6 |
| SCR-015 | 전표 뷰어 | `docs/design/10-screen/SCR-015-voucher-viewer.md` | 검토 완료 | SlipViewer, REQUIREMENTS 7 |
| SCR-016 | 데모 저장 안내와 데이터 삭제 | `docs/design/10-screen/SCR-016-demo-storage-controls.md` | 검토 완료 | examples/shared, ADR-084 |
| SCR-017 | 디자이너 상단 도구 모음 | `docs/design/10-screen/SCR-017-designer-toolbar.md` | 검토 완료 | designer/render/toolbar·layout.styles |

## 기능 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| FNC-001 | 파일 파싱과 검증 | `docs/design/20-function/FNC-001-file-parse-validation.md` | 검토 완료 | format/schema·json-schema, SPEC 2·22 |
| FNC-002 | 버전 마이그레이션과 정규화 | `docs/design/20-function/FNC-002-migration-normalization.md` | 검토 완료 | format/migrate·normalize·version |
| FNC-003 | 양식 생성과 전표 발행 생명주기 | `docs/design/20-function/FNC-003-document-lifecycle.md` | 검토 완료 | format/voucher, SPEC 17~19 |
| FNC-004 | 수식 파싱과 진단 | `docs/design/20-function/FNC-004-formula-parse-diagnosis.md` | 검토 완료 | formula/parser·arity·errors |
| FNC-005 | 수식 평가와 함수 | `docs/design/20-function/FNC-005-formula-evaluation.md` | 검토 완료 | formula/evaluator·builtins·functions |
| FNC-006 | 수식 참조 변경 | `docs/design/20-function/FNC-006-formula-reference-update.md` | 검토 완료 | formula/references |
| FNC-007 | 원본 페이지와 출력 페이지 계획 | `docs/design/20-function/FNC-007-page-planning.md` | 검토 완료 | layout/page-plan, ADR-065·077 |
| FNC-008 | 반복 그리드 계획 | `docs/design/20-function/FNC-008-grid-planning.md` | 검토 완료 | layout/grid-plan, SPEC 15.5~15.7 |
| FNC-009 | 조건부 서식 평가 | `docs/design/20-function/FNC-009-conditional-format-evaluation.md` | 검토 완료 | render/conditional, ADR-062·076 |
| FNC-010 | 글자 측정과 줄바꿈 | `docs/design/20-function/FNC-010-text-layout.md` | 검토 완료 | render/measure·text-layout |
| FNC-011 | 이미지 확인과 해석 | `docs/design/20-function/FNC-011-image-processing.md` | 검토 완료 | format/image-source·render/convert |
| FNC-012 | 바코드 생성 | `docs/design/20-function/FNC-012-barcode-rendering.md` | 검토 완료 | render/barcode |
| FNC-013 | PDF 변환과 렌더링 | `docs/design/20-function/FNC-013-pdf-rendering.md` | 검토 완료 | render/convert·pdfme-renderer |
| FNC-014 | 폰트 제공과 대체 | `docs/design/20-function/FNC-014-font-resolution.md` | 검토 완료 | default-fonts·font-registry·settings |
| FNC-015 | 파일 암호화와 키 교체 | `docs/design/20-function/FNC-015-encryption-key-rotation.md` | 검토 완료 | encryption, ADR-054~056·064 |
| FNC-016 | 저장소 조회와 변경 | `docs/design/20-function/FNC-016-storage-workflow.md` | 검토 완료 | storage/adapter, ADR-021·025 |
| FNC-017 | IndexedDB 저장 | `docs/design/20-function/FNC-017-indexeddb-storage.md` | 검토 완료 | indexeddb-storage, ADR-045 |
| FNC-018 | 파일 열기와 내려받기 | `docs/design/20-function/FNC-018-file-exchange.md` | 검토 완료 | file-exchange |
| FNC-019 | 디자이너 문서 편집 | `docs/design/20-function/FNC-019-designer-document-editing.md` | 검토 완료 | SlipDesigner·patch·geometry |
| FNC-020 | 선택·이동과 실행 취소 | `docs/design/20-function/FNC-020-designer-history-selection.md` | 검토 완료 | selection·history·canvas-pointer·keyboard-nudge |
| FNC-021 | 그리드·파라미터·수식 편집 | `docs/design/20-function/FNC-021-designer-structured-editing.md` | 검토 완료 | grid-commands·parameters·formula-target |
| FNC-022 | 미리보기·작성·보기 출력 조정 | `docs/design/20-function/FNC-022-ui-output-orchestration.md` | 검토 완료 | SlipDesigner·SlipForm·SlipViewer |
| FNC-023 | 데모 자동 저장과 데이터 삭제 | `docs/design/20-function/FNC-023-demo-persistence.md` | 검토 완료 | examples/shared, ADR-084 |
| FNC-024 | MCP 파일 접근과 목록 캐시 | `docs/design/20-function/FNC-024-mcp-storage-list-cache.md` | 검토 완료 | mcp/storage·list-cache·file-queue |
| FNC-025 | MCP 읽기·수정·전표·PDF 도구 | `docs/design/20-function/FNC-025-mcp-tool-workflows.md` | 검토 완료 | mcp/server·edit·http·summary |

## 데이터 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| DAT-001 | 파일 봉투와 버전 | `docs/design/30-data/DAT-001-file-envelope-version.md` | 검토 완료 | SPEC 3~4 |
| DAT-002 | 양식 본문·메타데이터·용지·페이지 | `docs/design/30-data/DAT-002-template-structure.md` | 검토 완료 | SPEC 8·17 |
| DAT-003 | 전표 스냅샷·값·발행 상태 | `docs/design/30-data/DAT-003-voucher-structure.md` | 검토 완료 | SPEC 18~19 |
| DAT-004 | 요소 공통 속성과 스타일 | `docs/design/30-data/DAT-004-element-common-style.md` | 검토 완료 | SPEC 9 |
| DAT-005 | 요소별 데이터 | `docs/design/30-data/DAT-005-element-types.md` | 검토 완료 | SPEC 10~15 |
| DAT-006 | 파라미터와 샘플 값 | `docs/design/30-data/DAT-006-parameters-values.md` | 검토 완료 | SPEC 8.5~8.6·18.2 |
| DAT-007 | 그리드·셀·행 구간과 페이지 계획 | `docs/design/30-data/DAT-007-grid-pagination.md` | 검토 완료 | SPEC 15, ADR-065 |
| DAT-008 | 수식과 조건부 서식 | `docs/design/30-data/DAT-008-formula-conditional-format.md` | 검토 완료 | SPEC 9.4·16 |
| DAT-009 | 이미지·에셋과 폰트 | `docs/design/30-data/DAT-009-resources-fonts.md` | 검토 완료 | SPEC 7·12, ADR-036·040 |
| DAT-010 | 암호화 봉투 | `docs/design/30-data/DAT-010-encryption-envelope.md` | 검토 완료 | SPEC 21 |
| DAT-011 | 저장 메타데이터와 MCP 설정 | `docs/design/30-data/DAT-011-storage-mcp-config.md` | 검토 완료 | StorageListItem·slipkit-mcp.json |

## 인터페이스 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| IF-001 | `createSlipKit`과 `SlipKit` | `docs/design/40-interface/IF-001-slipkit-api.md` | 검토 완료 | core/slipkit, ADR-056 |
| IF-002 | Core 독립 공개 API와 JSON Schema | `docs/design/40-interface/IF-002-core-public-api.md` | 검토 완료 | core/index·format·formula·layout |
| IF-003 | `StorageAdapter` | `docs/design/40-interface/IF-003-storage-adapter.md` | 검토 완료 | core/storage/adapter |
| IF-004 | Web Component 공통 설정과 이벤트 | `docs/design/40-interface/IF-004-web-component-common.md` | 검토 완료 | elements/settings·index |
| IF-005 | `<slip-designer>` | `docs/design/40-interface/IF-005-slip-designer.md` | 검토 완료 | elements/slip-designer |
| IF-006 | `<slip-form>` | `docs/design/40-interface/IF-006-slip-form.md` | 검토 완료 | elements/slip-form |
| IF-007 | `<slip-viewer>` | `docs/design/40-interface/IF-007-slip-viewer.md` | 검토 완료 | elements/slip-viewer |
| IF-008 | React와 Vue 래퍼 | `docs/design/40-interface/IF-008-framework-wrappers.md` | 검토 완료 | react/index·vue/index |
| IF-009 | MCP 도구 계약 | `docs/design/40-interface/IF-009-mcp-tools.md` | 검토 완료 | mcp/server·schema-docs |
| IF-010 | MCP CLI·설정과 PDF 링크 | `docs/design/40-interface/IF-010-mcp-cli-http.md` | 검토 완료 | mcp/cli-command·config·http |

## 오류 설계

| 식별자 | 설계 대상 | 파일 | 상태 | 주요 근거 |
| --- | --- | --- | --- | --- |
| ERR-001 | 파일 파싱·검증·마이그레이션 오류 | `docs/design/50-error/ERR-001-file-errors.md` | 검토 완료 | SlipParseError·format/messages |
| ERR-002 | 수식과 값 오류 | `docs/design/50-error/ERR-002-formula-value-errors.md` | 검토 완료 | FormulaSyntaxError·FormulaEvalError |
| ERR-003 | 레이아웃·렌더링·PDF 오류 | `docs/design/50-error/ERR-003-render-layout-errors.md` | 검토 완료 | SlipLayoutError·SlipRenderError |
| ERR-004 | 저장·암호화·파일 교환 오류 | `docs/design/50-error/ERR-004-storage-encryption-errors.md` | 검토 완료 | SlipEncryptionError·StorageAdapter·file-exchange |
| ERR-005 | 화면·MCP·CLI 오류 전달 | `docs/design/50-error/ERR-005-ui-mcp-errors.md` | 검토 완료 | slip-error·McpToolError·SlipMcpConfigError |
