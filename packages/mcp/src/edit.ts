/**
 * `.slip` 파일의 일부를 식별자로 수정하는 `slip_edit` 연산.
 * 요소는 id, 파라미터는 key로 찾아 배열 순서가 바뀌어도 같은 대상을 수정한다.
 * 연산을 모두 적용한 뒤 파일 전체를 core로 검증하고, 실패하면 아무것도 저장하지 않는다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  MAX_IMAGE_BYTES,
  inspectImageBytes,
  inspectImageDataUrl,
  type ImageInspection,
  type ImageMimeType,
  type SlipFile,
  type SlipTemplateBody,
} from '@omdc-slipkit/core';
import { allElementIds, bodyOf, findElement } from './summary.js';

export { MAX_IMAGE_BYTES };

/** AI가 입력을 고쳐 다시 호출할 수 있는 도구 오류. */
export class McpToolError extends Error {}

/** `set_image`가 받는 파일 확장자와 그 확장자가 뜻하는 이미지 형식. 실제 내용은 서명으로 다시 확인한다. */
const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** 사람이 읽는 이미지 형식 안내 */
const SUPPORTED_IMAGES = `PNG or JPEG, up to ${MAX_IMAGE_BYTES / 1024}KB (${MAX_IMAGE_BYTES / 1024 / 1024} MiB)`;

/** 이미지 검사 실패를 AI가 고칠 수 있는 한 줄 설명으로 만든다. */
function imageProblem(inspection: Extract<ImageInspection, { ok: false }>, subject: string): string {
  switch (inspection.reason) {
    case 'format':
      return `${subject} must be a data:<mime>;base64 URL (${SUPPORTED_IMAGES}).`;
    case 'mime':
      return `${subject} declares "${inspection.mimeType ?? ''}"; supported: ${SUPPORTED_IMAGES}.`;
    case 'content':
      return (
        `${subject} content is not ${inspection.mimeType === undefined ? 'a PNG or JPEG image' : inspection.mimeType} ` +
        `(checked by the file signature, not the extension). Supported: ${SUPPORTED_IMAGES}.`
      );
    case 'size':
      return `${subject} is ${Math.round(inspection.bytes / 1024)}KB; the limit is ${MAX_IMAGE_BYTES / 1024}KB.`;
  }
}

/**
 * `data:` 이미지 문자열이 PNG·JPEG이고 크기 상한 안인지 확인한다.
 *
 * @param src - 검사할 `data:` 문자열
 * @param subject - 오류 메시지에 쓸 대상 이름 (예: `Image element "logo" src`)
 * @throws McpToolError 형식·종류·내용·크기가 맞지 않을 때
 */
export function assertImageDataUrl(src: string, subject: string): void {
  const inspection = inspectImageDataUrl(src);
  if (!inspection.ok) throw new McpToolError(imageProblem(inspection, subject));
}

/**
 * 파일 전체에 들어 있는 `data:` 이미지(에셋, 고정 이미지 요소, 전표 값)를 검사한다.
 * `slip_save`처럼 파일을 통째로 받는 경로가 `set_image`의 크기·형식 검사를 우회하지 못하게 한다.
 *
 * @param file - 검사할 파일 (구조 검증은 끝난 상태)
 * @throws McpToolError PNG·JPEG가 아니거나 크기 상한을 넘는 이미지가 있을 때
 */
export function assertFileImages(file: SlipFile): void {
  const body = bodyOf(file);
  for (const asset of body.assets) {
    if (asset.src.startsWith('data:')) assertImageDataUrl(asset.src, `Asset "${asset.id}" src`);
  }
  for (const page of body.pages) {
    for (const element of page.elements) {
      if (element.type === 'image' && element.src?.startsWith('data:') === true) {
        assertImageDataUrl(element.src, `Image element "${element.id}" src`);
      }
    }
  }
  if (file.kind === 'voucher') assertImageValues(file.values as Record<string, unknown>);
}

/**
 * 전표 값 중 `data:` 문자열을 이미지로 보고 검사한다.
 *
 * @param values - 파라미터 key별 값
 * @throws McpToolError PNG·JPEG가 아니거나 크기 상한을 넘는 값이 있을 때
 */
