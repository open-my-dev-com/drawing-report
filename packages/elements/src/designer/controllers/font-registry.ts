/**
 * 폰트 데이터의 브라우저 등록과 재사용.
 *
 * @remarks
 * 캔버스는 shadow DOM 안에 있어 컴포넌트 스타일의 `@font-face`가 닿지 않으므로 `FontFace`로
 * 문서에 등록합니다. 호스트 문서의 폰트와 이름이 겹치지 않도록 CSS에서 쓰는 이름은 따로 만들고
 * 파일에 저장하는 `fontName`은 그대로 둡니다. 같은 이름이라도 폰트를 제공한 출처가 다르면
 * 데이터가 다를 수 있으므로 출처별로 나누어 등록합니다.
 *
 * 등록은 필요한 폰트부터 합니다. 등록이 끝나기 전에는 대체 폰트로 표시하고, 끝나면 다시 그립니다.
 */

import type { ReactiveController } from 'lit';
import type { SlipFont } from '@omdc-slipkit/core';
import { fallbackFontNameOf } from '../font-variant.js';

/** 브라우저에 폰트를 등록하는 수단. 시험에서는 대역으로 바꿉니다. */
export interface FontFaceAdapter {
  /**
   * 폰트 데이터를 문서에 등록합니다.
   *
   * @param family - 등록할 CSS 이름
   * @param data - 폰트 파일 바이트
   * @returns 등록이 끝나면 완료되는 Promise
   * @throws 폰트 데이터를 읽을 수 없으면 거부합니다.
   */
  register(family: string, data: Uint8Array): Promise<void>;
}

/** 문서의 폰트 집합 가운데 등록에 사용하는 부분 */
interface DocumentFontSet {
  add(face: FontFace): void;
}

/**
 * 문서의 폰트 집합을 찾습니다.
 *
 * @returns 폰트 집합. 지원하지 않는 환경이면 undefined
 */
function documentFontSet(): DocumentFontSet | undefined {
  // 이 저장소의 TypeScript lib 설정에는 DOM.Iterable이 없어 FontFaceSet.add가 선언되어 있지 않습니다.
  const fonts: unknown = (document as Partial<Document>).fonts;
  if (fonts === undefined || fonts === null) return undefined;
  const candidate = fonts as DocumentFontSet;
  return typeof candidate.add === 'function' ? candidate : undefined;
}

/**
 * 폰트 바이트를 `FontFace`에 넘길 수 있는 버퍼로 만듭니다.
 *
 * @param data - 폰트 파일 바이트
 * @returns 폰트 데이터만 담은 `ArrayBuffer`
 */
function fontBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = data.buffer as ArrayBuffer;
  // 다른 데이터와 버퍼를 공유하는 경우에만 해당 구간을 복사합니다.
  if (data.byteOffset === 0 && data.byteLength === buffer.byteLength) return buffer;
  return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/**
 * 브라우저의 `FontFace`를 사용하는 등록 수단을 만듭니다.
 *
 * @returns 등록 수단. `FontFace`를 지원하지 않는 환경이면 null
 */
export function browserFontFaceAdapter(): FontFaceAdapter | null {
  if (typeof FontFace !== 'function' || typeof document === 'undefined') return null;
  const documentFonts = documentFontSet();
  if (documentFonts === undefined) return null;
  return {
    async register(family: string, data: Uint8Array): Promise<void> {
      const face = new FontFace(family, fontBuffer(data));
      // 읽지 못한 폰트를 문서에 남기지 않도록 읽기가 끝난 뒤에 추가합니다.
      await face.load();
      documentFonts.add(face);
    },
  };
}

/** 폰트 하나의 등록 상태 */
interface FaceEntry {
  /** 캔버스 CSS에서 사용할 이름 */
  readonly family: string;
  status: 'pending' | 'ready' | 'failed';
}

