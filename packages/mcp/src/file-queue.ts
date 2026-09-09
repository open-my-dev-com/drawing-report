/**
 * 파일 경로별로 작업을 차례대로 실행하는 큐입니다.
 * 같은 파일의 읽기-수정-저장 작업이 겹쳐 나중 저장이 앞선 변경을 덮어쓰는 일을 막습니다.
 * 서로 다른 경로의 작업은 서로 기다리지 않습니다.
 */
export class PathQueue {
  /** 경로별로 마지막에 넣은 작업의 완료 Promise입니다. 작업의 성공 여부와 관계없이 이행됩니다. */
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * 경로에 대한 작업을 큐에 넣고 같은 경로의 앞선 작업이 모두 끝난 뒤 실행합니다.
   * 앞선 작업이 실패해도 다음 작업은 실행합니다.
   *
   * @param key - 정규화한 대상 경로입니다. 같은 파일이면 같은 문자열이어야 합니다.
   * @param task - 실행할 작업
   * @returns 작업의 결과. 작업이 던진 오류는 그대로 전달합니다.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // 마지막 작업이 끝나면 항목을 지워 큐가 경로 수만큼 계속 자라지 않게 합니다.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** 아직 끝나지 않은 작업이 있는 경로 수입니다. */
  get pendingKeys(): number {
    return this.tails.size;
  }
}
