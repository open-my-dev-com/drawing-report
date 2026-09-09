/**
 * TSDoc 주석 형식을 검증하는 최소 구성입니다.
 *
 * 규칙은 `tsdoc/syntax` 하나만 켭니다. 오탈자·비표준 태그, JSDoc식 타입 중괄호
 * 같은 형식 오류를 커밋 검사에서 찾습니다. `@param`·`@returns` 누락은
 * `.claude/rules/comments.md`에 따라 작성·검토 단계에서 확인합니다.
 */
import tsParser from '@typescript-eslint/parser';
import tsdoc from 'eslint-plugin-tsdoc';

export default [
  // 주석이 없고 파싱 시간만 늘어나는 동봉 폰트 base64 생성 파일(합계 약 7MB)은 lint에서 제외합니다.
  {
    ignores: [
      'packages/elements/src/fonts/pretendard-data.ts',
      'packages/elements/src/fonts/noto-sans-jp-data.ts',
    ],
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/test/**/*.{ts,tsx}', 'examples/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      tsdoc,
    },
    rules: {
      'tsdoc/syntax': 'error',
    },
  },
];
