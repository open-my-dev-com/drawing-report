import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, MAX_IMAGE_BYTES, SLIP_LIMITS, slipElementSchema } from '@omdc-slipkit/core';
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

  it('조건부 서식 구조와 현재 스키마 버전을 안내한다 (ADR-062)', () => {
    const elements = schemaTopicText('elements');
    expect(elements).toContain('conditionalFormats');
    expect(elements).toContain('must return a boolean');
    expect(schemaTopicText('grid')).toContain('conditionalFormats');
    // 안내문의 버전·상한 표기는 core의 값을 따른다.
    expect(schemaTopicText('overview')).toContain(`"schemaVersion": "${CURRENT_SCHEMA_VERSION}"`);
    expect(elements).toContain(`max ${SLIP_LIMITS.maxConditionalFormats}`);
  });

  it('MCP로 작성할 이미지는 외부 URL 대신 로컬 파일을 내장하도록 안내한다', () => {
    const documented = schemaTopicText('elements');
    expect(documented).toContain('slip_edit set_image');
    expect(documented).toContain('Do not author http(s) URLs');
    expect(documented).toContain('asset://');
  });

  it('이미지는 PNG·JPEG와 크기 상한만 안내하고 GIF·WebP는 안내하지 않는다', () => {
    const elements = schemaTopicText('elements');
    expect(elements).toContain('PNG or JPEG');
    expect(elements).toContain(`${MAX_IMAGE_BYTES / 1024 / 1024} MiB`);
    expect(elements).toContain('signature');
    expect(elements).not.toMatch(/GIF|WebP/i);
  });

  it('바코드 필드와 그리드 제약을 실제 스키마에 맞게 안내한다', () => {
    const elements = schemaTopicText('elements');
    const grid = schemaTopicText('grid');

    expect(elements).toContain('"kind": "qrcode"');
    expect(elements).not.toContain('barcodeKind');
    expect(grid).toContain('at most ONE value source');
    // 행 구간 모델과 페이지 방식을 안내하고 옛 반복 필드는 남기지 않는다.
    expect(grid).toContain('"bands"');
    expect(grid).toContain('"pagination"');
    expect(grid).toContain('exactly ONE "item" band');
    expect(grid).not.toContain('perPage');
    expect(grid).not.toContain('repeatHeader');
  });

  it('행 구간 셀의 예약 참조를 안내한다', () => {
    const formula = schemaTopicText('formula');
    for (const name of ['@item', '@group', '@page', '@all', '@carried']) {
      expect(formula).toContain(name);
    }
    expect(formula).toContain('SUM(@page.$(amount))');
  });

  it('키 규칙과 $(...) 명시 참조를 안내하고 예시 수식은 명시 참조로 적는다', () => {
    const parameters = schemaTopicText('parameters');
    expect(parameters).toContain('any non-empty string');
    expect(parameters).toContain('unique by exact match');
    expect(parameters).toContain('"__proto__"');
    expect(parameters).toContain('reads as null');

    const formula = schemaTopicText('formula');
    expect(formula).toContain('one $(...) per path step');
    expect(formula).toContain('$(items).$(amount)');
    expect(formula).toContain('@item.$(amount)');
    expect(formula).toContain('"\\)" for ")"');
    expect(formula).toContain('Every business-data reference must use $(...)');
    expect(formula).toContain('is a syntax error');
    expect(formula).not.toContain('still accepted');
    // 업무 데이터를 참조하는 예시는 모두 명시 참조다.
    expect(formula).not.toContain('SUM(items.amount)');
    expect(formula).not.toContain('SUM(@page.amount)');
    expect(formula).toContain('$(amount) < 0');
    expect(schemaTopicText('elements')).toContain('"formula": "SUM($(items).$(amount))"');
  });

  it('FORMAT_DATE의 토큰·리터럴 블록·입력 형식을 안내한다', () => {
    const formula = schemaTopicText('formula');
    expect(formula).toContain('exactly nine tokens');
    expect(formula).toContain('YYYY YY MM M DD D HH mm ss');
    expect(formula).toContain('[...]');
    expect(formula).toContain('"\\]" is "]"');
    expect(formula).toContain('"YYYYY", "MMM", "Date"');
    expect(formula).toContain('"YYYY-MM-DDTHH:mm[:ss[.fff]][Z|±HH:mm]"');
    expect(formula).toContain('read as UTC');
  });

  it('반복 그리드의 첫 페이지 시작 이동과 빈 페이지 계획 오류를 안내한다', () => {
    const grid = schemaTopicText('grid');
    expect(grid).toContain('starts on the next output page');
    expect(grid).toContain('header-only fragment');
    expect(grid).toContain('full flow area of an empty page');
    expect(grid).toContain('planning fails with an error');
  });

  it('FORMAT_NUMBER의 두 번째 인자를 소수 자릿수로 안내한다', () => {
    const formula = schemaTopicText('formula');
    expect(formula).toContain('fractionDigits');
    expect(formula).toContain('FORMAT_NUMBER(SUM($(items).$(amount)) * 1.1, 0)');
    expect(formula).not.toContain('* 1.1, "#,##0")');
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
