# 로드맵 / 세션 인수인계

최종 갱신: 2026-08-18

## 현재 상태

- 요구사항·설계 결정 **전부 확정** (ADR-001~023, 미결 없음) — [DECISIONS.md](DECISIONS.md)
- `main` = 기준 브랜치 (부트스트랩 브랜치를 개명). 이후 작업은 [BRANCHING.md](BRANCHING.md) 규칙대로 분기
- pnpm 모노레포 스캐폴딩 완료(4패키지 빌드·타입체크·테스트 통과) — PR [#1](https://github.com/open-my-dev-com/drawing-report/pull/1)
- **파일 포맷 완료**: [SPEC.md](SPEC.md) 규범 명세 + `.slip` 본문 상세 Zod 스키마(요소 6종·발행 규칙 검증) + schemaVersion 마이그레이션 계층 + JSON Schema 산출·동봉 (ADR-007/008/014/019/020/022)
- **수식 엔진 완료**: 자체 토크나이저·파서(`eval` 금지, 미등록 함수는 파싱 단계 거부) + 평가기(IF/AND/OR 지연 평가, `items.금액` 범위 참조) + 함수 29종 (ADR-010/017)

## 진행 규칙 (병합 방식)

- **main은 스쿼시 머지.** 미병합 브랜치 위에 PR을 쌓지(stack) 않는다 — 항상 병합 완료된 최신 main에서 분기하고, PR은 한 번에 하나씩 진행한다.

## 다음 작업 (권장 순서)

1. ~~`chore/repo-monorepo-setup` → main PR 병합~~ → **완료** (#1)
2. ~~`feat/core-file-format` — SPEC.md + 상세 Zod 스키마 + 마이그레이션 + JSON Schema~~ → **완료** (#2)
3. ~~`feat/core-formula-parser` — 수식 파서·평가기, 함수 29종 구현 (ADR-010/017)~~ → **완료**
4. `feat/core-pdf-renderer` — 우리 포맷 → pdfme 템플릿 변환 계층(기본값 병합 필수) + 렌더러 인터페이스 은닉 (ADR-016, 실측: [Q08-PDFME-EVAL.md](Q08-PDFME-EVAL.md))
5. `feat/core-integrity` — SHA-256 해시 + JWS(ES256) 서명, JCS(RFC 8785) 정규화 (ADR-019, [SPEC.md](SPEC.md) §8이 규범)
6. `feat/elements-viewer` — `<slip-viewer>` 실제 렌더링 (미리보기 = PDF 변환 결과 공유)
7. `feat/elements-designer-*` — GUI 디자이너 (ADR-020 범위)
8. `feat/core-storage-adapters` — 로컬 파일·IndexedDB 어댑터 (ADR-021)

## 진행 방식 메모

- 모든 결정은 사용자 Q&A로 확정하며 DECISIONS.md에 ADR로 기록, REQUIREMENTS.md와 정합 유지 (README의 문서 운영 규칙 참조)
- 새 쟁점은 OPEN-QUESTIONS.md에 Q-09부터 추가
