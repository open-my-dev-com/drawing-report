// 되돌리기 기록의 크기 예산 — 개수 상한과 별개로 보관하는 스냅샷 전체 크기를 제한합니다.
import { describe, expect, it } from 'vitest';
import type { SlipTemplateFile } from '@omdc-slipkit/core';
import { HistoryController, MAX_SNAPSHOT_BYTES } from '../../src/designer/controllers/history.js';

/** 본문 크기를 마음대로 정할 수 있는 양식 — 이미지를 담은 큰 양식을 대신합니다 */
function makeFile(title: string, fillerLength: number): SlipTemplateFile {
  return {
    schemaVersion: '0.1.0',
    kind: 'template',
    template: {
      meta: { title },
      paper: { width: 210, height: 297, padding: [20, 15, 20, 15] },
      pages: [{ elements: [] }],
      assets: [{ id: 'a-1', data: 'x'.repeat(fillerLength) }],
    },
  } as unknown as SlipTemplateFile;
}

/** 양식 하나만 들고 있는 최소 호스트 */
function makeHost(file: SlipTemplateFile) {
  return {
    file,
    setFile(next: SlipTemplateFile): void {
      this.file = next;
    },
    savedId: null as string | null,
    restoreSavedId(): void {},
  };
}

/** 시험용 예산 — 스냅샷 세 벌이면 넘어섭니다 */
const BUDGET = 3_000;
const THIRD_OF_BUDGET = Math.ceil(BUDGET / 3);

describe('되돌리기 기록의 크기 예산', () => {
  it('스냅샷 크기 합이 예산을 넘으면 오래된 단계부터 버린다', () => {
    const host = makeHost(makeFile('0', THIRD_OF_BUDGET));
    const history = new HistoryController(host, BUDGET);

    for (let i = 1; i <= 4; i += 1) {
      history.record();
      host.file = makeFile(String(i), THIRD_OF_BUDGET);
    }

    expect(history.undoDepth).toBeLessThan(4);
    expect(history.undoSnapshotBytes).toBeLessThanOrEqual(BUDGET);
    // 버린 것은 오래된 단계이고, 마지막 편집 직전 상태는 그대로 남습니다
    expect(history.undo()).toBe(true);
    expect(host.file.template.meta.title).toBe('3');
  });

  it('한 단계가 예산보다 커도 최근 한 단계는 남겨 되돌릴 수 있다', () => {
    const host = makeHost(makeFile('처음', BUDGET * 2));
    const history = new HistoryController(host, BUDGET);

    history.record();
    expect(history.undoDepth).toBe(1);
    expect(history.undoSnapshotBytes).toBeGreaterThan(BUDGET);

    host.file = makeFile('나중', 10);
    expect(history.undo()).toBe(true);
    expect(host.file.template.meta.title).toBe('처음');
  });

  it('기본 예산 안에서는 개수 상한(50단계)까지 그대로 쌓는다', () => {
    // 200KB짜리 양식 51벌은 기본 예산(32MiB) 안이라 개수 상한만 적용됩니다.
    const host = makeHost(makeFile('0', 200_000));
    const history = new HistoryController(host);

    for (let i = 1; i <= 51; i += 1) {
      history.record();
      host.file = makeFile(String(i), 200_000);
    }

    expect(history.undoDepth).toBe(50);
    expect(history.undoSnapshotBytes).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
  });
});