/** 폰트를 제공한 출처 하나의 상태 */
interface FontSource {
  /** 이 출처의 CSS 이름에 붙이는 일련번호 */
  readonly serial: number;
  /** 폰트 목록을 가져오는 작업. 출처마다 한 번만 실행합니다 */
  loading: Promise<readonly SlipFont[]> | null;
  /** 가져온 폰트 목록 */
  fonts: readonly SlipFont[];
  /** 목록 조회에 실패했는지. 실패는 다시 시도하지 않고 이 상태로 남깁니다 */
  loadFailed: boolean;
  /** 폰트 이름별 등록 상태 */
  readonly faces: Map<string, FaceEntry>;
  /** 이 출처를 쓰는 화면들. 목록 조회와 등록이 끝나면 모두 다시 그립니다 */
  readonly hosts: Set<FontRegistryHost>;
}

const sources = new WeakMap<object, FontSource>();
let nextSerial = 0;

/** `slipkit`이 없을 때 로케일별로 동봉 폰트를 구분하는 키 */
const defaultSourceKeys = new Map<string, object>();

/**
 * 동봉 폰트를 쓸 때의 출처 키를 만듭니다.
 *
 * @remarks
 * 동봉 폰트는 인스턴스가 달라도 폰트가 같고 로케일에 따라 대체 폰트만 달라지므로 로케일로만
 * 나눕니다. 호스트가 실제로 폰트를 공급하는 경우에는 인스턴스 자체를 출처로 씁니다 — 같은
 * 이름에 다른 데이터를 줄 수 있기 때문입니다.
 *
 * @param locale - 동봉 폰트를 고를 렌더 로케일
 * @returns 출처를 구분하는 키
 */
export function bundledFontSourceKey(locale: string | undefined): object {
  const key = locale ?? '';
  let sentinel = defaultSourceKeys.get(key);
  if (!sentinel) {
    sentinel = { locale: key };
    defaultSourceKeys.set(key, sentinel);
  }
  return sentinel;
}

function sourceOf(key: object): FontSource {
  let source = sources.get(key);
  if (!source) {
    source = {
      serial: nextSerial++,
      loading: null,
      fonts: [],
      loadFailed: false,
      faces: new Map(),
      hosts: new Set(),
    };
    sources.set(key, source);
  }
  return source;
}

/** 이 출처를 쓰는 화면을 모두 다시 그립니다. */
function refreshHosts(source: FontSource): void {
  for (const host of source.hosts) host.requestUpdate();
}

/** 폰트 등록 결과를 화면에 반영할 호스트 */
export interface FontRegistryHost {
  requestUpdate(): void;
}

/**
 * 디자이너가 사용하는 폰트 목록과 브라우저 등록 상태를 관리합니다.
 */
export class FontRegistryController implements ReactiveController {
  private _key: object | null = null;

  constructor(
    private readonly host: FontRegistryHost,
    private readonly adapter: FontFaceAdapter | null = browserFontFaceAdapter(),
  ) {}

  hostConnected(): void {
    // 다시 연결한 화면도 지금 출처의 완료 통지를 받아야 합니다.
    if (this._key !== null) sources.get(this._key)?.hosts.add(this.host);
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    // 화면에서 떨어진 디자이너는 더 이상 다시 그리지 않습니다.
    if (this._key !== null) sources.get(this._key)?.hosts.delete(this.host);
  }

