// 모달 상태와 초안 컨트롤러 — 화면 없이 직접 확인한다.
import { describe, expect, it, vi } from 'vitest';
import type { SlipListItem, SlipTemplateFile, StorageAdapter } from '@omdc-slipkit/core';
import { DialogsController } from '../../src/designer/controllers/dialogs.js';
import { FormulaDraftController, columnSuggestion } from '../../src/designer/controllers/formula-draft.js';
import { SampleDraftController, parseSampleValues } from '../../src/designer/controllers/sample-draft.js';
import { FormsController } from '../../src/designer/controllers/forms-storage.js';
import { imagePickErrorText, usedImages, imageParameterKeys } from '../../src/designer/image-pick.js';

function host() {
  return { requestUpdate: vi.fn(), updateComplete: Promise.resolve(true) };
}

describe('DialogsController', () => {
  it('연 모달만 열려 있다고 답한다', () => {
    const c = new DialogsController(host());
    expect(c.anyOpen).toBe(false);
    c.open('formula');
    expect(c.isOpen('formula')).toBe(true);
    expect(c.isOpen('sample')).toBe(false);
    expect(c.anyOpen).toBe(true);
  });

  it('닫으면 그 모달만 닫힌다', () => {
    const c = new DialogsController(host());
    c.open('formula');
    c.open('sample');
    c.close('formula');
    expect(c.isOpen('formula')).toBe(false);
    expect(c.isOpen('sample')).toBe(true);
  });

  it('모두 닫기는 열려 있던 것을 전부 닫는다', () => {
    const c = new DialogsController(host());
    c.open('save');
    c.open('myForms');
    c.closeAll();
    expect(c.anyOpen).toBe(false);
  });

  it('열고 닫을 때마다 화면 갱신을 요청한다', () => {
    const h = host();
    const c = new DialogsController(h);
    c.open('image');
    c.close('image');
    expect(h.requestUpdate).toHaveBeenCalledTimes(2);
  });

  it('조용히 모두 닫기는 화면 갱신을 요청하지 않는다', () => {
    const h = host();
    const c = new DialogsController(h);
    c.open('image');
    h.requestUpdate.mockClear();
    c.closeAllQuietly();
    expect(c.anyOpen).toBe(false);
    expect(h.requestUpdate).not.toHaveBeenCalled();
  });
});

describe('columnSuggestion', () => {
  const parameters = [
    { key: 'items', fields: [{ key: 'amount', title: '금액' }, { key: 'agent', title: '담당' }, { key: 'qty', title: '수량' }] },
    { key: 'total', fields: [] },
  ];

  it('점 뒤에 아무것도 없으면 하위 필드를 모두 제안한다', () => {
    const found = columnSuggestion('SUM(items.', 10, parameters);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount', 'agent', 'qty']);
    expect(found?.typedLength).toBe(0);
  });

  it('입력한 글자로 시작하는 필드만 남기고 대소문자를 가리지 않는다', () => {
    const found = columnSuggestion('SUM(items.A', 11, parameters);
    expect(found?.columns.map((c) => c.key)).toEqual(['amount', 'agent']);
    expect(found?.typedLength).toBe(1);
  });

  it('커서 앞만 본다 — 뒤에 남은 글은 제안에 영향을 주지 않는다', () => {
    const found = columnSuggestion('SUM(items.) + 1', 10, parameters);
    expect(found?.columns.length).toBe(3);
  });

  it('하위 필드가 없는 파라미터나 모르는 이름은 제안하지 않는다', () => {
    expect(columnSuggestion('total.', 6, parameters)).toBeNull();
    expect(columnSuggestion('nope.', 5, parameters)).toBeNull();
  });

  it('맞는 필드가 하나도 없으면 제안하지 않는다', () => {
    expect(columnSuggestion('items.zz', 8, parameters)).toBeNull();
  });

  it('점이 없으면 제안하지 않는다', () => {
    expect(columnSuggestion('items', 5, parameters)).toBeNull();
  });
});

