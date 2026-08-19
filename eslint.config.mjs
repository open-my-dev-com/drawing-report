/**
 * TSDoc 주석 형식 검증 전용 최소 구성 (ADR-030).
 *
 * 규칙은 `tsdoc/syntax` 하나만 켠다 — 오탈자·비표준 태그, JSDoc식 타입 중괄호
 * 같은 형식 오류를 커밋 게이트에서 잡는다. `@param`·`@returns` 누락 검사는
 * 도구를 넣지 않고 지침(.claude/rules/comments.md)과 리뷰로 유지한다.
 */
import tsParser from '@typescript-eslint/parser';
import tsdoc from 'eslint-plugin-tsdoc';

export default [
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
