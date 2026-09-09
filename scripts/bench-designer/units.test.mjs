// 성능 측정이 문자 수를 올바른 단위로 보고하는지 `node --test`로 확인합니다.
//
// 되돌리기 스냅샷 길이와 양식 직렬화 길이는 UTF-16 코드 단위 수입니다. 표 머리말·행과 JSON 지표 단위,
// 기준선이 한 곳이라도 바이트로 표기되면 실제 측정 단위와 어긋나므로 원문을 직접 읽어 확인합니다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 문자 수를 세는 지표의 ID 접미사입니다. */
const CHAR_METRIC_SUFFIX = 'Chars';

describe('bench-designer 표기', () => {
  const source = read('scripts/bench-designer.mjs');

  it('표 머리말이 스냅샷과 최대 보존량을 문자 수로 적는다', () => {
    assert.match(source, /'스냅샷 문자 수'/);
    assert.match(source, /'최대 보존량 문자 수 \(50개\)'/);
    assert.doesNotMatch(source, /'스냅샷 바이트'/);
  });

  it('최대 보존량을 MB로 바꾸지 않는다', () => {
    const retained = source.split('\n').filter((line) => line.includes('retainedMax'));
    assert.ok(retained.length > 0);
    for (const line of retained) {
      assert.doesNotMatch(line, /1024 \*\* 2|MB/, line);
    }
  });

  it('문자 수 지표를 count 단위로 낸다', () => {
    for (const key of ['snapshotChars', 'templateChars']) {
      const line = source.split('\n').find((entry) => entry.includes(`['${key}',`));
      assert.ok(line !== undefined, `${key} 지표 선언이 없습니다.`);
      assert.match(line, /'count'/, line);
      assert.doesNotMatch(line, /바이트/, line);
    }
  });
});

describe('성능 측정 표기', () => {
  const source = read('scripts/benchmark.mjs');

  it('양식 직렬화 지표를 문자 수·count로 낸다', () => {
    assert.match(source, /core\.template\.serializedChars/);
    assert.match(source, /label: '양식 직렬화 문자 수', unit: 'count'/);
    assert.doesNotMatch(source, /serializedBytes|양식 직렬화 바이트/);
  });
});

describe('성능 기준선', () => {
  const dir = 'scripts/bench-baselines';
  const files = readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.json'));

  it('문자 수 지표의 단위와 이름이 문자 수로 적혀 있다', () => {
    let checked = 0;
    for (const name of files) {
      for (const metric of JSON.parse(read(path.join(dir, name))).metrics) {
        if (!metric.id.endsWith(CHAR_METRIC_SUFFIX)) continue;
        assert.equal(metric.unit, 'count', `${name} ${metric.id}`);
        assert.doesNotMatch(metric.label, /바이트/, `${name} ${metric.id}`);
        checked += 1;
      }
    }
    assert.ok(checked > 0, '문자 수 지표를 하나도 찾지 못했습니다.');
  });

  it('바이트 단위 지표는 실제 바이트를 측정하는 항목만 남는다', () => {
    for (const name of files) {
      for (const metric of JSON.parse(read(path.join(dir, name))).metrics) {
        if (metric.unit !== 'bytes') continue;
        assert.doesNotMatch(metric.id, /Chars$/, `${name} ${metric.id}`);
        assert.match(metric.label, /바이트/, `${name} ${metric.id}`);
      }
    }
  });
});
