/**
 * 목록 조회가 쓰는 파일 메타데이터 캐시와 계측 도우미.
 *
 * 캐시는 저장소 인스턴스의 메모리에만 두고 작업 디렉터리에는 아무 것도 남기지 않는다.
 * 같은 파일인지는 `lstat` 결과로 만든 지문으로만 판정하며, 파일 본문·복호화 평문·키는
 * 보관하지 않는다.
 */
import { lstat } from 'node:fs/promises';
import type { SlipListItem } from '@omdc-slipkit/core';

/** 목록 계측 값을 인스턴스에서 꺼낼 때 쓰는 전역 심볼. 진단·계측 전용이며 공개 API가 아니다. */
export const LIST_METRICS = Symbol.for('@omdc-slipkit/mcp.listMetrics');

/** `lstat`을 동시에 실행하는 최대 개수 */
export const MAX_LSTAT_CONCURRENCY = 32;

/** 목록 조회 계측 값 */
export interface ListMetrics {
  /** `list()` 호출 수 */
  listCalls: number;
  /** `readdir`가 돌려준 항목 수 (디렉터리 포함) */
  directoryEntries: number;
  /** `.slip` 후보 파일 수 */
  candidates: number;
  /** 후보 지문을 만들려고 부른 `lstat` 호출 수 (경로 검사에 쓰는 호출은 세지 않는다) */
  lstat: number;
  /** 동시에 진행한 `lstat` 최대 개수 */
  maxConcurrentLstat: number;
  /** 파일 본문 읽기 횟수 */
  bodyReads: number;
  /** 읽은 본문 바이트 합 */
  bodyBytes: number;
  /** 파싱 횟수 (복호화 뒤 파싱 포함) */
  parses: number;
  /** 복호화 시도 수 (키마다 1) */
  decryptAttempts: number;
  /** 지문이 같아 재사용한 유효 항목 수 */
  cacheHits: number;
  /** 새로 해석을 시작한 항목 수 */
  cacheMisses: number;
  /** 지문이 같아 재사용한 제외 결과 수 */
  excludedHits: number;
  /** 현재 캐시에 남아 있는 항목 수 */
  readonly cachedEntries: number;
  /** 모든 카운터를 0으로 되돌린다. 캐시 내용은 그대로 둔다 */
  reset(): void;
}

/** `reset()`이 0으로 되돌리는 카운터 이름 */
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
 * 계측 카운터 객체를 만든다. `cachedEntries`는 읽을 때마다 캐시 크기를 물어보는 속성이다.
 *
 * @param cachedEntries - 현재 캐시 항목 수를 돌려주는 함수
 * @returns 카운터가 모두 0인 계측 객체
 */