describe('FormulaDraftController', () => {
  it('편집을 시작하면 커서가 글 끝에 온다', () => {
    const c = new FormulaDraftController(host(), () => null);
    c.start('SUM(a)');
    expect(c.draft).toBe('SUM(a)');
    expect(c.caret).toBe(6);
  });

  it('수식이 없던 필드는 빈 초안으로 시작한다', () => {
    const c = new FormulaDraftController(host(), () => null);
    c.start(undefined);
    expect(c.draft).toBe('');
  });

  it('커서 위치가 그대로면 화면을 다시 그리지 않는다', () => {
    const h = host();
    const c = new FormulaDraftController(h, () => null);
    c.start('abc');
    h.requestUpdate.mockClear();
    c.syncCaret(3);
    expect(h.requestUpdate).not.toHaveBeenCalled();
    c.syncCaret(1);
    expect(h.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it('입력란이 없으면 글 끝에 끼워 넣는다', () => {
    const c = new FormulaDraftController(host(), () => null);
    c.start('SUM(');
    c.insert('items');
    expect(c.draft).toBe('SUM(items');
  });

  it('선택 범위가 있으면 그 자리를 바꿔 넣는다', () => {
    const input = { selectionStart: 4, selectionEnd: 7, focus() {}, setSelectionRange() {} };
    const c = new FormulaDraftController(host(), () => input as unknown as HTMLTextAreaElement);
    c.start('SUM(old)');
    c.insert('new');
    expect(c.draft).toBe('SUM(new)');
  });

  it('뒤에 붙일 글도 함께 넣는다', () => {
    const c = new FormulaDraftController(host(), () => null);
    c.start('');
    c.insert('ROUND(', ')');
    expect(c.draft).toBe('ROUND()');
  });

  it('앞뒤 공백을 지운 값을 적용하고, 비었으면 지운다는 뜻의 null을 준다', () => {
    const c = new FormulaDraftController(host(), () => null);
    c.start('  SUM(a)  ');
    expect(c.commit()).toBe('SUM(a)');
    c.start('   ');
    expect(c.commit()).toBeNull();
  });
});

describe('parseSampleValues', () => {
  it('빈 글은 빈 객체로 본다 — 샘플 값을 지운다는 뜻이다', () => {
    expect(parseSampleValues('   ')).toEqual({});
  });

  it('객체를 그대로 반환한다', () => {
    expect(parseSampleValues('{ "a": 1 }')).toEqual({ a: 1 });
  });

  it('깨진 JSON과 배열·숫자는 거부한다', () => {
    expect(parseSampleValues('{ "a": ')).toBeNull();
    expect(parseSampleValues('[1, 2]')).toBeNull();
    expect(parseSampleValues('42')).toBeNull();
    expect(parseSampleValues('null')).toBeNull();
  });
});

describe('SampleDraftController', () => {
  it('JSON 편집으로 들어갈 때만 초안을 만든다', () => {
    const c = new SampleDraftController(host());
    const skeleton = vi.fn(() => '{"a":1}');
    c.setJsonMode(true, skeleton);
    expect(c.jsonMode).toBe(true);
    expect(c.jsonDraft).toBe('{"a":1}');

    c.setJsonMode(false, skeleton);
    expect(c.jsonMode).toBe(false);
    expect(skeleton).toHaveBeenCalledTimes(1);
  });

  it('같은 방식을 다시 고르면 아무것도 하지 않는다', () => {
    const h = host();
    const c = new SampleDraftController(h);
    c.setJsonMode(false, () => '');
    expect(h.requestUpdate).not.toHaveBeenCalled();
  });

  it('되돌리면 페이지와 편집 방식이 처음 상태가 된다', () => {
    const c = new SampleDraftController(host());
    c.setPage(3);
    c.setJsonMode(true, () => '{}');
    c.setImageError('오류');
    c.reset();
    expect(c.page).toBe(0);
    expect(c.jsonMode).toBe(false);
    expect(c.imageError).toBeNull();
  });
});

describe('FormsController', () => {
  function item(id: string, title: string): SlipListItem {
    return { id, title, kind: 'template', updatedAt: '2026-01-01T00:00:00.000Z' } as SlipListItem;
  }

  function listAdapter(items: SlipListItem[][]): StorageAdapter {
    let call = 0;
    return {
      list: async () => {
        const page = items[call++] ?? [];
        return { items: page, nextCursor: call < items.length ? String(call) : undefined };
      },
    } as unknown as StorageAdapter;
  }

  it('저장한 적이 없으면 새 식별자를 만든다', () => {
    const c = new FormsController(host());
    const id = c.nextId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('저장한 적이 있으면 같은 식별자를 다시 사용한다', () => {
    const c = new FormsController(host());
    c.markSaved('abc');
    expect(c.nextId()).toBe('abc');
  });

  it('새 양식으로 저장을 켜면 다른 식별자를 만든다', () => {
    const c = new FormsController(host());
    c.markSaved('abc');
    c.setAsNew(true);
    expect(c.nextId()).not.toBe('abc');
  });

  it('저장에 성공하면 안내를 켜고 오류를 지운다', () => {
    const c = new FormsController(host());
    c.fail(new Error('실패'));
    c.markSaved('abc');
    expect(c.savedNotice).toBe(true);
    expect(c.error).toBeNull();
  });

  it('실패 문구는 Error든 글이든 같은 자리에 담는다', () => {
    const c = new FormsController(host());
    c.fail(new Error('쓸 수 없음'));
    expect(c.error).toBe('쓸 수 없음');
    c.fail('양식만 불러올 수 있습니다');
    expect(c.error).toBe('양식만 불러올 수 있습니다');
  });

  it('커서가 이어지는 동안 목록을 모두 불러온다', async () => {
    const c = new FormsController(host());
    await c.loadList(listAdapter([[item('1', '가')], [item('2', '나')]]));
    expect(c.filtered().map((x) => x.id)).toEqual(['1', '2']);
  });

  it('불러오기에 실패하면 목록을 비우고 오류를 남긴다', async () => {
    const c = new FormsController(host());
    const failing = { list: async () => { throw new Error('읽기 실패'); } } as unknown as StorageAdapter;
    await c.loadList(failing);
    expect(c.filtered()).toEqual([]);
    expect(c.error).toBe('읽기 실패');
  });

  it('검색어에 맞는 것만 남기고 첫 페이지로 돌아간다', async () => {
    const c = new FormsController(host());
    await c.loadList(listAdapter([[item('1', '거래명세서'), item('2', '견적서')]]));
    c.setPage(1);
    c.setQuery('명세');
    expect(c.filtered().map((x) => x.id)).toEqual(['1']);
    expect(c.page).toBe(0);
  });

  it('지운 양식이 현재 저장 대상이면 저장 식별자도 지운다', async () => {
    const c = new FormsController(host());
    await c.loadList(listAdapter([[item('1', '가'), item('2', '나')]]));
    c.markSaved('1');
    c.forget('1', 10);
    expect(c.savedId).toBeNull();
    expect(c.filtered().map((x) => x.id)).toEqual(['2']);
  });

  it('마지막 페이지의 항목을 지우면 빈 페이지에 남지 않는다', async () => {
    const c = new FormsController(host());
    await c.loadList(listAdapter([[item('1', '가'), item('2', '나'), item('3', '다')]]));
    c.setPage(1);
    c.forget('3', 2);
    expect(c.page).toBe(0);
  });
});

describe('이미지 선택 도우미', () => {
  const texts = { notImage: '이미지가 아닙니다', readFailed: '읽을 수 없습니다', tooLarge: '최대 {max}, 선택 {size}' };

  it('실패 사유마다 다른 문구를 만든다', () => {
    expect(imagePickErrorText({ ok: false, reason: 'notImage', size: 1 }, texts, 1024)).toBe(texts.notImage);
    expect(imagePickErrorText({ ok: false, reason: 'readFailed' }, texts, 1024)).toBe(texts.readFailed);
  });

  it('용량 초과는 허용 크기와 선택한 크기를 함께 적는다', () => {
    const message = imagePickErrorText(
      { ok: false, reason: 'tooLarge', size: 3 * 1024 * 1024 },
      texts,
      2 * 1024 * 1024,
    );
    expect(message).toBe('최대 2MB, 선택 3MB');
  });

  function fileWith(elements: unknown[], parameters: unknown[] = []): SlipTemplateFile {
    return {
      schemaVersion: '0.1.0',
      kind: 'template',
      template: { meta: { title: 't' }, paper: {}, assets: [], parameters, pages: [{ elements }] },
    } as unknown as SlipTemplateFile;
  }

  it('등록된 이미지를 중복 없이 모으고 자리표시는 뺀다', () => {
    const file = fileWith([
      { type: 'image', id: 'a', src: 'data:image/png;base64,AAA' },
      { type: 'image', id: 'b', src: 'data:image/png;base64,AAA' },
      { type: 'image', id: 'c', src: 'PLACEHOLDER' },
      { type: 'image', id: 'd' },
      { type: 'text', id: 'e', content: '' },
    ]);
    expect(usedImages(file, 'PLACEHOLDER')).toEqual(['data:image/png;base64,AAA']);
  });

  it('파일이 없으면 빈 목록이다', () => {
    expect(usedImages(null, 'PLACEHOLDER')).toEqual([]);
    expect(imageParameterKeys(null).size).toBe(0);
  });

  it('이미지 종류 파라미터와 이미지 요소가 쓰는 키를 함께 모은다', () => {
    const file = fileWith(
      [{ type: 'image', id: 'a', parameter: 'stamp' }, { type: 'image', id: 'b' }],
      [{ key: 'logo', label: '로고', valueType: 'image' }, { key: 'title', label: '제목' }],
    );
    expect([...imageParameterKeys(file)].sort()).toEqual(['logo', 'stamp']);
  });
});
