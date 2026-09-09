// 배포 코드 사용 여부 검사의 단위 시험입니다. `node --test`로 실행합니다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatFinding } from './report.mjs';
import {
  checkProductionExports,
  checkProductionFiles,
  exportFindings,
  fileFindings,
  PRODUCTION_EXPORT_ALLOWLIST,
  PRODUCTION_FILE_ALLOWLIST,
  renderProductionReport,
} from './production.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FINDINGS = [
  { kind: 'files', file: 'packages/mcp/src/left.ts', name: 'packages/mcp/src/left.ts' },
  { kind: 'exports', file: 'packages/mcp/src/a.ts', name: 'helperForTests', line: 3, col: 14 },
  { kind: 'types', file: 'packages/mcp/src/a.ts', name: 'OnlyType', line: 9, col: 13 },
];

const ALLOWLIST = [
  { file: 'packages/mcp/src/a.ts', name: 'helperForTests', usedBy: 'packages/mcp/test/a.test.ts', reason: '시험에서만 사용합니다.' },
  { file: 'packages/mcp/src/a.ts', name: 'OnlyType', usedBy: 'packages/mcp/test/a.test.ts', reason: '시험에서 타입으로 사용합니다.' },
];

describe('exportFindings', () => {
  it('export·타입 검사 결과만 남기고 파일 검사 결과는 제외한다', () => {
    assert.deepEqual(
      exportFindings(FINDINGS).map((finding) => finding.name),
      ['helperForTests', 'OnlyType'],
    );
  });
});

describe('fileFindings', () => {
  it('파일 검사 결과만 남긴다', () => {
    assert.deepEqual(
      fileFindings(FINDINGS).map((finding) => finding.file),
      ['packages/mcp/src/left.ts'],
    );
  });
});

describe('checkProductionFiles', () => {
  const allowed = [{ file: 'packages/mcp/src/left.ts', reason: '명령으로만 실행하는 도구입니다.' }];

  it('허용 목록에 이유와 함께 있으면 통과한다', () => {
    assert.deepEqual(checkProductionFiles(fileFindings(FINDINGS), allowed), { unexpected: [], stale: [] });
  });

  it('시험에서만 가져오는 파일은 배포 코드 허용 목록에 없으면 미사용 코드로 남긴다', () => {
    const result = checkProductionFiles(fileFindings(FINDINGS), []);
    assert.deepEqual(
      result.unexpected.map((finding) => finding.file),
      ['packages/mcp/src/left.ts'],
    );
    assert.deepEqual(result.stale, []);
  });

  it('문제가 사라진 항목과 두 번 적은 항목을 불필요한 예외로 잡는다', () => {
    const gone = checkProductionFiles(fileFindings(FINDINGS), [
      ...allowed,
      { file: 'packages/mcp/src/removed.ts', reason: '' },
    ]);
    assert.equal(gone.stale.length, 1);
    assert.match(gone.stale[0], /검사에서 더 이상 발견되지 않습니다/);

    const twice = checkProductionFiles(fileFindings(FINDINGS), [...allowed, allowed[0]]);
    assert.match(twice.stale[0], /두 번 적혀 있습니다/);
  });
});

