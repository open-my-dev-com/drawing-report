/**
 * 목록 조회에 사용하는 파일 메타데이터 캐시와 측정 함수입니다.
 *
 * 캐시는 저장소 인스턴스의 메모리에만 두고 작업 디렉터리에는 아무것도 남기지 않습니다.
 * 같은 파일인지는 `lstat` 결과로 만든 파일 상태 식별값으로만 판정하며, 파일 본문·복호화한 평문·키는
 * 보관하지 않습니다.
 */
import { lstat } from 'node:fs/promises';
import type { SlipListItem } from '@omdc-slipkit/core';

/** 목록 측정값을 인스턴스에서 읽을 때 사용하는 전역 심볼입니다. 진단과 성능 측정에만 사용하며 공개 API가 아닙니다. */
export const LIST_METRICS = Symbol.for('@omdc-slipkit/mcp.listMetrics');

/** `lstat`을 동시에 실행할 수 있는 최대 개수입니다. */
export const MAX_LSTAT_CONCURRENCY = 32;

/** 목록 조회 측정값입니다. */
export interface ListMetrics {
  /** `list()` 호출 횟수입니다. */
  listCalls: number;
  /** `readdir`가 반환한 항목 수이며 디렉터리도 포함합니다. */
  directoryEntries: number;
  /** `.slip` 후보 파일 수입니다. */
  candidates: number;
  /** 후보 파일 상태 식별값을 만들기 위한 `lstat` 호출 수입니다. 경로 검사에 사용한 호출은 포함하지 않습니다. */
  lstat: number;
  /** 동시에 진행한 `lstat`의 최대 개수입니다. */
  maxConcurrentLstat: number;
  /** 파일 본문을 읽은 횟수입니다. */
  bodyReads: number;
  /** 읽은 본문의 전체 바이트 수입니다. */
  bodyBytes: number;
  /** 복호화 후 파싱을 포함한 전체 파싱 횟수입니다. */
  parses: number;
  /** 복호화를 시도한 횟수입니다. 키마다 한 번으로 계산합니다. */
  decryptAttempts: number;
  /** 파일 상태 식별값이 같아 재사용한 유효 항목 수입니다. */
  cacheHits: number;
  /** 새로 분석하기 시작한 항목 수입니다. */
  cacheMisses: number;
  /** 파일 상태 식별값이 같아 재사용한 제외 결과 수입니다. */
  excludedHits: number;
  /** 현재 캐시에 남아 있는 항목 수입니다. */
  readonly cachedEntries: number;
  /** 모든 카운터를 0으로 되돌립니다. 캐시 내용은 유지합니다. */
  reset(): void;
}

/** `reset()`이 0으로 되돌리는 횟수 항목입니다. */
const COUNTER_KEYS = [
  'listCalls',
  'directoryEntries',
  'candidates',
  'lstat',
  'maxConcurrentLstat',
  'bodyReads',
  'bodyBytes',
  'parses',
  'decryptAttempts',
  'cacheHits',
  'cacheMisses',
  'excludedHits',
] as const;

/**
 * 목록 조회 횟수를 기록하는 객체를 만듭니다. `cachedEntries`는 읽을 때마다 현재 캐시 크기를 반환합니다.
 *
 * @param cachedEntries - 현재 캐시 항목 수를 반환하는 함수
 * @returns 카운터가 모두 0인 측정 객체
 */
function createListMetrics(cachedEntries: () => number): ListMetrics {
  const metrics = {
    listCalls: 0,
    directoryEntries: 0,
    candidates: 0,
    lstat: 0,
    maxConcurrentLstat: 0,
    bodyReads: 0,
    bodyBytes: 0,
    parses: 0,
    decryptAttempts: 0,
    cacheHits: 0,
    cacheMisses: 0,
    excludedHits: 0,
    reset(): void {
      for (const key of COUNTER_KEYS) metrics[key] = 0;
    },
  };
  Object.defineProperty(metrics, 'cachedEntries', { get: cachedEntries, enumerable: true });
  return metrics as ListMetrics;
}

/** 같은 파일인지 판정하는 파일 상태 식별값입니다. */
export interface FileFingerprint {
  /** 장치 번호입니다. */
  dev: bigint;
  /** inode 번호입니다. */
  ino: bigint;
  /** 파일 크기입니다. */
  size: bigint;
  /** 마지막 수정 시각(나노초)입니다. */
  mtimeNs: bigint;
  /** 마지막 상태 변경 시각(나노초)입니다. */
  ctimeNs: bigint;
  /** 파일 모드입니다. */
  mode: bigint;
}

/** 후보 파일 하나의 `lstat` 결과입니다. */
export interface CandidateStat {
  /** 같은 파일인지 판정할 파일 상태 식별값입니다. */
  fingerprint: FileFingerprint;
  /** 목록의 `updatedAt`에 사용할 수정 시각입니다. */
  mtime: Date;
  /** 경로 자체가 심볼릭 링크인지 나타냅니다. */
  isSymbolicLink: boolean;
  /** 일반 파일인지 나타냅니다. `lstat`은 링크를 따라가지 않으므로 링크는 일반 파일로 판단하지 않습니다. */
  isFile: boolean;
}

/**
 * 두 파일 상태 식별값이 같은 파일을 가리키는지 비교합니다.
 *
 * @param a - 비교할 식별값입니다.
 * @param b - 비교할 식별값입니다.
 * @returns 모든 항목이 같으면 `true`를 반환합니다.
 */
function sameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.mode === b.mode
  );
}

