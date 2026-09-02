import { describe, expect, it } from 'vitest';
import { PathQueue } from '../src/file-queue.js';

/** 밖에서 해결할 수 있는 약속을 만든다. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('PathQueue', () => {
  it('같은 경로의 작업은 넣은 순서대로 하나씩 실행한다', async () => {
    const queue = new PathQueue();
    const order: string[] = [];
    const gate = deferred();
    const first = queue.run('a', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });
    const second = queue.run('a', async () => {
      order.push('second');
      return 2;
    });
    // 두 번째 작업은 첫 번째가 끝나기 전에는 시작하지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['first:start']);
    gate.resolve();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('서로 다른 경로의 작업은 서로 기다리지 않는다', async () => {
    const queue = new PathQueue();
    const gate = deferred();
    const slow = queue.run('a', async () => {
      await gate.promise;
      return 'a';
    });
    // 경로 b는 a가 막혀 있어도 바로 끝난다.
    expect(await queue.run('b', async () => 'b')).toBe('b');
    // 끝난 경로의 항목은 다음 틱에 정리되고, 막혀 있는 a만 남는다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.pendingKeys).toBe(1);
    gate.resolve();
    expect(await slow).toBe('a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.pendingKeys).toBe(0);
  });

  it('앞선 작업이 실패해도 다음 작업은 실행하고, 오류는 해당 호출자에게만 전달한다', async () => {
    const queue = new PathQueue();
    const failing = queue.run('a', async () => {
      throw new Error('boom');
    });
    const next = queue.run('a', async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    expect(await next).toBe('ok');
  });
});