  /**
   * 폰트를 가져올 출처를 지정합니다. 같은 출처를 다시 지정해도 폰트를 다시 가져오지 않습니다.
   * 조회에 실패한 출처도 다시 시도하지 않고 빈 목록으로 둡니다.
   *
   * @param key - {@link fontSourceKey}가 만든 출처 키
   * @param load - 폰트 목록을 가져오는 함수. 출처마다 한 번만 호출합니다
   */
  use(key: object, load: () => Promise<readonly SlipFont[]>): void {
    if (this._key !== null && this._key !== key) {
      sources.get(this._key)?.hosts.delete(this.host);
    }
    this._key = key;
    const source = sourceOf(key);
    source.hosts.add(this.host);
    // 실패한 출처는 호출부가 다시 쓰려 할 때 새로 시도합니다.
    if (source.loading !== null && !source.loadFailed) {
      // 이미 가져온 출처로 바꾸면 새 목록을 반영하도록 이 화면을 다시 그립니다.
      this.host.requestUpdate();
      return;
    }
    source.loadFailed = false;
    source.loading = load().then((fonts) => {
      source.fonts = fonts;
      refreshHosts(source);
      return fonts;
    });
    // 조회에 실패하면 폰트 목록은 빈 상태로 유지하고, Promise 거부가 전역 오류로
    // 전달되지 않도록 처리합니다. 실패도 상태로 남겨 같은 출처의 화면이 모두 같은 결과를 봅니다.
    source.loading.catch(() => {
      source.loadFailed = true;
      refreshHosts(source);
    });
  }

  /** 현재 출처에서 가져온 폰트 이름 목록 */
  get fontNames(): readonly string[] {
    return this._source?.fonts.map((font) => font.name) ?? [];
  }

  /** 현재 출처의 폰트 목록 조회가 실패했는지 */
  get loadFailed(): boolean {
    return this._source?.loadFailed ?? false;
  }

  /** 현재 출처의 대체 폰트 이름 */
  get fallbackName(): string | undefined {
    const source = this._source;
    return source ? fallbackFontNameOf(source.fonts) : undefined;
  }

  /**
   * 지정한 폰트를 브라우저에 등록합니다. 이미 등록했거나 등록 중인 폰트는 건너뜁니다.
   *
   * @param names - 등록할 폰트 이름. undefined는 무시합니다
   */
  ensure(names: Iterable<string | undefined>): void {
    const source = this._source;
    if (!source || this.adapter === null) return;
    for (const name of names) {
      if (name === undefined || source.faces.has(name)) continue;
      const index = source.fonts.findIndex((font) => font.name === name);
      if (index < 0) continue;
      const entry: FaceEntry = { family: `slipkit-f${source.serial}-${index}`, status: 'pending' };
      source.faces.set(name, entry);
      this._register(this.adapter, source, entry, source.fonts[index]!.data);
    }
  }

  /**
   * 캔버스 CSS에서 사용할 폰트 이름을 반환합니다.
   *
   * @param name - 요소·셀에 적용할 등록된 폰트 이름
   * @returns CSS `font-family` 값. 등록이 끝나지 않았거나 실패했으면 undefined
   */
  familyOf(name: string | undefined): string | undefined {
    if (name === undefined) return undefined;
    const entry = this._source?.faces.get(name);
    return entry?.status === 'ready' ? entry.family : undefined;
  }

  /**
   * 캔버스에 쓸 수 있게 등록이 끝난 폰트인지 확인합니다.
   *
   * @param name - 확인할 폰트 이름
   * @returns 등록이 끝났으면 true
   */
  isReady(name: string | undefined): boolean {
    if (name === undefined) return false;
    return this._source?.faces.get(name)?.status === 'ready';
  }

  /**
   * 브라우저 등록에 실패한 폰트인지 확인합니다.
   *
   * @param name - 확인할 폰트 이름
   * @returns 등록을 시도했고 실패했으면 true
   */
  failed(name: string | undefined): boolean {
    if (name === undefined) return false;
    return this._source?.faces.get(name)?.status === 'failed';
  }

  private get _source(): FontSource | undefined {
    return this._key === null ? undefined : sources.get(this._key);
  }

  private _register(
    adapter: FontFaceAdapter,
    source: FontSource,
    entry: FaceEntry,
    data: Uint8Array,
  ): void {
    void adapter.register(entry.family, data).then(
      () => {
        entry.status = 'ready';
        refreshHosts(source);
      },
      () => {
        entry.status = 'failed';
        refreshHosts(source);
      },
    );
  }
}