export function assertImageValues(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.startsWith('data:')) {
      assertImageDataUrl(value, `Value "${key}"`);
    }
  }
}

/** 요소가 `data:` 고정 이미지를 가지면 검사한다. */
function assertElementImage(element: { type?: unknown; id?: unknown; src?: unknown }): void {
  if (element.type === 'image' && typeof element.src === 'string' && element.src.startsWith('data:')) {
    assertImageDataUrl(element.src, `Image element "${String(element.id ?? '')}" src`);
  }
}

const fieldsSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Fields to merge; omit fields that should remain unchanged. Set a field to null to REMOVE it — ' +
      'e.g. {"parameter": null, "formula": "..."} switches the value source of a cell or field',
  );
const elementSchema = z
  .record(z.string(), z.unknown())
  .describe('Complete element object; use slip_schema for fields by element type');
const parameterSchema = z
  .record(z.string(), z.unknown())
  .describe('Complete parameter definition; use slip_schema topic "parameters"');
const valuesSchema = z
  .record(z.string(), z.unknown())
  .describe('Voucher values keyed by the template parameter keys');

/** `slip_edit` 연산 입력 스키마 (`action`으로 구분) */
export const editOpSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('set_meta'), fields: fieldsSchema })
    .describe('Merge fields into the template metadata'),
  z
    .object({ action: z.literal('set_paper'), fields: fieldsSchema })
    .describe('Merge fields into the paper settings'),
  z
    .object({
      action: z.literal('set_element'),
      id: z.string().describe('Element id from slip_read summary'),
      fields: fieldsSchema,
    })
    .describe('Merge fields into an existing element'),
  z
    .object({
      action: z.literal('add_element'),
      pageIndex: z.number().int().min(0).describe('0-based destination page index'),
      element: elementSchema,
      beforeId: z
        .string()
        .optional()
        .describe('Insert before this element id on the same page; omit to append'),
    })
    .describe('Add an element to a page'),
  z
    .object({
      action: z.literal('remove_element'),
      id: z.string().describe('Element id from slip_read summary'),
    })
    .describe('Remove an element'),
  z
    .object({
      action: z.literal('add_page'),
      index: z.number().int().min(0).optional().describe('0-based insertion index; omit to append'),
    })
    .describe('Add an empty page'),
  z
    .object({
      action: z.literal('remove_page'),
      index: z.number().int().min(0).describe('0-based page index'),
    })
    .describe('Remove a page'),
  z
    .object({
      action: z.literal('set_page'),
      index: z.number().int().min(0).describe('0-based page index'),
      fields: fieldsSchema,
    })
    .describe('Merge fields into a page'),
  z
    .object({ action: z.literal('add_parameter'), parameter: parameterSchema })
    .describe('Add a parameter definition'),
  z
    .object({
      action: z.literal('set_parameter'),
      key: z.string().describe('Parameter key from slip_read summary'),
      fields: fieldsSchema,
    })
    .describe('Merge fields into a parameter definition'),
  z
    .object({
      action: z.literal('remove_parameter'),
      key: z.string().describe('Parameter key from slip_read summary'),
    })
    .describe('Remove a parameter definition'),
  z
    .object({
      action: z.literal('set_cell'),
      elementId: z.string().describe('Grid element id from slip_read summary'),
      row: z.number().int().min(0).describe('0-based row index'),
      column: z.number().int().min(0).describe('0-based column index'),
      fields: fieldsSchema,
    })
    .describe('Merge fields into a grid cell, creating the cell when absent'),
  z
    .object({
      action: z.literal('set_image'),
      elementId: z.string().describe('Image element id; may refer to an element added earlier in this call'),
      imagePath: z
        .string()
        .describe('Local image path relative to the working directory; never pass base64'),
    })
    .describe('Embed a local image as a fixed asset and connect it to an image element'),
  z
    .object({ action: z.literal('set_values'), values: valuesSchema })
    .describe('Merge values into an unissued voucher'),
]);

/** `slip_edit` 연산 하나 */
export type EditOp = z.infer<typeof editOpSchema>;

/** 연산 적용에 필요한 파일 경로 처리 함수. */
export interface EditContext {
  /** 이미지 경로를 작업 디렉터리 안의 절대 경로로 변환한다. 벗어나면 던진다. */
  resolveFilePath: (relPath: string) => string;
}