describe('checkProductionExports', () => {
  it('허용 목록에 근거와 함께 있으면 통과한다', () => {
    const result = checkProductionExports(exportFindings(FINDINGS), ALLOWLIST, () => true);
    assert.deepEqual(result, { unexpected: [], stale: [] });
  });

  it('허용 목록에 없는 검사 결과는 미사용 코드로 남긴다', () => {
    const result = checkProductionExports(exportFindings(FINDINGS), [ALLOWLIST[0]], () => true);
    assert.deepEqual(
      result.unexpected.map((finding) => finding.name),
      ['OnlyType'],
    );
    assert.deepEqual(result.stale, []);
  });

  it('문제가 사라진 항목과 근거가 사라진 항목을 불필요한 예외로 잡는다', () => {
    const gone = [...ALLOWLIST, { file: 'packages/mcp/src/b.ts', name: 'removed', usedBy: 'packages/mcp/test/b.test.ts', reason: '' }];
    const result = checkProductionExports(exportFindings(FINDINGS), gone, () => true);
    assert.equal(result.stale.length, 1);
    assert.match(result.stale[0], /검사에서 더 이상 발견되지 않습니다/);

    const noProof = checkProductionExports(exportFindings(FINDINGS), ALLOWLIST, (file) => file !== 'packages/mcp/test/a.test.ts');
    assert.equal(noProof.stale.length, 2);
    assert.match(noProof.stale[0], /이 이름을 사용하지 않습니다/);
  });

  it('같은 항목을 두 번 적으면 잡는다', () => {
    const twice = [...ALLOWLIST, ALLOWLIST[0]];
    const result = checkProductionExports(exportFindings(FINDINGS), twice, () => true);
    assert.match(result.stale[0], /두 번 적혀 있습니다/);
  });
});

describe('renderProductionReport', () => {
  it('문제가 없으면 두 허용 목록의 건수를 적는다', () => {
    const text = renderProductionReport({}, formatFinding);
    assert.match(text, new RegExp(`export 허용 목록 ${PRODUCTION_EXPORT_ALLOWLIST.length}건`));
    assert.match(text, new RegExp(`파일 허용 목록 ${PRODUCTION_FILE_ALLOWLIST.length}건`));
  });

  it('문제가 있으면 종류별로 나눠 적는다', () => {
    const text = renderProductionReport(
      {
        exports: { unexpected: exportFindings(FINDINGS), stale: ['낡은 export'] },
        files: { unexpected: fileFindings(FINDINGS), stale: [] },
      },
      formatFinding,
    );
    assert.match(text, /허용 목록에 없는 파일 \(1건\)/);
    assert.match(text, /packages\/mcp\/src\/left\.ts/);
    assert.match(text, /허용 목록에 없는 export \(2건\)/);
    assert.match(text, /helperForTests — packages\/mcp\/src\/a\.ts:3:14/);
    assert.match(text, /더 이상 필요하지 않은 허용 목록 \(1건\)/);
  });
});

describe('허용 목록 자체', () => {
  it('항목마다 파일·이름·근거 파일·이유를 적고 파일이 실제로 있다', () => {
    for (const entry of PRODUCTION_EXPORT_ALLOWLIST) {
      assert.ok(entry.file && entry.name && entry.usedBy && entry.reason, JSON.stringify(entry));
      assert.ok(existsSync(path.join(ROOT, entry.file)), `${entry.file}가 없습니다.`);
      assert.ok(existsSync(path.join(ROOT, entry.usedBy)), `${entry.usedBy}가 없습니다.`);
      const text = readFileSync(path.join(ROOT, entry.usedBy), 'utf8');
      assert.match(text, new RegExp(`\\b${entry.name}\\b`), `${entry.usedBy}가 ${entry.name}을 사용하지 않습니다.`);
    }
  });

  it('같은 파일·이름을 두 번 적지 않는다', () => {
    const keys = PRODUCTION_EXPORT_ALLOWLIST.map((entry) => `${entry.file}::${entry.name}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('파일 허용 목록 자체', () => {
  it('항목마다 파일과 이유를 적고 파일이 실제로 있다', () => {
    for (const entry of PRODUCTION_FILE_ALLOWLIST) {
      assert.ok(entry.file && entry.reason, JSON.stringify(entry));
      assert.ok(existsSync(path.join(ROOT, entry.file)), `${entry.file}가 없습니다.`);
    }
  });

  it('같은 파일을 두 번 적지 않는다', () => {
    const files = PRODUCTION_FILE_ALLOWLIST.map((entry) => entry.file);
    assert.equal(new Set(files).size, files.length);
  });
});