export function createListMetrics(cachedEntries: () => number): ListMetrics {
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

/** 같은 파일인지 판정하는 지문 */
export interface FileFingerprint {
  /** 장치 번호 */
  dev: bigint;
  /** inode 번호 */
  ino: bigint;
  /** 파일 크기 */
  size: bigint;
  /** 마지막 수정 시각 (나노초) */
  mtimeNs: bigint;
  /** 마지막 상태 변경 시각 (나노초) */
  ctimeNs: bigint;
  /** 파일 모드 */
  mode: bigint;
}

/** 후보 파일 하나의 `lstat` 결과 */
export interface CandidateStat {
  /** 같은 파일인지 판정할 지문 */
  fingerprint: FileFingerprint;
  /** 목록의 `updatedAt`에 쓸 수정 시각 */
  mtime: Date;
  /** 경로 자체가 심볼릭 링크인지 */
  isSymbolicLink: boolean;
  /** 일반 파일인지 (`lstat`은 링크를 따라가지 않으므로 링크는 일반 파일이 아니다) */
  isFile: boolean;
}

/**
 * 두 지문이 같은 파일을 가리키는지 비교한다.
 *
 * @param a - 비교할 지문
 * @param b - 비교할 지문
 * @returns 모든 항목이 같으면 true
 */
export function sameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
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
 * 항목마다 비동기 작업을 실행하되 동시에 진행하는 개수를 제한한다.
 *
 * @param items - 처리할 항목
 * @param limit - 동시에 진행할 최대 개수 (1 이상)
 * @param worker - 항목 하나를 처리하는 함수
 * @returns 입력과 같은 순서의 결과 배열
 */
export async function mapWithLimit<T, R>(
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
 * 후보 파일의 지문을 동시 실행 상한을 지켜 구한다.
 *
 * @param paths - 후보 파일의 절대 경로 (정렬 순서 그대로)
 * @param metrics - 호출 수와 최대 동시 개수를 올릴 계측 객체
 * @returns 입력과 같은 순서의 `lstat` 결과. 조회에 실패한 자리는 null
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

/** 파일 하나를 해석한 결과. 목록에 넣을 항목이거나 제외 표시다 */
export type ListCacheResult = { readonly item: SlipListItem } | { readonly excluded: true };

/** 캐시에 담는 한 경로의 해석 결과 */
interface ListCacheEntry {
  fingerprint: FileFingerprint;
  result: ListCacheResult;
}

/** 같은 지문을 동시에 해석할 때 공유하는 진행 중 작업 */
interface PendingResolve {
  /** 진행 중인 작업을 구분하는 표식 */
  token: object;
  fingerprint: FileFingerprint;
  promise: Promise<ListCacheResult>;
}

/**
 * 경로별 목록 메타데이터 캐시. 지문이 같으면 본문을 다시 읽지 않고,
 * 같은 지문을 동시에 요청하면 진행 중인 해석을 나눠 쓴다.
 */
export class ListMetadataCache {
  /** 이 캐시와 짝을 이루는 계측 객체 */
  readonly metrics: ListMetrics;
  private readonly entries = new Map<string, ListCacheEntry>();
  private readonly pending = new Map<string, PendingResolve>();

  constructor() {
    this.metrics = createListMetrics(() => this.entries.size);
  }

  /**
   * 지문이 같은 캐시 결과를 찾는다. 찾으면 재사용 카운터를 올린다.
   *
   * @param name - 기준 디렉터리 기준 상대 경로
   * @param fingerprint - 이번에 구한 지문
   * @returns 재사용할 결과. 캐시에 없거나 지문이 다르면 undefined
   */
  lookup(name: string, fingerprint: FileFingerprint): ListCacheResult | undefined {
    const entry = this.entries.get(name);
    if (entry === undefined || !sameFingerprint(entry.fingerprint, fingerprint)) return undefined;
    if ('item' in entry.result) this.metrics.cacheHits += 1;
    else this.metrics.excludedHits += 1;
    return entry.result;
  }

  /**
   * 캐시에 없는 파일을 해석한다. 같은 경로·같은 지문의 해석이 진행 중이면 그 결과를 함께 기다린다.
   *
   * @param name - 기준 디렉터리 기준 상대 경로
   * @param fingerprint - 이번에 구한 지문
   * @param resolver - 파일을 실제로 읽어 결과를 만드는 함수
   * @returns 해석 결과
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
        // 해석하는 동안 파일이 다시 바뀌었거나 캐시가 무효화됐으면 결과를 남기지 않는다.
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
   * 이번 탐색에서 보이지 않은 경로를 캐시에서 지운다.
   *
   * @param names - 이번 탐색이 찾은 상대 경로 전체
   */
  retain(names: ReadonlySet<string>): void {
    for (const name of this.entries.keys()) {
      if (!names.has(name)) this.entries.delete(name);
    }
  }

  /**
   * 한 경로의 캐시를 지운다. 진행 중인 해석 결과도 캐시에 남기지 않는다.
   *
   * @param name - 기준 디렉터리 기준 상대 경로
   */
  invalidate(name: string): void {
    this.entries.delete(name);
    this.pending.delete(name);
  }
}
