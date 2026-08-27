/**
 * SlipKit MCP 서버 — 도구 7종과 `.slip` JSON Schema 리소스를 제공한다.
 * 파일 접근은 {@link FileSystemStorage}를 통해 작업 디렉터리 안으로 제한한다.
 */
import { writeFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildVoucher,
  createSlipKit,
  slipFileJsonSchema,
  validateSlipFile,
  type JsonValue,
  type SlipFile,
  type SlipKit,
} from '@omdc-slipkit/core';
import { PRETENDARD_FONTS } from '@omdc-slipkit/elements/fonts/pretendard';
import { NOTO_SANS_JP_FONTS } from '@omdc-slipkit/elements/fonts/noto-sans-jp';
import {
  FileSystemStorage,
  reasonOf,
  resolveInRoot,
  type FileSystemStorageOptions,
} from './storage.js';
import { applyEditOp, editOpSchema, McpToolError } from './edit.js';
import { bodyOf, elideDataUrls, findElement, summarize } from './summary.js';
import { SCHEMA_TOPICS, schemaTopicText } from './schema-docs.js';

/** {@link createSlipMcpServer} 옵션. 저장소 옵션과 같다. */
export type SlipMcpServerOptions = FileSystemStorageOptions;

/** 패키지 버전. 배포 버전을 올릴 때 함께 갱신한다. */
const SERVER_VERSION = '0.0.1';

/** 연결 시 클라이언트에 전달하는 서버 사용 안내 */
const INSTRUCTIONS = `SlipKit MCP server: create and edit .slip business-form files in the working directory.

Workflow for a NEW form: call slip_schema (topic "overview", then the topics you need) to learn the
file structure, write the complete file JSON with slip_save, then check the result with slip_render_pdf.

Workflow for EDITING: slip_read with part "summary" to see pages, element ids and parameters;
read only the parts you need (part "element" or "page"); then apply targeted changes with slip_edit,
addressing elements by id. Do not rewrite whole files to make small changes.

Every save validates the file and reports precise errors without writing anything — fix and retry.
Image bytes never pass through the conversation: attach images with slip_edit's set_image op using a
file path inside the working directory. Build filled vouchers with slip_build_voucher. Issued
(finalized) vouchers are immutable and this server cannot issue them.`;

/** 도구 응답 하나를 텍스트로 만든다. */
function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/** 오류를 도구 오류 응답으로 바꾼다. 메시지는 호출자가 고칠 수 있게 그대로 전달한다. */
function toolError(error: unknown): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: `Error: ${reasonOf(error)}` }], isError: true };
}

/** 파일 저장 결과를 한 줄 요약으로 만든다. */
function savedLine(id: string, file: SlipFile): string {
  const body = bodyOf(file);
  const elements = body.pages.reduce((sum, page) => sum + page.elements.length, 0);
  return `Saved ${id} (${file.kind} "${body.meta.title}", ${body.pages.length} page(s), ${elements} element(s))`;
}

/**
 * SlipKit MCP 서버를 만든다. 전송 연결은 호출자가 한다.
 *
 * @param options - 작업 디렉터리, 로케일과 암호화 설정
 * @returns 구성이 끝난 MCP 서버와 내부 저장소
 */