/**
 * 전달된 필드만 대상에 반영한다. `null`은 해당 필드를 삭제한다.
 * MCP의 JSON 입력에는 `undefined`를 사용할 수 없으므로 필드 삭제에 `null`을 사용한다.
 * 예를 들어 `{ "parameter": null, "formula": "..." }`는 값 소스를 수식으로 바꾼다.
 */
function mergeFields(target: Record<string, unknown>, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) delete target[key];
    else target[key] = value;
  }
}

/** 전달된 값을 전표에 반영한다. `null`은 필드 삭제가 아닌 전표 값으로 저장한다. */
function mergeValues(target: Record<string, unknown>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) target[key] = value;
  }
}

/** 요소를 찾고, 없으면 현재 요소 id 목록을 담은 오류를 던진다. */
function requireElement(file: SlipFile, id: string): ReturnType<typeof findElement> & object {
  const found = findElement(file, id);
  if (!found) {
    const ids = allElementIds(file).slice(0, 30).join(', ');
    throw new McpToolError(`No element with id "${id}". Available element ids: ${ids}`);
  }
  return found;
}

/** 페이지를 찾고, 없으면 페이지 수를 안내하는 오류를 던진다. */
function requirePage(body: SlipTemplateBody, index: number): (typeof body.pages)[number] {
  const page = body.pages[index];
  if (!page) {
    throw new McpToolError(`No page at index ${index}. The file has ${body.pages.length} page(s).`);
  }
  return page;
}

/**
 * 연산 하나를 파일(사본)에 적용한다.
 *
 * @param file - 수정할 파일 (호출 전에 깊은 사본을 만들어 넘긴다)
 * @param op - 적용할 연산
 * @param context - 이미지 경로 해석 함수
 * @returns 적용 내용 한 줄 설명
 * @throws McpToolError 대상이 없거나 연산을 적용할 수 없을 때
 */
