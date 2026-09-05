/**
 * AI에 전달할 `.slip` 파일의 구조 요약을 만든다.
 * 긴 data URL은 응답에 싣지 않고 형식과 대략적인 크기만 남긴다.
 */
import { elementBounds, type SlipElement, type SlipFile, type SlipTemplateBody } from '@omdc-slipkit/core';

/** 양식 본문을 얻는다. 전표면 내장된 양식 스냅샷을 반환한다. */
export function bodyOf(file: SlipFile): SlipTemplateBody {
  return file.kind === 'template' ? file.template : file.templateSnapshot;
}

/** 그대로 반환할 수 있는 data URL의 최대 문자열 길이. */
const DATA_URL_KEEP_LENGTH = 64;

/**
 * 값 안의 긴 data URL을 `[data 12KB image/png]` 형태로 치환한 사본을 만든다.
 *
 * @param value - 치환할 값 (객체·배열은 재귀적으로 처리)
 * @returns 치환된 깊은 사본
 */
export function elideDataUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.length > DATA_URL_KEEP_LENGTH) {
      const mime = value.slice(5, value.indexOf(';') > 0 ? value.indexOf(';') : 5 + 40);
      const kb = Math.max(1, Math.round(value.length / 1024));
      return `[data ${kb}KB ${mime}]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(elideDataUrls);
  if (typeof value === 'object' && value !== null) {
    // `__proto__` 같은 키도 업무 데이터이므로 대입 대신 자신의 속성으로 만든다.
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, elideDataUrls(entry)]));
  }
  return value;
}

/** 요소 한 개의 목록용 요약 */
interface ElementBrief {
  id: string;
  type: SlipElement['type'];
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 값을 가져오는 곳이나 요소 구조(예: `parameter: total`, `grid 3x2 repeat`). */
  note?: string;
}

/** 요소의 값 참조나 구조를 한 줄로 요약한다. */
function briefNote(element: SlipElement): string | undefined {
  if (element.type === 'grid') {
    const size = `grid ${element.rows.length}x${element.columns.length}`;
    return element.repeat ? `${size} repeat ${element.repeat.pagination.mode}` : size;
  }
  if ('parameter' in element && element.parameter !== undefined) {
    return `parameter: ${element.parameter}`;
  }
  if ('formula' in element && element.formula !== undefined) {
    return `formula: ${element.formula}`;
  }
  if (element.type === 'image') {
    return element.src?.startsWith('asset://') ? element.src : 'inline image';
  }
  return undefined;
}

/**
 * 파일 전체의 요약을 만든다. 페이지별 요소 id·종류·위치, 파라미터·에셋 목록까지만 담고
 * 스타일 상세와 이미지 데이터는 담지 않는다.
 *
 * @param file - 요약할 `.slip` 파일
 * @returns 구조 요약 객체
 */
export function summarize(file: SlipFile): Record<string, unknown> {
  const body = bodyOf(file);
  const pages = body.pages.map((page, index) => ({
    index,
    ...(page.key === undefined ? {} : { key: page.key }),
    ...(page.label === undefined ? {} : { label: page.label }),
    elements: page.elements.map((element): ElementBrief => {
      const note = briefNote(element);
      return {
        id: element.id,
        type: element.type,
        name: element.name,
        x: element.position.x,
        y: element.position.y,
        // 그리드는 크기를 저장하지 않으므로 행·열 합에서 계산한다.
        width: elementBounds(element).width,
        height: elementBounds(element).height,
        ...(note === undefined ? {} : { note }),
      };
    }),
  }));

  return {
    kind: file.kind,
    schemaVersion: file.schemaVersion,
    title: body.meta.title,
    paper: body.paper,
    pages,
    parameters: (body.parameters ?? []).map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      valueType: parameter.valueType,
      ...('fields' in parameter && parameter.fields
        ? {
            fields: parameter.fields.map((field) => ({
              key: field.key,
              label: field.label,
              valueType: field.valueType,
            })),
          }
        : {}),
    })),
    assets: body.assets.map((asset) => ({
      id: asset.id,
      mimeType: asset.mimeType,
      sizeKB: Math.max(1, Math.round(asset.src.length / 1024)),
    })),
    ...(file.kind === 'voucher'
      ? { issued: file.issued, valueKeys: Object.keys(file.values) }
      : {}),
  };
}

/**
 * id로 요소를 찾는다.
 *
 * @param file - 대상 파일
 * @param elementId - 찾을 요소 id
 * @returns 요소와 페이지 번호, 없으면 null
 */
export function findElement(
  file: SlipFile,
  elementId: string,
): { element: SlipElement; pageIndex: number; elementIndex: number } | null {
  const body = bodyOf(file);
  for (const [pageIndex, page] of body.pages.entries()) {
    const elementIndex = page.elements.findIndex((element) => element.id === elementId);
    if (elementIndex >= 0) {
      return { element: page.elements[elementIndex]!, pageIndex, elementIndex };
    }
  }
  return null;
}

/** 파일에 있는 모든 요소 id를 나열한다 (오류 안내용). */
export function allElementIds(file: SlipFile): string[] {
  return bodyOf(file).pages.flatMap((page) => page.elements.map((element) => element.id));
}
