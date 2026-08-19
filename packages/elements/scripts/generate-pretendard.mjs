/**
 * 동봉 폰트 데이터(src/fonts/pretendard-data.ts) 재생성 스크립트.
 *
 * npm의 pretendard 패키지에서 OTF 2종(Regular·Bold)을 받아 base64 모듈로 굽는다.
 * 폰트 버전을 올릴 때 VERSION만 바꿔 실행한다:
 *   node scripts/generate-pretendard.mjs
 */
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '1.3.9';

const work = mkdtempSync(join(tmpdir(), 'pretendard-'));
execSync(
  `curl -sSL -o pretendard.tgz https://registry.npmjs.org/pretendard/-/pretendard-${VERSION}.tgz && tar xzf pretendard.tgz`,
  { cwd: work, stdio: 'inherit' },
);

const staticDir = join(work, 'package/dist/public/static');
const reg = readFileSync(join(staticDir, 'Pretendard-Regular.otf')).toString('base64');
const bold = readFileSync(join(staticDir, 'Pretendard-Bold.otf')).toString('base64');
const license = readFileSync(join(work, 'package/dist/LICENSE.txt'), 'utf8');

const out = [
  `// 생성 파일 — 직접 수정하지 않는다. 재생성: node scripts/generate-pretendard.mjs (Pretendard v${VERSION}, OTF)`,
  '// 폰트 저작권: Copyright (c) 2021, Kil Hyung-jin. SIL Open Font License 1.1 — 전문은 패키지의 OFL-Pretendard.txt',
  '',
  '/** Pretendard Regular OTF (base64) */',
  `export const PRETENDARD_REGULAR_B64 = '${reg}';`,
  '',
  '/** Pretendard Bold OTF (base64) */',
  `export const PRETENDARD_BOLD_B64 = '${bold}';`,
  '',
].join('\n');

const root = new URL('..', import.meta.url).pathname;
writeFileSync(join(root, 'src/fonts/pretendard-data.ts'), out);
writeFileSync(join(root, 'OFL-Pretendard.txt'), license);
console.log(`Pretendard v${VERSION} 데이터 모듈을 재생성했습니다`);