/**
 * 항목마다 비동기 작업을 실행하되 동시에 진행하는 개수를 제한합니다.
 *
 * @param items - 처리할 항목입니다.
 * @param limit - 동시에 진행할 최대 개수입니다. 1 이상이어야 합니다.
 * @param worker - 항목 하나를 처리하는 함수입니다.
 * @returns 입력과 같은 순서의 결과 배열을 반환합니다.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 최대 동시 실행 수를 지키면서 후보 파일의 상태 식별값을 구합니다.
 *
 * @param paths - 정렬된 후보 파일의 절대 경로입니다.
 * @param metrics - 호출 횟수와 최대 동시 실행 수를 기록할 측정 객체입니다.
 * @returns 입력과 같은 순서의 `lstat` 결과를 반환합니다. 조회에 실패한 항목은 `null`입니다.
 */
export async function statCandidates(
  paths: readonly string[],
  metrics: ListMetrics,
): Promise<(CandidateStat | null)[]> {
  let active = 0;
  return mapWithLimit(paths, MAX_LSTAT_CONCURRENCY, async (abs) => {
    active += 1;
    if (active > metrics.maxConcurrentLstat) metrics.maxConcurrentLstat = active;
    metrics.lstat += 1;
    try {
      const info = await lstat(abs, { bigint: true });
      return {
        fingerprint: {
          dev: info.dev,
          ino: info.ino,
          size: info.size,
          mtimeNs: info.mtimeNs,
          ctimeNs: info.ctimeNs,
          mode: info.mode,
        },
        mtime: info.mtime,
        isSymbolicLink: info.isSymbolicLink(),
        isFile: info.isFile(),
      };
    } catch {
      return null;
    } finally {
      active -= 1;
    }
  });
}

/** 파일 하나를 해석한 결과로, 목록에 넣을 항목이나 제외 표시를 담습니다. */
export type ListCacheResult = { readonly item: SlipListItem } | { readonly excluded: true };

/** 캐시에 저장하는 경로 하나의 분석 결과입니다. */
interface ListCacheEntry {
  fingerprint: FileFingerprint;
  result: ListCacheResult;
}

/** 같은 파일 상태 식별값을 동시에 분석할 때 공유하는 작업입니다. */
interface PendingResolve {
  /** 진행 중인 작업을 구분하는 값입니다. */
  token: object;
  fingerprint: FileFingerprint;
  promise: Promise<ListCacheResult>;
}

/**
 * 경로별 목록 메타데이터 캐시입니다. 파일 상태 식별값이 같으면 본문을 다시 읽지 않고,
 * 같은 파일 상태 식별값을 동시에 요청하면 진행 중인 분석 작업을 공유합니다.
 */
export class ListMetadataCache {
  /** 이 캐시의 동작을 기록하는 측정 객체입니다. */
  readonly metrics: ListMetrics;
  private readonly entries = new Map<string, ListCacheEntry>();
  private readonly pending = new Map<string, PendingResolve>();

  constructor() {
    this.metrics = createListMetrics(() => this.entries.size);
  }

  /**
   * 식별값이 같은 캐시 결과를 찾습니다. 찾으면 재사용 카운터를 올립니다.
   *
   * @param name - 기준 디렉터리를 기준으로 한 상대 경로입니다.
   * @param fingerprint - 현재 파일의 상태 식별값입니다.
   * @returns 재사용할 결과를 반환합니다. 캐시에 없거나 식별값이 다르면 `undefined`입니다.
   */
  lookup(name: string, fingerprint: FileFingerprint): ListCacheResult | undefined {
    const entry = this.entries.get(name);
    if (entry === undefined || !sameFingerprint(entry.fingerprint, fingerprint)) return undefined;
    if ('item' in entry.result) this.metrics.cacheHits += 1;
    else this.metrics.excludedHits += 1;
    return entry.result;
  }

  /**
   * 캐시에 없는 파일을 분석합니다. 같은 경로와 파일 상태 식별값을 분석 중이면 그 결과를 함께 기다립니다.
   *
   * @param name - 기준 디렉터리를 기준으로 한 상대 경로입니다.
   * @param fingerprint - 현재 파일의 상태 식별값입니다.
   * @param resolver - 파일을 읽고 분석 결과를 만드는 함수입니다.
   * @returns 분석 결과를 반환합니다.
   */
  async resolve(
    name: string,
    fingerprint: FileFingerprint,
    resolver: () => Promise<ListCacheResult>,
  ): Promise<ListCacheResult> {
    const running = this.pending.get(name);
    if (running !== undefined && sameFingerprint(running.fingerprint, fingerprint)) {
      return running.promise;
    }
    this.metrics.cacheMisses += 1;
    const token = {};
    const promise = (async () => {
      try {
        const result = await resolver();
        // 분석하는 동안 파일이 다시 바뀌었거나 캐시가 무효화됐으면 결과를 저장하지 않습니다.
        if (this.pending.get(name)?.token === token) this.entries.set(name, { fingerprint, result });
        return result;
      } finally {
        if (this.pending.get(name)?.token === token) this.pending.delete(name);
      }
    })();
    this.pending.set(name, { token, fingerprint, promise });
    return promise;
  }

  /**
   * 이번 탐색에서 보이지 않은 경로를 캐시에서 지웁니다.
   *
   * @param names - 이번 탐색이 찾은 상대 경로 전체
   */
  retain(names: ReadonlySet<string>): void {
    for (const name of this.entries.keys()) {
      if (!names.has(name)) this.entries.delete(name);
    }
  }

  /**
   * 한 경로의 캐시를 지웁니다. 진행 중인 해석 결과도 캐시에 남기지 않습니다.
   *
   * @param name - 기준 디렉터리 기준 상대 경로
   */
  invalidate(name: string): void {
    this.entries.delete(name);
    this.pending.delete(name);
  }
}
