import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SlipParseError,
  parseSlipFile,
  serializeSlipFile,
  type SlipTemplateFile,
} from '../src/index.js';

const template: SlipTemplateFile = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  kind: 'template',
  template: {
    meta: { title: '거래명세서' },
    paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
    pages: [{ elements: [] }],
    assets: [],
  },
};

describe('.slip 봉투 파싱', () => {
  it('직렬화한 파일을 다시 파싱할 수 있다', () => {
    const parsed = parseSlipFile(serializeSlipFile(template));
    expect(parsed.kind).toBe('template');
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('JSON이 아니면 SlipParseError', () => {
    expect(() => parseSlipFile('not-json')).toThrow(SlipParseError);
  });

  it('kind가 없으면 SlipParseError', () => {
    expect(() => parseSlipFile('{"schemaVersion":"0.1.0"}')).toThrow(SlipParseError);
  });

  it('schemaVersion이 semver가 아니면 SlipParseError', () => {
    expect(() => parseSlipFile('{"schemaVersion":"v1","kind":"template"}')).toThrow(SlipParseError);
  });
});
