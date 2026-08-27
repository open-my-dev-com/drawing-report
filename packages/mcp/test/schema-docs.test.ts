import { describe, expect, it } from 'vitest';
import { slipElementSchema } from '@omdc-slipkit/core';
import { SCHEMA_TOPICS, schemaTopicText } from '../src/schema-docs.js';

describe('slip_schema 안내문', () => {
  it('요소 종류 안내가 실제 스키마의 요소 종류와 일치한다', () => {
    const documented = schemaTopicText('elements');
    const types = slipElementSchema.options.map(
      (option) => (option as unknown as { shape: { type: { value: string } } }).shape.type.value,
    );
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect(documented).toContain(`${type}`);
    }
  });

  it('모든 주제가 비어 있지 않은 안내를 반환한다', () => {
    for (const topic of SCHEMA_TOPICS) {
      expect(schemaTopicText(topic).length).toBeGreaterThan(100);
    }
  });
});
