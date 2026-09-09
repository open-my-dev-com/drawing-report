// knip 보고서 요약의 정렬·묶음·출력 검사 — `node --test`로 실행합니다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectFindings, formatFinding, groupByKind, kindLabel, renderReport } from './report.mjs';

/** 파일마다 종류별 배열을 담는 실제 knip JSON 보고서 구조입니다. */
const REPORT = {
  issues: [
    { file: 'scripts/left.mjs', files: [{ name: 'scripts/left.mjs' }], exports: [], types: [] },
    {
      file: 'packages/core/src/b.ts',
      exports: [
        { name: 'beta', line: 30, col: 8 },
        { name: 'alpha', line: 10, col: 1 },
      ],
      types: [{ name: 'Gamma', line: 50, col: 13 }],
    },
    { file: 'package.json', devDependencies: [{ name: 'unused-tool', line: 12, col: 6 }] },
  ],
};

describe('collectFindings', () => {
  it('파일마다 나뉜 종류별 배열을 하나의 목록으로 편다', () => {
    const findings = collectFindings(REPORT);
    assert.equal(findings.length, 5);
    assert.deepEqual(
      findings.map((finding) => finding.kind),
      ['files', 'devDependencies', 'exports', 'exports', 'types'],
    );
  });

  it('같은 종류 안에서는 파일·이름 순으로 정렬해 같은 입력에 같은 결과를 낸다', () => {
    const first = collectFindings(REPORT);
    const second = collectFindings(structuredClone(REPORT));
    assert.deepEqual(first, second);
    const exportNames = first.filter((finding) => finding.kind === 'exports').map((finding) => finding.name);
    assert.deepEqual(exportNames, ['alpha', 'beta']);
  });

  it('빈 배열만 있는 보고서는 문제가 없다고 알린다', () => {
    assert.deepEqual(collectFindings({ issues: [{ file: 'a.ts', exports: [], types: [] }] }), []);
  });

  it('issues 배열이 없으면 오류를 던진다', () => {
    assert.throws(() => collectFindings({}), /issues/);
  });
});

describe('groupByKind와 kindLabel', () => {
  it('종류별로 묶고 우리말 이름을 붙인다', () => {
    const groups = groupByKind(collectFindings(REPORT));
    assert.deepEqual(
      groups.map((group) => [group.kind, group.label, group.items.length]),
      [
        ['files', '미사용 파일', 1],
        ['devDependencies', '미사용 개발 의존성', 1],
        ['exports', '미사용 export', 2],
        ['types', '미사용 타입 export', 1],
      ],
    );
  });

  it('모르는 종류는 knip이 쓰는 이름을 그대로 쓴다', () => {
    assert.equal(kindLabel('somethingNew'), 'somethingNew');
  });
});

describe('formatFinding', () => {
  it('파일 검사 결과는 경로만 적는다', () => {
    assert.equal(formatFinding({ kind: 'files', file: 'scripts/left.mjs', name: 'scripts/left.mjs' }), 'scripts/left.mjs');
  });

  it('이름이 있는 검사 결과는 이름과 위치를 함께 적는다', () => {
    assert.equal(
      formatFinding({ kind: 'exports', file: 'packages/core/src/b.ts', name: 'alpha', line: 10, col: 1 }),
      'alpha — packages/core/src/b.ts:10:1',
    );
  });
});

describe('renderReport', () => {
  it('문제가 없으면 통과 문구만 적는다', () => {
    const text = renderReport([]);
    assert.match(text, /문제가 없습니다/);
    assert.doesNotMatch(text, /합계/);
  });

  it('건수 표와 종류별 목록을 함께 적는다', () => {
    const text = renderReport(collectFindings(REPORT));
    assert.match(text, /\| 미사용 export \| 2 \|/);
    assert.match(text, /\*\*합계\*\* \| \*\*5\*\*/);
    assert.match(text, /- alpha — packages\/core\/src\/b\.ts:10:1/);
  });

  it('같은 입력에는 같은 문자열을 낸다', () => {
    assert.equal(renderReport(collectFindings(REPORT)), renderReport(collectFindings(structuredClone(REPORT))));
  });
});
