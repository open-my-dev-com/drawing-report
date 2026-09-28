# IF-004 Web Component 공통 설정과 이벤트

최종 갱신: 2026-09-28

## 개요

`<slip-designer>`, `<slip-form>`, `<slip-viewer>`가 공유하는 입력, 설정, 이벤트와 호스트 상태 관리
원칙을 정의합니다.

## 변경 이력

| 날짜 | 구분 | 변경 내용 |
| --- | --- | --- |
| 2026-09-28 | 신규 작성 | Web Component의 `src`, 로케일, SlipKit 인스턴스와 이벤트 계약을 정의했습니다. |

## 공통 프로퍼티

| 프로퍼티 | 설명 |
| --- | --- |
| `src` | 양식 또는 전표를 직렬화한 `.slip` JSON 문자열입니다. |
| `locale` | UI 문자열 언어입니다. 생략하면 `slipkit.locale`을 따릅니다. |
| `slipkit` | 폰트, 렌더링, 수식과 암호화 설정을 공유하는 인스턴스입니다. |

`src`는 새 편집·작성·조회 세션을 시작하는 입력입니다. 구성 요소의 변경 이벤트를 받을 때마다 같은
요소의 `src`에 즉시 되돌려 쓰면 선택, 실행 취소와 발행 상태가 초기화될 수 있습니다. 호스트는 최초
입력과 최신 결과 상태를 분리합니다.

## 이벤트 계약

이벤트는 Shadow DOM 밖으로 전달되도록 `bubbles: true`, `composed: true`로 발생합니다.

| 이벤트 | 발생 요소 | `detail.file` |
| --- | --- | --- |
| `slip-change` | 디자이너 | 변경된 `SlipTemplateFile` |
| `slip-change` | 작성 폼 | `issued: false`인 최신 `SlipVoucherFile` |
| `slip-issue` | 작성 폼 | `issued: true`인 확정 `SlipVoucherFile` |

뷰어는 파일을 바꾸는 이벤트를 발생시키지 않습니다.

## 로케일과 렌더링 설정

UI 언어는 구성 요소 `locale`이 우선하고, 수식·PDF 로케일은 SlipKit 인스턴스가 있으면 인스턴스
설정을 따릅니다. `getFonts`가 없으면 UI 패키지의 동봉 기본 폰트를 사용합니다. 설정 조회가 비동기일
때 늦게 끝난 이전 요청이 최신 설정을 덮지 않도록 요청 세대를 구분합니다.

## 생명주기

요소 연결 시 `src`를 파싱하고 내부 상태를 만듭니다. `src` 또는 핵심 설정이 바뀌면 관련 상태와
미리보기를 갱신합니다. Blob URL, 비동기 미리보기와 이벤트 리스너는 연결 해제나 새 요청 때
정리합니다.

## 오류와 접근성

파싱·렌더링 실패는 구성 요소 안의 로케일화된 상태로 표시하며 잘못된 파일을 성공 이벤트로 내보내지
않습니다. 호스트가 정한 `role`, `aria-*`, `tabIndex` 같은 표준 속성은 래퍼를 거쳐 호스트 요소에
전달할 수 있습니다.

## 관련 설계와 근거

- 인터페이스: IF-005~IF-008
- 기능: FNC-022
- 오류: ERR-005
- `packages/elements/src/slip-designer.ts`
- `packages/elements/src/slip-form.ts`
- `packages/elements/src/slip-viewer.ts`
