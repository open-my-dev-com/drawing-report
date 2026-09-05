// 공개 export 표면: 패키지 루트와 모듈 하위 경로의 런타임 export 이름이 허용 목록(public-exports.json)과
// 정확히 같은지, 공개 API에서 뺀 이름이 실제로 없는지 확인한다. 다섯 패키지 모두 Node에서 직접 불러온다 —
// elements·react·vue 루트도 Lit의 Node 빌드 덕분에 DOM 없이 import된다.
import { createRequire } from 'node:module';
import allowlist from './public-exports.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const problems = [];
let checked = 0;

for (const [pkg, subpaths] of Object.entries(allowlist)) {
  if (pkg.startsWith('$')) continue;
  for (const [subpath, expected] of Object.entries(subpaths)) {
    // JSON 파일 하위 경로는 모듈이 아니므로 파일이 해석되는지만 본다.
    if (expected.files) {
      for (const file of expected.files) {
        const specifier = `${pkg}/${subpath.replace(/^\.\//, '').replace(/\*$/, '')}${file}`;
        try {
          require.resolve(specifier);
        } catch (error) {
          problems.push(`${specifier}: ${error.code ?? error.message}`);
        }
        checked += 1;
      }
      continue;
    }
    const specifier = subpath === '.' ? pkg : `${pkg}/${subpath.replace(/^\.\//, '')}`;
    let module;
    try {
      module = await import(specifier);
    } catch (error) {
      problems.push(`${specifier}: import failed — ${error.message.split('\n')[0]}`);
      continue;
    }
    const actual = Object.keys(module).sort();
    const missing = expected.runtime.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.runtime.includes(name));
    if (missing.length > 0) problems.push(`${specifier}: missing runtime export ${missing.join(', ')}`);
    if (extra.length > 0) problems.push(`${specifier}: unexpected runtime export ${extra.join(', ')}`);
    for (const name of expected.removed?.runtime ?? []) {
      if (name in module || module[name] !== undefined) problems.push(`${specifier}: removed export ${name} is still present`);
    }
    checked += 1;
  }
}

if (problems.length > 0) throw new Error(`public export surface mismatch:\n${problems.join('\n')}`);
console.log(`public exports ok (${checked} entry points)`);
