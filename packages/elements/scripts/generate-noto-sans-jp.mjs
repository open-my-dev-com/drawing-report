/**
 * 동봉 일본어 폰트 데이터(src/fonts/noto-sans-jp-data.ts) 재생성 스크립트 (ADR-042).
 *
 * Google Fonts가 배포하는 Noto Sans JP Regular **정적 인스턴스**(TTF)를 받아,
 * 일본어 상용 글자 범위로 서브셋한 뒤 base64 모듈로 굽는다.
 *   node scripts/generate-noto-sans-jp.mjs
 *
 * 선행 조건: Python3 + fonttools (`pip install fonttools brotli`).
 *
 * @remarks
 * 가변 폰트를 fonttools로 인스턴싱한 파일은 @pdfme/pdf-lib의 폰트 임베더가 받지 못해
 * (CID 폰트 임베드 중 오류), 반드시 Google Fonts가 내려주는 정적 TTF를 원본으로 쓴다.
 * 서브셋 범위는 UNICODES에서 조정한다.
 */
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Google Fonts CSS가 돌려주는 Regular 정적 인스턴스 TTF를 받는다(가변 폰트 아님).
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400';
const LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt';
const UA = 'Mozilla/5.0';

// 일본어 전표에 실제로 쓰이는 범위: 라틴·구두점·통화·괄호기호, 가나, CJK 상용 한자, 전각/반각.
const UNICODES =
  '0020-007E,00A0-00FF,2000-206F,20A0-20BF,2100-214F,2190-21FF,2460-24FF,25A0-25FF,' +
  '2600-26FF,3000-303F,3040-309F,30A0-30FF,3190-319F,31F0-31FF,3220-325F,3280-32FF,' +
  '3300-33FF,4E00-9FFF,F900-FAFF,FF00-FFEF';

const work = mkdtempSync(join(tmpdir(), 'notosansjp-'));
execSync(`curl -sSL -A "${UA}" -o font.css "${CSS_URL}"`, { cwd: work, stdio: 'inherit' });
const css = readFileSync(join(work, 'font.css'), 'utf8');
const ttfUrl = css.match(/https:\/\/[^)]+\.ttf/)?.[0];
if (!ttfUrl) throw new Error('Google Fonts CSS에서 TTF URL을 찾지 못했습니다');
execSync(`curl -sSL -A "${UA}" -o src.ttf "${ttfUrl}"`, { cwd: work, stdio: 'inherit' });
execSync(`curl -sSL -o OFL.txt "${LICENSE_URL}"`, { cwd: work, stdio: 'inherit' });

execSync(
  `pyftsubset src.ttf --output-file=subset.ttf --unicodes="${UNICODES}" ` +
    `--layout-features='*' --glyph-names --no-hinting --desubroutinize`,
  { cwd: work, stdio: 'inherit' },
);

const b64 = readFileSync(join(work, 'subset.ttf')).toString('base64');
const license = readFileSync(join(work, 'OFL.txt'), 'utf8');

const out = [
  '// 생성 파일 — 직접 수정하지 않는다. 재생성: node scripts/generate-noto-sans-jp.mjs (Noto Sans JP, TTF, Regular 서브셋)',
  "// 폰트 저작권: Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'. SIL Open Font License 1.1 — 전문은 패키지의 OFL-NotoSansJP.txt",
  '// Google Fonts가 배포하는 Noto Sans JP Regular 정적 인스턴스를 일본어 상용 글자 범위로 줄인 서브셋이다(OFL 개작본, 예약 이름 미사용).',
  '',
  '/** Noto Sans JP Regular TTF 서브셋 (base64) */',
  `export const NOTO_SANS_JP_REGULAR_B64 = '${b64}';`,
  '',
].join('\n');

const root = new URL('..', import.meta.url).pathname;
writeFileSync(join(root, 'src/fonts/noto-sans-jp-data.ts'), out);
writeFileSync(join(root, 'OFL-NotoSansJP.txt'), license);
console.log('Noto Sans JP 데이터 모듈을 재생성했습니다');
