/**
 * `slip_edit` 도구의 id 지목 부분 수정 연산.
 * 배열 인덱스 대신 요소 id·파라미터 key로 대상을 지목해, 순서와 무관하게 적용된다.
 * 연산을 모두 적용한 뒤 파일 전체를 core로 검증하고, 실패하면 아무것도 저장하지 않는다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SlipFile, SlipTemplateBody } from '@omdc-slipkit/core';
import { allElementIds, bodyOf, findElement } from './summary.js';

/** 도구 호출자가 고칠 수 있는 오류. 메시지가 그대로 도구 응답이 된다. */
export class McpToolError extends Error {}

/** 업로드할 수 있는 이미지 파일의 최대 크기(바이트). 디자이너 기본값과 같다. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 확장자별 이미지 MIME 타입 */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const fieldsSchema = z.record(z.string(), z.unknown());

/** `slip_edit` 연산 입력 스키마 (`action`으로 구분) */
export const editOpSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_meta'), fields: fieldsSchema }),
  z.object({ action: z.literal('set_paper'), fields: fieldsSchema }),
  z.object({ action: z.literal('set_element'), id: z.string(), fields: fieldsSchema }),
  z.object({
    action: z.literal('add_element'),
    pageIndex: z.number().int().min(0),
    element: fieldsSchema,
    beforeId: z.string().optional(),
  }),
  z.object({ action: z.literal('remove_element'), id: z.string() }),
  z.object({ action: z.literal('add_page'), index: z.number().int().min(0).optional() }),
  z.object({ action: z.literal('remove_page'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('set_page'), index: z.number().int().min(0), fields: fieldsSchema }),
  z.object({ action: z.literal('add_parameter'), parameter: fieldsSchema }),
  z.object({ action: z.literal('set_parameter'), key: z.string(), fields: fieldsSchema }),
  z.object({ action: z.literal('remove_parameter'), key: z.string() }),
  z.object({
    action: z.literal('set_cell'),
    elementId: z.string(),
    row: z.number().int().min(0),
    column: z.number().int().min(0),
    fields: fieldsSchema,
  }),
  z.object({ action: z.literal('set_image'), elementId: z.string(), imagePath: z.string() }),
  z.object({ action: z.literal('set_values'), values: fieldsSchema }),
]);

/** `slip_edit` 연산 하나 */
export type EditOp = z.infer<typeof editOpSchema>;

/** 연산 적용에 필요한 주변 정보 */
export interface EditContext {
  /** 이미지 경로를 작업 디렉터리 안의 절대 경로로 변환한다. 벗어나면 던진다. */
  resolveFilePath: (relPath: string) => string;
}

/** 대상 필드에 부분 병합할 값을 덮어쓴다. `undefined` 값은 필드 삭제로 처리한다. */
function mergeFields(target: Record<string, unknown>, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}

/** 요소를 찾고, 없으면 사용할 수 있는 id를 안내하는 오류를 던진다. */
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
 * @param context - 이미지 경로 해석 등 주변 정보
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
      const mime = IMAGE_MIME[path.extname(op.imagePath).toLowerCase()];
      if (mime === undefined) {
        throw new McpToolError(
          `Unsupported image extension "${path.extname(op.imagePath)}". Supported: png, jpg, jpeg, gif, webp.`,
        );
      }
      const abs = context.resolveFilePath(op.imagePath);
      let bytes: Buffer;
      try {
        bytes = await readFile(abs);
      } catch {
        throw new McpToolError(`Could not read image file: ${op.imagePath}`);
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new McpToolError(
          `Image is ${Math.round(bytes.length / 1024)}KB; the limit is ${MAX_IMAGE_BYTES / 1024}KB.`,
        );
      }
      const src = `data:${mime};base64,${bytes.toString('base64')}`;
      // 요소가 이미 에셋을 참조하면 그 에셋을 교체하고, 아니면 새 에셋을 만든다.
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
      mergeFields(file.values as Record<string, unknown>, op.values);
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