export async function applyEditOp(
  file: SlipFile,
  op: EditOp,
  context: EditContext,
): Promise<string> {
  const body = bodyOf(file);
  switch (op.action) {
    case 'set_meta': {
      mergeFields(body.meta as unknown as Record<string, unknown>, op.fields);
      return `set_meta: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'set_paper': {
      mergeFields(body.paper as unknown as Record<string, unknown>, op.fields);
      return `set_paper: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'set_element': {
      const { element } = requireElement(file, op.id);
      mergeFields(element as unknown as Record<string, unknown>, op.fields);
      if ('src' in op.fields) assertElementImage(element);
      return `set_element ${op.id}: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'add_element': {
      const page = requirePage(body, op.pageIndex);
      const element = op.element as unknown as (typeof page.elements)[number];
      if (typeof element.id === 'string' && findElement(file, element.id)) {
        throw new McpToolError(`Element id "${element.id}" already exists. Ids must be unique.`);
      }
      const at =
        op.beforeId === undefined
          ? page.elements.length
          : page.elements.findIndex((entry) => entry.id === op.beforeId);
      if (at < 0) {
        throw new McpToolError(`beforeId "${op.beforeId}" is not on page ${op.pageIndex}.`);
      }
      assertElementImage(element);
      page.elements.splice(at, 0, element);
      return `add_element ${element.id ?? '(no id)'} on page ${op.pageIndex}`;
    }
    case 'remove_element': {
      const { pageIndex, elementIndex } = requireElement(file, op.id);
      body.pages[pageIndex]!.elements.splice(elementIndex, 1);
      return `remove_element ${op.id}`;
    }
    case 'add_page': {
      const at = op.index ?? body.pages.length;
      if (at > body.pages.length) {
        throw new McpToolError(`Page index ${at} is out of range (0..${body.pages.length}).`);
      }
      body.pages.splice(at, 0, { elements: [] });
      return `add_page at ${at}`;
    }
    case 'remove_page': {
      requirePage(body, op.index);
      body.pages.splice(op.index, 1);
      return `remove_page ${op.index}`;
    }
    case 'set_page': {
      const page = requirePage(body, op.index);
      mergeFields(page as unknown as Record<string, unknown>, op.fields);
      return `set_page ${op.index}: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'add_parameter': {
      body.parameters ??= [];
      body.parameters.push(op.parameter as unknown as NonNullable<typeof body.parameters>[number]);
      return `add_parameter ${String(op.parameter['key'] ?? '(no key)')}`;
    }
    case 'set_parameter': {
      const parameter = body.parameters?.find((entry) => entry.key === op.key);
      if (!parameter) {
        const keys = (body.parameters ?? []).map((entry) => entry.key).join(', ');
        throw new McpToolError(`No parameter with key "${op.key}". Defined keys: ${keys}`);
      }
      mergeFields(parameter as unknown as Record<string, unknown>, op.fields);
      return `set_parameter ${op.key}: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'remove_parameter': {
      const index = (body.parameters ?? []).findIndex((entry) => entry.key === op.key);
      if (index < 0) {
        throw new McpToolError(`No parameter with key "${op.key}".`);
      }
      body.parameters!.splice(index, 1);
      return `remove_parameter ${op.key}`;
    }
    case 'set_cell': {
      const { element } = requireElement(file, op.elementId);
      if (element.type !== 'grid') {
        throw new McpToolError(`Element "${op.elementId}" is not a grid.`);
      }
      const cell = element.cells.find((entry) => entry.row === op.row && entry.column === op.column);
      if (cell) {
        mergeFields(cell as unknown as Record<string, unknown>, op.fields);
      } else {
        element.cells.push({
          row: op.row,
          column: op.column,
          ...op.fields,
        } as unknown as (typeof element.cells)[number]);
      }
      return `set_cell ${op.elementId}[${op.row},${op.column}]: ${Object.keys(op.fields).join(', ')}`;
    }
    case 'set_image': {
      const { element } = requireElement(file, op.elementId);
      if (element.type !== 'image') {
        throw new McpToolError(`Element "${op.elementId}" is not an image element.`);
      }
      const extension = path.extname(op.imagePath).toLowerCase();
      const declared = IMAGE_EXTENSIONS[extension];
      if (declared === undefined) {
        throw new McpToolError(
          `Unsupported image file "${op.imagePath}" (extension "${extension}"). Supported: ${SUPPORTED_IMAGES}; ` +
            'use a .png, .jpg, or .jpeg file.',
        );
      }
      const abs = context.resolveFilePath(op.imagePath);
      let bytes: Buffer;
      try {
        bytes = await readFile(abs);
      } catch {
        throw new McpToolError(`Could not read image file: ${op.imagePath}`);
      }
      // 확장자는 선언일 뿐이므로 실제 내용(서명)과 크기를 다시 확인한다.
      const inspection = inspectImageBytes(bytes, { declaredMimeType: declared });
      if (!inspection.ok) {
        throw new McpToolError(imageProblem(inspection, `Image file "${op.imagePath}"`));
      }
      const mime = inspection.mimeType;
      const src = `data:${mime};base64,${bytes.toString('base64')}`;
      // 기존 고정 이미지는 같은 에셋을 갱신해 불필요한 에셋이 남지 않게 한다.
      const currentId = element.src?.startsWith('asset://') ? element.src.slice(8) : undefined;
      const current = body.assets.find((asset) => asset.id === currentId);
      if (current) {
        current.mimeType = mime;
        current.src = src;
        return `set_image ${op.elementId}: replaced asset ${current.id} (${Math.round(bytes.length / 1024)}KB)`;
      }
      const assetId = nextAssetId(body);
      body.assets.push({ id: assetId, mimeType: mime, src });
      element.src = `asset://${assetId}`;
      delete element.parameter;
      return `set_image ${op.elementId}: added asset ${assetId} (${Math.round(bytes.length / 1024)}KB)`;
    }
    case 'set_values': {
      if (file.kind !== 'voucher') {
        throw new McpToolError('set_values applies only to voucher files.');
      }
      assertImageValues(op.values);
      mergeValues(file.values as Record<string, unknown>, op.values);
      return `set_values: ${Object.keys(op.values).join(', ')}`;
    }
  }
}

/** 문서 안에서 겹치지 않는 새 에셋 id를 만든다. */
function nextAssetId(body: SlipTemplateBody): string {
  for (let index = 1; ; index += 1) {
    const id = `img-${index}`;
    if (!body.assets.some((asset) => asset.id === id)) return id;
  }
}