export function createSlipMcpServer(options: SlipMcpServerOptions): {
  server: McpServer;
  storage: FileSystemStorage;
} {
  const storage = new FileSystemStorage(options);
  const locale = options.locale;
  const slipKit: SlipKit = createSlipKit({
    getFonts: () =>
      locale?.toLowerCase().startsWith('ja') ? NOTO_SANS_JP_FONTS : PRETENDARD_FONTS,
    ...(locale === undefined ? {} : { locale }),
  });

  const server = new McpServer(
    { name: 'slipkit-mcp-server', version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  /** 파일이 있는지 확인한다 (load 성공 여부로 판단). */
  async function exists(id: string): Promise<boolean> {
    try {
      await storage.load(id);
      return true;
    } catch {
      return false;
    }
  }

  /** 발행된 전표면 수정 거부 오류를 던진다. */
  function rejectIssued(file: SlipFile, id: string): void {
    if (file.kind === 'voucher' && file.issued) {
      throw new McpToolError(`"${id}" is an issued voucher and cannot be modified.`);
    }
  }

  server.registerTool(
    'slip_list',
    {
      title: 'List .slip files',
      description:
        'List the .slip files in the working directory (path, kind, title, updatedAt). ' +
        'Filter with "kind" (template | voucher) or "query" (substring of title or path). ' +
        'Returns up to 50 items per page; pass "cursor" from the previous result to continue.',
      inputSchema: {
        kind: z.enum(['template', 'voucher']).optional(),
        query: z.string().optional(),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ kind, query, cursor }) => {
      try {
        const page = await storage.list(
          {
            ...(kind === undefined ? {} : { kind }),
            ...(query === undefined ? {} : { query }),
          },
          cursor,
        );
        return text(page);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_read',
    {
      title: 'Read a .slip file',
      description:
        'Read a .slip file. part "summary" (default) returns the structure: pages with element ' +
        'ids/types/positions, parameters and assets — start here. part "element" (with elementId) or ' +
        '"page" (with pageIndex) returns just that part in full. part "full" returns the whole file. ' +
        'Embedded base64 image data is always replaced by a size placeholder and never returned.',
      inputSchema: {
        path: z.string().describe('File path relative to the working directory'),
        part: z.enum(['summary', 'element', 'page', 'full']).optional(),
        elementId: z.string().optional(),
        pageIndex: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: id, part, elementId, pageIndex }) => {
      try {
        const file = await storage.load(id);
        const mode = part ?? 'summary';
        if (mode === 'summary') return text(summarize(file));
        if (mode === 'element') {
          if (elementId === undefined) {
            throw new McpToolError('part "element" requires elementId.');
          }
          const found = findElement(file, elementId);
          if (!found) {
            throw new McpToolError(
              `No element with id "${elementId}". Use part "summary" to list element ids.`,
            );
          }
          return text(elideDataUrls({ pageIndex: found.pageIndex, element: found.element }));
        }
        if (mode === 'page') {
          if (pageIndex === undefined) {
            throw new McpToolError('part "page" requires pageIndex.');
          }
          const page = bodyOf(file).pages[pageIndex];
          if (!page) {
            throw new McpToolError(
              `No page at index ${pageIndex}. The file has ${bodyOf(file).pages.length} page(s).`,
            );
          }
          return text(elideDataUrls({ pageIndex, page }));
        }
        return text(elideDataUrls(file));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_save',
    {
      title: 'Save a new .slip file',
      description:
        'Validate and save a complete .slip file (template or voucher) as JSON. Meant for CREATING ' +
        'new files — to change an existing file use slip_edit instead of rewriting it. Fails if the ' +
        'file already exists unless overwrite is true. On validation failure nothing is written and ' +
        'the precise errors are returned; fix them and call again. See slip_schema for the structure.',
      inputSchema: {
        path: z.string().describe('File path relative to the working directory (.slip appended if missing)'),
        file: z.record(z.string(), z.unknown()).describe('The complete .slip document as a JSON object'),
        overwrite: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: id, file: raw, overwrite }) => {
      try {
        const file = validateSlipFile(raw, locale === undefined ? {} : { locale });
        if (overwrite !== true && (await exists(id))) {
          throw new McpToolError(
            `"${id}" already exists. Use slip_edit for changes, or pass overwrite: true to replace it.`,
          );
        }
        await storage.save(id, file);
        return text(savedLine(id, file));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_edit',
    {
      title: 'Edit a .slip file',
      description:
        'Apply targeted changes to an existing .slip file. Address elements by their id (see ' +
        'slip_read part "summary"), parameters by key, pages by index. All ops are applied ' +
        'atomically: the result is validated as a whole and nothing is written if anything fails. ' +
        'Ops: set_meta/set_paper/set_page {fields}; set_element {id, fields} (merge; a field set to ' +
        'null stays null — omit fields you do not change); add_element {pageIndex, element, ' +
        'beforeId?}; remove_element {id}; add_page {index?}; remove_page {index}; add_parameter ' +
        '{parameter}; set_parameter {key, fields}; remove_parameter {key}; set_cell {elementId, row, ' +
        'column, fields}; set_image {elementId, imagePath} (reads the image file from the working ' +
        'directory and stores it as an asset — never pass base64); set_values {values} (voucher only).',
      inputSchema: {
        path: z.string().describe('File path relative to the working directory'),
        ops: z.array(editOpSchema).min(1).describe('Operations applied in order'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: id, ops }) => {
      try {
        const original = await storage.load(id);
        rejectIssued(original, id);
        const draft = structuredClone(original);
        const applied: string[] = [];
        for (const op of ops) {
          applied.push(
            await applyEditOp(draft, op, {
              resolveFilePath: (relPath) => resolveInRoot(storage.rootDir, relPath, locale),
            }),
          );
        }
        const validated = validateSlipFile(draft, locale === undefined ? {} : { locale });
        await storage.save(id, validated);
        return text(`Applied to ${id}:\n- ${applied.join('\n- ')}`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_build_voucher',
    {
      title: 'Build a voucher from a template',
      description:
        'Assemble an unissued voucher file from a template file and parameter values, and save it. ' +
        'values keys are the template\'s parameter keys; a "list" parameter takes an array of flat ' +
        'objects. Use slip_edit set_values to adjust values afterwards.',
      inputSchema: {
        templatePath: z.string(),
        values: z.record(z.string(), z.unknown()).optional(),
        outPath: z.string().describe('Output path for the voucher (.slip appended if missing)'),
        overwrite: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ templatePath, values, outPath, overwrite }) => {
      try {
        const template = await storage.load(templatePath);
        if (template.kind !== 'template') {
          throw new McpToolError(`"${templatePath}" is a voucher, not a template.`);
        }
        if (overwrite !== true && (await exists(outPath))) {
          throw new McpToolError(`"${outPath}" already exists. Pass overwrite: true to replace it.`);
        }
        const voucher = buildVoucher(template, (values ?? {}) as Record<string, JsonValue>);
        await storage.save(outPath, voucher);
        return text(savedLine(outPath, voucher));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_render_pdf',
    {
      title: 'Render a .slip file to PDF',
      description:
        'Render a template or voucher to a PDF file in the working directory, using the bundled ' +
        'fonts. Use this to check the visual result of your work (a client that can view files can ' +
        'open the PDF). A template renders with empty values; render a built voucher to see real data.',
      inputSchema: {
        path: z.string(),
        outPath: z
          .string()
          .optional()
          .describe('Output PDF path; defaults to the input path with a .pdf extension'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: id, outPath }) => {
      try {
        const file = await storage.load(id);
        const pdf = await slipKit.render(file);
        const target = outPath ?? id.replace(/\.slip$/, '') + '.pdf';
        const abs = resolveInRoot(storage.rootDir, target, locale);
        await writeFile(abs, pdf);
        return text(`Rendered ${id} to ${target} (${Math.round(pdf.length / 1024)}KB)`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'slip_schema',
    {
      title: 'Explain the .slip file structure',
      description:
        'Return reference documentation for authoring .slip files. Topics: overview (start here), ' +
        'elements, grid, parameters, formula, voucher, json-schema (the full generated JSON Schema).',
      inputSchema: { topic: z.enum(SCHEMA_TOPICS) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ topic }) => text(schemaTopicText(topic)),
  );

  server.registerResource(
    'slip-json-schema',
    'slip://schema',
    {
      title: '.slip JSON Schema',
      description: 'JSON Schema for the .slip file format',
      mimeType: 'application/schema+json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/schema+json',
          text: JSON.stringify(slipFileJsonSchema(), null, 2),
        },
      ],
    }),
  );

  return { server, storage };
}
