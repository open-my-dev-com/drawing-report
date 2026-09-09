/**
 * 동봉 일본어 폰트 데이터(`src/fonts/noto-sans-jp-data.ts`)를 다시 생성합니다.
 *
 * Google Fonts가 배포하는 Noto Sans JP Regular 정적 TTF를 받아 일본어 상용 글자
 * 범위에 맞게 글자를 추린 뒤 Base64 모듈로 변환합니다.
 *   node scripts/generate-noto-sans-jp.mjs
 *
 * 선행 조건: Python3 + fonttools (`pip install fonttools brotli`).
 *
 * @remarks
 * fonttools로 가변 폰트를 정적 변환한 파일은 @pdfme/pdf-lib에서 CID 폰트로 임베드할 수
 * 없으므로 Google Fonts가 배포하는 정적 TTF를 원본으로 사용합니다.
 * 포함할 글자 범위는 UNICODES에서 조정합니다.
 */
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Google Fonts CSS에 명시된 Regular 정적 TTF를 내려받습니다.
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400';
const LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt';
const UA = 'Mozilla/5.0';

// 라틴 문자, 기호, 가나, CJK 통합 한자, 전각·반각 문자를 포함합니다.
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
  '// 자동 생성 파일입니다. 직접 수정하지 마세요. 다시 생성하려면 node scripts/generate-noto-sans-jp.mjs를 실행합니다(Noto Sans JP Regular TTF 일부 글자 포함).',
  "// 폰트 저작권: Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'. SIL Open Font License 1.1입니다. 라이선스 전체 내용은 패키지의 OFL-NotoSansJP.txt에서 확인할 수 있습니다.",
  '// Google Fonts가 배포하는 Noto Sans JP Regular 정적 인스턴스에서 일본어 상용 글자만 추린 폰트입니다(OFL 개작본, 예약 이름 미사용).',
  '',
  '/** Noto Sans JP Regular TTF 서브셋(Base64) */',
  `export const NOTO_SANS_JP_REGULAR_B64 = '${b64}';`,
  '',
].join('\n');

const root = new URL('..', import.meta.url).pathname;
writeFileSync(join(root, 'src/fonts/noto-sans-jp-data.ts'), out);
writeFileSync(join(root, 'OFL-NotoSansJP.txt'), license);
console.log('Noto Sans JP 데이터 모듈을 재생성했습니다');
