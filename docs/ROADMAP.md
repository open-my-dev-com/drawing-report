# 로드맵 / 세션 인수인계

최종 갱신: 2026-08-19 (디자이너 코어 추가)

## 현재 상태

- 요구사항·설계 결정 **전부 확정** (ADR-001~023, 미결 없음) — [DECISIONS.md](DECISIONS.md)
- `main` = 기준 브랜치 (부트스트랩 브랜치를 개명). 이후 작업은 [`.claude/rules/branching.md`](../.claude/rules/branching.md) 규칙대로 분기
- pnpm 모노레포 스캐폴딩 완료(4패키지 빌드·타입체크·테스트 통과) — PR [#1](https://github.com/open-my-dev-com/drawing-report/pull/1)
- **파일 포맷 완료**: [SPEC.md](SPEC.md) 규범 명세 + `.slip` 본문 상세 Zod 스키마(요소 6종·발행 규칙 검증) + schemaVersion 마이그레이션 계층 + JSON Schema 산출·동봉 (ADR-007/008/014/019/020/022)
- **수식 엔진 완료**: 자체 토크나이저·파서(`eval` 금지, 미등록 함수는 파싱 단계 거부) + 평가기(IF/AND/OR 지연 평가, `items.금액` 범위 참조) + 함수 29종 (ADR-010/017)
- **PDF 렌더러 완료**: `.slip` → pdfme 변환 계층(요소 6종 매핑, 고정 격자는 선·사각형·텍스트 분해, 표 스타일 기본값 병합) + pdfme 외부 비공개(공개 API에 pdfme 노출 0건) + field 수식 평가 연동 + 자동 페이지 분할 확인 (ADR-011/016)
- **무결성 완료**: RFC 8785(JCS) 정규화 + SHA-256 해시 + JWS(ES256) 서명·검증, 외부 의존 없이 Web Crypto API 직접 구현 (ADR-019, SPEC §8)
- **뷰어 완료**: `<slip-viewer>` Lit 웹컴포넌트 — `.slip` → PDF 렌더링 → iframe 미리보기. 화면·PDF 불일치가 구조적으로 불가능 (ADR-012/016). UI 문구 리소스 파일 분리 (ADR-013)
- **디자이너 코어 완료**: `<slip-designer>` Lit 웹컴포넌트 — 양식 편집기 기본 기능. 캔버스에 용지·요소 표시, 요소 선택·드래그 이동, 속성 패널 편집, 6종 요소 추가·삭제, 되돌리기·다시 실행, PDF 미리보기 전환. 후속 PR에서 스냅/정렬 안내선, 복사/붙여넣기, 크기 조절 핸들, 프리셋 추가 예정 (ADR-020)

## 다음 작업 (권장 순서)

1. ~~`chore/repo-monorepo-setup` → main PR 병합~~ → **완료** (#1)
2. ~~`feat/core-file-format` — SPEC.md + 상세 Zod 스키마 + 마이그레이션 + JSON Schema~~ → **완료** (#2)
3. ~~`feat/core-formula-parser` — 수식 파서·평가기, 함수 29종 구현 (ADR-010/017)~~ → **완료**
4. ~~`feat/core-pdf-renderer` — 우리 포맷 → pdfme 템플릿 변환 계층 + pdfme 외부 비공개 (ADR-016)~~ → **완료**
5. ~~`feat/core-integrity` — SHA-256 해시 + JWS(ES256) 서명, JCS(RFC 8785) 정규화 (ADR-019, [SPEC.md](SPEC.md) §8이 규범)~~ → **완료**
6. ~~`feat/elements-viewer` — `<slip-viewer>` 실제 렌더링 (미리보기 = PDF 변환 결과 공유)~~ → **완료**
7. `feat/elements-designer-*` — GUI 디자이너 (ADR-020 범위)
   - ~~`feat/elements-designer-core` — 캔버스·선택·이동·속성 편집·추가·삭제·되돌리기·미리보기~~ → **완료**
   - `feat/elements-designer-snap` — 스냅·정렬 안내선, 크기 조절 핸들
   - `feat/elements-designer-clipboard` — 복사·붙여넣기
   - `feat/elements-designer-presets` — 거래명세서·청구서 프리셋
8. `feat/core-storage-adapters` — 로컬 파일·IndexedDB 어댑터 (ADR-021)

## 진행 방식 메모

- 모든 결정은 사용자 Q&A로 확정하며 DECISIONS.md에 ADR로 기록, REQUIREMENTS.md와 일치하도록 유지 (README의 문서 운영 규칙 참조)
- 새 쟁점은 OPEN-QUESTIONS.md에 Q-09부터 추가
