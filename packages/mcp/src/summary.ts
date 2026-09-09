/**
 * AI에 전달할 `.slip` 파일의 구조 요약을 만듭니다.
 * 내장 Base64 데이터 URL은 길이와 상관없이 응답에 싣지 않고 형식과 대략적인 크기만 남깁니다.
 */
import { elementBounds, type SlipElement, type SlipFile, type SlipTemplateBody } from '@omdc-slipkit/core';

/** 양식 본문을 얻습니다. 전표면 내장된 양식 스냅샷을 반환합니다. */
export function bodyOf(file: SlipFile): SlipTemplateBody {
  return file.kind === 'template' ? file.template : file.templateSnapshot;
}

/**
 * 내장 Base64 데이터 URL은 `data:<종류>/<하위종류>[;<이름>=<값>...];base64,` 형식으로 시작합니다.
 *
 * @remarks
 * `;base64,`까지 갖춘 값만 내장 데이터로 판단합니다. 데이터 자체의 유효성은 조건으로 삼지 않습니다.
 * 손상된 데이터도 요약 응답에서는 제외합니다. 이미지를 실제로 사용할 수 있는지는 렌더링 단계의
 * 이미지 검사에서 판정합니다.
 */
const EMBEDDED_DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w.+-]+=[^;,]*)*;base64,[\s\S]*$/;

/**
 * 값 안의 내장 Base64 데이터 URL을 `[data 12KB image/png]` 형태로 바꾼 사본을 만듭니다.
 *
 * @remarks
 * `data:`로 시작한다는 이유만으로 바꾸지 않습니다. `data:2026-09-08 매출 마감`처럼 우연히 같은 접두어를
 * 가진 일반 데이터 문자열과 `data:text/plain,hello`처럼 데이터를 그대로 담은 값은 원문을 유지합니다.
 * `;base64,`로 내장 데이터임을 확인할 수 있는 값만 길이와 관계없이 바꿉니다.
 * `__proto__`·`constructor` 같은 키도 일반 데이터이므로 그대로 보존합니다.
 *
 * @param value - Base64 데이터를 크기 표시로 바꿀 값입니다. 객체와 배열은 안쪽 값까지 처리합니다.
 * @returns Base64 데이터를 크기 표시로 바꾼 깊은 사본
 */
export function elideDataUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = EMBEDDED_DATA_URL.exec(value);
    if (match === null) return value;
    const kb = Math.max(1, Math.round(value.length / 1024));
    return `[data ${kb}KB ${match[1]}]`;
  }
  if (Array.isArray(value)) return value.map(elideDataUrls);
  if (typeof value === 'object' && value !== null) {
    // `__proto__` 같은 키도 일반 데이터이므로 대입하지 않고 객체 자체의 속성으로 만듭니다.
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, elideDataUrls(entry)]));
  }
  return value;
}

/** 요소 한 개를 목록에 표시할 때 사용하는 요약입니다. */
interface ElementBrief {
  id: string;
  type: SlipElement['type'];
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 값의 출처나 요소 구조를 설명합니다. 예: `parameter: total`, `grid 3x2 repeat` */
  note?: string;
}

/** 요소의 값 참조나 구조를 한 줄로 요약합니다. */
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
 * 파일 전체의 요약을 만듭니다. 페이지별 요소 ID·종류·위치, 파라미터·에셋 목록까지만 담고
 * 스타일 상세와 이미지 데이터는 담지 않습니다.
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
        // 그리드는 크기를 저장하지 않으므로 행·열 합에서 계산합니다.
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
 * ID로 요소를 찾습니다.
 *
 * @param file - 대상 파일
 * @param elementId - 찾을 요소 ID
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

/** 오류 안내에 사용할 수 있도록 파일의 모든 요소 ID를 반환합니다. */
export function allElementIds(file: SlipFile): string[] {
  return bodyOf(file).pages.flatMap((page) => page.elements.map((element) => element.id));
}
