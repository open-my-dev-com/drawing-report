import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { verifyDesignDocs } from './verify-design-docs.mjs';

const temporaryDirectories = [];

function copyRepositoryDesign() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'slipkit-design-docs-'));
  temporaryDirectories.push(root);
  cpSync(path.join(process.cwd(), 'docs', 'design'), path.join(root, 'docs', 'design'), { recursive: true });
  return root;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('기본설계 문서 검증', () => {
  it('저장소의 설계 기반 문서를 통과시킵니다', () => {
    assert.deepEqual(verifyDesignDocs(process.cwd()), []);
  });

  it('등록부의 중복 식별자를 찾습니다', () => {
    const root = copyRepositoryDesign();
    const register = path.join(root, 'docs', 'design', '90-management', 'design-register.md');
    const source = readFileSync(register, 'utf8');
    const row = source.split('\n').find((line) => line.startsWith('| SYS-001 |'));
    writeFileSync(register, `${source}\n${row}\n`);
    assert.ok(verifyDesignDocs(root).some((error) => error.includes('식별자 SYS-001가 중복')));
  });

  it('존재하지 않는 상대 링크를 찾습니다', () => {
    const root = copyRepositoryDesign();
    const readme = path.join(root, 'docs', 'design', 'README.md');
    writeFileSync(readme, `${readFileSync(readme, 'utf8')}\n[없는 문서](missing.md)\n`);
    assert.ok(verifyDesignDocs(root).some((error) => error.includes('링크 대상이 없습니다: missing.md')));
  });

  it('설계 용어 해설이 없으면 찾습니다', () => {
    const root = copyRepositoryDesign();
    rmSync(path.join(root, 'docs', 'design', 'GLOSSARY.md'));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      'docs/design/GLOSSARY.md: 필수 안내 문서가 없습니다',
    )));
  });

  it('문서의 공통 절 순서와 변경 이력을 확인합니다', () => {
    const root = copyRepositoryDesign();
    const readme = path.join(root, 'docs', 'design', 'README.md');
    const source = readFileSync(readme, 'utf8')
      .replace('## 개요', '## 범위')
      .replace('| 2026-09-28 | 신규 작성 |', '| 2026-09-27 | 신규 작성 |');
    writeFileSync(readme, source);
    const errors = verifyDesignDocs(root);
    assert.ok(errors.some((error) => error.includes("첫 두 절은 '개요', '변경 이력'")));
    assert.ok(errors.some((error) => error.includes('최종 갱신 날짜 2026-09-28의 변경 이력이 없습니다')));
  });

  it('화면 설계의 번호 주석 이미지를 확인합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      'SCR-001-designer-main-default-1440x810-annotated.png',
      'SCR-001-designer-main-default-1440x810.png',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes('SCR-001 주석 PNG가 필요합니다')));
  });

  it('화면 설계에서 서로 다른 사용자 동작을 한 행에 묶지 못하게 합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '| 2 페이지 목록 | 페이지를 고릅니다. |',
      '| 2 페이지 목록 | 추가·삭제 버튼을 누릅니다. |',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes('사용자 동작은 한 행에 하나만 적습니다')));
  });

  it('화면 이벤트가 화면 구성 번호를 참조하는지 확인합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '| 2 페이지 목록 | 페이지를 고릅니다. |',
      '| 페이지 목록 | 페이지를 고릅니다. |',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      '이벤트의 화면 항목은 화면 구성 번호로 시작해야 합니다',
    )));
  });

  it('화면 동작 설명의 구현 식별자와 별도 금지 문장을 찾습니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '현재 페이지를 바꾸고 요소 선택을 해제합니다.',
      '`src`가 없으면 실행할 수 없습니다.',
    ));
    const errors = verifyDesignDocs(root);
    assert.ok(errors.some((error) => error.includes('구현 식별자를 직접 쓰지 않습니다')));
    assert.ok(errors.some((error) => error.includes('별도 금지 문장 대신')));
  });

  it('화면의 관련 설계 설명에 구현 식별자를 직접 쓰지 못하게 합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '호스트가 양식을 전달하고 변경 결과를 받는 경계를 정의합니다.',
      '`slip-change` 이벤트를 정의합니다.',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes('구현 식별자를 직접 쓰지 않습니다')));
  });

  it('화면 구성 번호가 1부터 순서대로 이어지는지 확인합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '| 5 | 속성 패널 |',
      '| 6 | 속성 패널 |',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      '화면 구성 번호는 1부터 빠짐없이 순서대로 적습니다',
    )));
  });

  it('화면 구성 번호가 주석 이미지에 표시되는지 확인합니다', () => {
    const root = copyRepositoryDesign();
    const image = path.join(
      root,
      'docs',
      'design',
      'assets',
      'SCR-001-designer-main-default-1440x810-annotated.svg',
    );
    writeFileSync(image, readFileSync(image, 'utf8').replace('>5</text>', '>9</text>'));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      '화면 구성 5번을 표시한 주석 이미지 번호가 없습니다',
    )));
  });

  it('화면 설계의 필수 상태 표를 확인합니다', () => {
    const root = copyRepositoryDesign();
    const screen = path.join(root, 'docs', 'design', '10-screen', 'SCR-001-designer-main.md');
    writeFileSync(screen, readFileSync(screen, 'utf8').replace(
      '| 상태 | 시작 조건 | 화면 표시 | 가능한 다음 동작 |',
      '| 상태 | 설명 |',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      '화면 설계 표 머리말이 없습니다: | 상태 | 시작 조건 | 화면 표시 | 가능한 다음 동작 |',
    )));
  });

  it('기능 설계의 입력 계약과 반복 호출 절을 확인합니다', () => {
    const root = copyRepositoryDesign();
    const document = path.join(root, 'docs', 'design', '20-function', 'FNC-001-file-parse-validation.md');
    const source = readFileSync(document, 'utf8')
      .replace('| 구분 | 항목 | 자료형·단위 | 필수 여부·기본값 | 제약과 보장 |', '| 구분 | 항목 | 조건 |')
      .replace('## 동시 실행·반복 호출', '## 반복 처리');
    writeFileSync(document, source);
    const errors = verifyDesignDocs(root);
    assert.ok(errors.some((error) => error.includes('기능 입력·출력 표 머리말이 없습니다')));
    assert.ok(errors.some((error) => error.includes("필수 절을 찾을 수 없습니다: '동시 실행·반복 호출'")));
  });

  it('기능 설계의 단계별 정상 처리 흐름을 확인합니다', () => {
    const root = copyRepositoryDesign();
    const document = path.join(root, 'docs', 'design', '20-function', 'FNC-001-file-parse-validation.md');
    writeFileSync(document, readFileSync(document, 'utf8').replace(
      '| 순서 | 처리 | 읽는 값 | 만드는 값·변경하는 값 | 다음 단계 |',
      '| 처리 | 설명 |',
    ));
    assert.ok(verifyDesignDocs(root).some((error) => error.includes(
      '정상 처리 흐름에는 단계별 입력·변경값·다음 단계를 설명한 표가 필요합니다',
    )));
  });

  it('데이터 설계의 구조와 생명주기 절을 확인합니다', () => {
    const root = copyRepositoryDesign();
    const document = path.join(root, 'docs', 'design', '30-data', 'DAT-001-file-envelope-version.md');
    const source = readFileSync(document, 'utf8')
      .replace('| 경로 | 자료형 | 필수 여부 | 기본값 | 허용 범위·형식 | 의미 |', '| 경로 | 의미 |')
      .replace('## 생명주기', '## 상태 변화');
    writeFileSync(document, source);
    const errors = verifyDesignDocs(root);
    assert.ok(errors.some((error) => error.includes('데이터 구조 표에는')));
    assert.ok(errors.some((error) => error.includes("필수 절을 찾을 수 없습니다: '생명주기'")));
  });

  it('인터페이스와 오류 설계의 호출·복구 계약을 확인합니다', () => {
    const root = copyRepositoryDesign();
    const interfaceDocument = path.join(root, 'docs', 'design', '40-interface', 'IF-001-slipkit-api.md');
    writeFileSync(interfaceDocument, readFileSync(interfaceDocument, 'utf8').replace(
      '## 반복 호출·동시 호출',
      '## 여러 번 호출',
    ));
    const errorDocument = path.join(root, 'docs', 'design', '50-error', 'ERR-001-file-errors.md');
    writeFileSync(errorDocument, readFileSync(errorDocument, 'utf8').replace(
      '| 오류 종류 | 보존하는 값 | 되돌리는 값 | 사용자의 복구 절차 | 자동 재시도·기록 |',
      '| 오류 종류 | 복구 |',
    ));
    const errors = verifyDesignDocs(root);
    assert.ok(errors.some((error) => error.includes("필수 절을 찾을 수 없습니다: '반복 호출·동시 호출'")));
    assert.ok(errors.some((error) => error.includes('오류 설계 표 머리말이 없습니다')));
  });
});
