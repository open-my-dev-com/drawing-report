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

  it('MCP로 작성할 이미지는 외부 URL 대신 로컬 파일을 내장하도록 안내한다', () => {
    const documented = schemaTopicText('elements');
    expect(documented).toContain('slip_edit set_image');
    expect(documented).toContain('Do not author http(s) URLs');
    expect(documented).toContain('asset://');
  });

  it('바코드 필드와 그리드 제약을 실제 스키마에 맞게 안내한다', () => {
    const elements = schemaTopicText('elements');
    const grid = schemaTopicText('grid');

    expect(elements).toContain('"kind": "qrcode"');
    expect(elements).not.toContain('barcodeKind');
    expect(grid).toContain('at most ONE value source');
    expect(grid).toContain('(perPage - 1)');
  });

  it('FORMAT_NUMBER의 두 번째 인자를 소수 자릿수로 안내한다', () => {
    const formula = schemaTopicText('formula');
    expect(formula).toContain('fractionDigits');
    expect(formula).toContain('FORMAT_NUMBER(SUM(items.amount) * 1.1, 0)');
    expect(formula).not.toContain('FORMAT_NUMBER(SUM(items.amount) * 1.1, "#,##0")');
  });

  it('수식에서 실제 파서가 지원하는 연산자만 안내한다', () => {
    const formula = schemaTopicText('formula');
    expect(formula).toContain('Arithmetic operators: + - * /');
    expect(formula).toContain('Comparisons: = <> < > <= >=');
    expect(formula).toContain('CONCAT');
    expect(formula).not.toContain('% ^');
    expect(formula).not.toContain('& for text concatenation');
  });
});
