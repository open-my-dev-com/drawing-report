// 공개 export 허용 목록(fixtures/public-exports.json)의 드리프트 검사 — `node --test`로 실행한다.
// tarball 없이 저장소의 빌드 산출물(packages/*/dist)만 읽는다. `pnpm verify`는 build 뒤에 이 시험을 돌린다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import allowlist from './fixtures/public-exports.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_TYPES_FIXTURE = path.join(ROOT, 'scripts', 'verify-packages', 'fixtures', 'public-types', 'index.ts');

/** 허용 목록의 패키지 항목만 돌려준다 (`$comment` 제외). */
function packages() {
  return Object.entries(allowlist).filter(([name]) => !name.startsWith('$'));
}

/** 하위 경로를 dist 파일 기본 이름으로 바꾼다 — `.`은 `index`, `./fonts/pretendard`는 `fonts/pretendard`. */
function distBase(pkg, subpath) {
  const dir = path.join(ROOT, 'packages', pkg.replace('@omdc-slipkit/', ''), 'dist');
  return path.join(dir, subpath === '.' ? 'index' : subpath.replace(/^\.\//, ''));
}

/**
 * d.ts의 `export { ... }` 문을 모두 읽어 이름을 모은다. `type` 표시가 있으면 타입으로, 없으면 값으로 분류하되
 * 다른 패키지에서 다시 내보낸 타입은 `type` 표시 없이 나올 수 있으므로 값 분류는 "타입일 수도 있음"으로 본다.
 */
function readDeclaredExports(file) {
  const text = readFileSync(file, 'utf8');
  assert.equal(/^export \*/m.test(text), false, `${file}: export * 는 이름을 확정할 수 없다`);
  const typed = new Set();
  const untyped = new Set();
  for (const match of text.matchAll(/^export\s+(type\s+)?\{([^}]*)\}/gm)) {
    const allTypes = match[1] !== undefined;
    for (const entry of match[2].split(',').map((item) => item.trim()).filter(Boolean)) {
      const parsed = entry.match(/^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([\w$]+))?$/);
      assert.ok(parsed, `${file}: export 항목을 해석할 수 없다: ${entry}`);
      const name = parsed[3] ?? parsed[2];
      (allTypes || parsed[1] !== undefined ? typed : untyped).add(name);
    }
  }
  return { typed, untyped };
}

/** 두 이름 목록의 차이를 사람이 읽을 수 있게 만든다. */
function diff(actual, expected) {
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

describe('공개 export 허용 목록', () => {
  for (const [pkg, subpaths] of packages()) {
    const dir = path.join(ROOT, 'packages', pkg.replace('@omdc-slipkit/', ''), 'dist');
    assert.ok(existsSync(dir), `${dir} 가 없다 — 먼저 pnpm build 를 실행한다`);

    for (const [subpath, expected] of Object.entries(subpaths)) {
      if (expected.files) {
        it(`${pkg} ${subpath}: 스키마 파일이 있다`, () => {
          for (const file of expected.files) {
            const target = path.join(ROOT, 'packages', pkg.replace('@omdc-slipkit/', ''), subpath.replace(/^\.\//, '').replace(/\*$/, ''), file);
            assert.ok(existsSync(target), `${target} 가 없다`);
          }
        });
        continue;
      }
      const base = distBase(pkg, subpath);

      it(`${pkg} ${subpath}: 런타임 export가 허용 목록과 같다`, async () => {
        const module = await import(pathToFileURL(`${base}.js`).href);
        const result = diff(Object.keys(module).sort(), expected.runtime);
        assert.ok(result.ok, `missing: ${result.missing.join(', ') || '-'} / extra: ${result.extra.join(', ') || '-'}`);
        for (const name of expected.removed?.runtime ?? []) {
          assert.equal(name in module, false, `${name} 은(는) 공개 API에서 뺀 이름인데 여전히 export된다`);
        }
      });

      it(`${pkg} ${subpath}: d.ts가 선언하는 이름이 런타임·타입 허용 목록의 합과 같다`, () => {
        const declared = readDeclaredExports(`${base}.d.ts`);
        const all = [...new Set([...declared.typed, ...declared.untyped])].sort();
        const result = diff(all, [...expected.runtime, ...expected.types].sort());
        assert.ok(result.ok, `missing: ${result.missing.join(', ') || '-'} / extra: ${result.extra.join(', ') || '-'}`);
        // `type` 표시가 붙은 이름은 런타임 목록에 있을 수 없다.
        const typedRuntime = [...declared.typed].filter((name) => expected.runtime.includes(name));
        assert.deepEqual(typedRuntime, [], `타입으로만 선언됐는데 런타임 목록에 있다: ${typedRuntime.join(', ')}`);
        for (const name of [...(expected.removed?.runtime ?? []), ...(expected.removed?.types ?? [])]) {
          assert.equal(all.includes(name), false, `${name} 은(는) 공개 API에서 뺀 이름인데 d.ts가 여전히 선언한다`);
        }
      });
    }
  }

  it('public-types/index.ts가 허용 목록의 모든 이름과 뺀 이름을 다룬다', () => {
    const source = readFileSync(PUBLIC_TYPES_FIXTURE, 'utf8');
    const absent = [];
    for (const [pkg, subpaths] of packages()) {
      for (const [subpath, expected] of Object.entries(subpaths)) {
        if (expected.files) continue;
        const names = [
          ...expected.runtime.filter((name) => name !== 'default'),
          ...expected.types,
          ...(expected.removed?.runtime ?? []),
          ...(expected.removed?.types ?? []),
        ];
        for (const name of names) {
          if (!new RegExp(`\\b${name}\\b`).test(source)) absent.push(`${pkg} ${subpath} ${name}`);
        }
      }
    }
    assert.deepEqual(absent, [], `public-types/index.ts 에 없는 이름: ${absent.join(', ')}`);
  });
});
