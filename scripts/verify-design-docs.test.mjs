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
});
