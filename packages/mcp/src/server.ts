/**
 * SlipKit MCP 서버 — 도구 7종과 `.slip` JSON Schema 리소스를 제공한다.
 * 파일 접근은 {@link FileSystemStorage}를 통해 작업 디렉터리 안으로 제한한다.
 */
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildVoucher,
  createSlipKit,
  SlipStorageError,
  slipFileJsonSchema,
  validateSlipFile,
  type JsonValue,
  type SlipFile,
  type SlipFont,
  type SlipKit,
} from '@omdc-slipkit/core';
import {
  FileSystemStorage,
  reasonOf,
  resolveInRoot,
  type FileSystemStorageOptions,
} from './storage.js';
import { applyEditOp, editOpSchema, McpToolError } from './edit.js';
import { bodyOf, elideDataUrls, findElement, summarize } from './summary.js';
import { SCHEMA_TOPICS, schemaTopicText } from './schema-docs.js';

/** {@link createSlipMcpServer} 옵션 */
export interface SlipMcpServerOptions extends FileSystemStorageOptions {
  /** PDF 렌더링에 사용할 커스텀 폰트. 생략하면 로케일에 맞는 동봉 폰트를 사용한다 */
  fonts?: readonly SlipFont[];
  /** PDF 링크 서버의 기본 URL. 지정하면 렌더 응답에 PDF URL을 포함한다 */
  pdfBaseUrl?: string;
}

/** 패키지 버전. 배포 버전을 올릴 때 함께 갱신한다. */
const SERVER_VERSION = '0.0.1';

/** 연결 시 MCP 클라이언트에 전달하는 작업 지침. */
const INSTRUCTIONS = `SlipKit MCP server: create and edit .slip business-form files in the working directory.

Workflow for a NEW form: call slip_schema (topic "overview", then the topics you need) to learn the
file structure, write the complete file JSON with slip_save, then check the result with slip_render_pdf.

Workflow for EDITING: slip_read with part "summary" to see pages, element ids and parameters;
read only the parts you need (part "element" or "page"); then apply targeted changes with slip_edit,
addressing elements by id. Do not rewrite whole files to make small changes.

Every save validates the file and reports precise errors without writing anything — fix and retry.
Do not pass source image data as base64 tool input. Attach fixed images with slip_edit's set_image op
using a file path inside the working directory. To add a new image element, put add_element before
set_image in the same ops array; operations run in order and validation happens after all of them.
set_image creates a fixed asset, not a voucher image-parameter value. Build filled vouchers with
slip_build_voucher. Issued (finalized) vouchers are immutable and this server cannot issue them.
For visual inspection, call slip_render_pdf with preview: true. It returns one page as a PNG image;
use previewPage to select another page. The PDF is always saved to the working directory. The result
includes its absolute path and a resource link, plus an HTTP URL when pdfBaseUrl is configured.`;

/** 도구 응답 하나를 텍스트로 만든다. */
function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/** 오류 메시지를 AI가 확인할 수 있는 도구 오류 응답으로 변환한다. */
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

/** PDF의 72pt/in 좌표를 2배로 래스터화해 144ppi 미리보기를 만든다. */
const PREVIEW_SCALE = 2;

/**
 * PDF의 한 페이지를 PNG 이미지 콘텐츠로 변환한다.
 *
 * @param pdf - 렌더된 PDF 바이트
 * @param page - 1부터 시작하는 페이지 번호
 * @returns 이미지 콘텐츠 블록 1개
 * @throws McpToolError 페이지 번호가 범위를 벗어났을 때
 */
async function renderPreview(
  pdf: Uint8Array,
  page: number,
): Promise<{ type: 'image'; data: string; mimeType: 'image/png' }[]> {
  const { pdf2img } = await import('@pdfme/converter');
  const images = await pdf2img(pdf, {
    scale: PREVIEW_SCALE,
    range: { start: page - 1, end: page - 1 },
  });
  const image = images[0];
  if (!image) {
    throw new McpToolError(`No page ${page} in the rendered PDF. Use a smaller previewPage.`);
  }
  return [
    { type: 'image', data: Buffer.from(image).toString('base64'), mimeType: 'image/png' },
  ];
}

/**
 * SlipKit MCP 서버를 만든다. 전송 연결은 호출자가 한다.
 *
 * @param options - 작업 디렉터리, 로케일, 암호화, PDF 폰트와 링크 서버 설정
 * @returns 구성이 끝난 MCP 서버와 내부 저장소
 */
export function createSlipMcpServer(options: SlipMcpServerOptions): {
  server: McpServer;
  storage: FileSystemStorage;
} {
  const storage = new FileSystemStorage(options);
  const locale = options.locale;
  const customFonts = options.fonts;
  const slipKit: SlipKit = createSlipKit({
    // 동봉된 모든 폰트를 등록하고 로케일에 따라 fontName을 생략한 요소의
    // 대체(fallback) 폰트를 선택한다.
    getFonts: async () => {
      if (customFonts !== undefined && customFonts.length > 0) return customFonts;
      const { loadDefaultFonts } = await import('@omdc-slipkit/elements/default-fonts');
      return loadDefaultFonts(locale?.toLowerCase().startsWith('ja') ? 'ja' : 'ko');
    },
    ...(locale === undefined ? {} : { locale }),
  });

  const server = new McpServer(
    { name: 'slipkit-mcp-server', version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  /** 기존 파일을 읽는다. 파일이 없으면 null을 반환한다. */
  async function loadExisting(id: string): Promise<SlipFile | null> {
    try {
      return await storage.load(id);
    } catch (error) {
      if (error instanceof SlipStorageError && error.code === 'not-found') return null;
      throw error;
    }
  }

  /** 발행된 전표의 생성·교체·수정을 거부한다. */
  function rejectIssued(file: SlipFile, id: string): void {
    if (file.kind === 'voucher' && file.issued) {
      throw new McpToolError(
        `"${id}" is an issued voucher. This server cannot create, replace, or edit issued vouchers.`,
      );
    }
  }

  server.registerTool(
    'slip_list',
    {
      title: 'List .slip files',
      description:
        'List the .slip files in the working directory (path, kind, title, updatedAt). ' +
        'Filter with "kind" (template | voucher) or "query" (substring of title or path). ' +
        'Returns up to 50 items per page; pass "cursor" from the previous result to continue. ' +
        'Files that cannot be parsed or decrypted are omitted.',
      inputSchema: {
        kind: z
          .enum(['template', 'voucher'])
          .optional()
          .describe('Return only templates or only vouchers; omit for both'),
        query: z
          .string()
          .optional()
          .describe('Case-insensitive substring matched against file path and title'),
        cursor: z
          .string()
          .optional()
          .describe('Pagination cursor returned as nextCursor by the previous call'),
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
        part: z
          .enum(['summary', 'element', 'page', 'full'])
          .optional()
          .describe('Section to return; defaults to summary, which should be read first'),
        elementId: z
          .string()
          .optional()
          .describe('Element id required when part is element; obtain it from summary'),
        pageIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based page index required when part is page'),
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
        'the precise errors are returned; fix them and call again. Vouchers must have issued=false; ' +
        'this server neither creates nor replaces issued vouchers. See slip_schema for the structure.',
      inputSchema: {
        path: z.string().describe('File path relative to the working directory (.slip appended if missing)'),
        file: z.record(z.string(), z.unknown()).describe('The complete .slip document as a JSON object'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing unissued file; defaults to false'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: id, file: raw, overwrite }) => {
      try {
        const file = validateSlipFile(raw, locale === undefined ? {} : { locale });
        rejectIssued(file, id);
        const existing = await loadExisting(id);
        if (existing !== null) {
          rejectIssued(existing, id);
          if (overwrite !== true) {
            throw new McpToolError(
              `"${id}" already exists. Use slip_edit for changes, or pass overwrite: true to replace it.`,
            );
          }
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
        'slip_read part "summary"), parameters by key, pages by 0-based index. Ops run in the given ' +
        'order, then the result is validated as a whole; nothing is written if anything fails. ' +
        'This allows add_element followed by set_image for a new fixed image in one call. ' +
        'Ops: set_meta/set_paper {fields}; set_page {index, fields}; set_element {id, fields} (merge; set a ' +
        'field to null to REMOVE it, e.g. {parameter: null, formula: "..."} switches the value ' +
        'source; omit fields you do not change); add_element {pageIndex, element, ' +
        'beforeId?}; remove_element {id}; add_page {index?}; remove_page {index}; add_parameter ' +
        '{parameter}; set_parameter {key, fields}; remove_parameter {key}; set_cell {elementId, row, ' +
        'column, fields}; set_image {elementId, imagePath} (reads the image file from the working ' +
        'directory and stores it as an asset — never pass base64); set_values {values} (voucher only; null is stored as the value, not a removal).',
      inputSchema: {
        path: z.string().describe('File path relative to the working directory'),
        ops: z
          .array(editOpSchema)
          .min(1)
          .describe('Operations applied in order and committed only after whole-file validation'),
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
        'objects. Use slip_edit set_values to adjust values afterwards. An existing issued voucher ' +
        'cannot be replaced.',
      inputSchema: {
        templatePath: z
          .string()
          .describe('Template file path relative to the working directory'),
        values: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Values keyed by parameter key; list parameters take arrays of flat objects'),
        outPath: z.string().describe('Output path for the voucher (.slip appended if missing)'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing unissued file at outPath; defaults to false'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ templatePath, values, outPath, overwrite }) => {
      try {
        const template = await storage.load(templatePath);
        if (template.kind !== 'template') {
          throw new McpToolError(`"${templatePath}" is a voucher, not a template.`);
        }
        const existing = await loadExisting(outPath);
        if (existing !== null) {
          rejectIssued(existing, outPath);
          if (overwrite !== true) {
            throw new McpToolError(`"${outPath}" already exists. Pass overwrite: true to replace it.`);
          }
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
        'open the PDF). A template renders with empty values; render a built voucher to see real data. ' +
        'The output path cannot use the .slip extension. An existing non-.slip output file is replaced.',
      inputSchema: {
        path: z.string().describe('Template or voucher path relative to the working directory'),
        outPath: z
          .string()
          .optional()
          .describe(
            'Output path relative to the working directory; defaults to the input path with .pdf and replaces an existing file',
          ),
        preview: z
          .boolean()
          .optional()
          .describe('Also return one rendered page as a PNG image for visual inspection'),
        previewPage: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based page number to preview; default 1'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: id, outPath, preview, previewPage }) => {
      try {
        const file = await storage.load(id);
        const target = outPath ?? id.replace(/\.slip$/, '') + '.pdf';
        if (target.toLowerCase().endsWith('.slip')) {
          throw new McpToolError('PDF output path cannot use the .slip extension.');
        }
        const pdf = await slipKit.render(file);
        const abs = resolveInRoot(storage.rootDir, target, locale);
        await writeFile(abs, pdf);
        // 링크 서버가 켜져 있으면 렌더 응답에 PDF URL을 포함한다.
        const link =
          options.pdfBaseUrl === undefined
            ? null
            : `${options.pdfBaseUrl}/${target.split('/').map(encodeURIComponent).join('/')}`;
        const previewImages = preview === true ? await renderPreview(pdf, previewPage ?? 1) : [];
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Rendered ${id} to ${target} (${Math.round(pdf.length / 1024)}KB).\n` +
                `Saved at: ${abs}` +
                (link === null ? '' : `\nLink: ${link}`),
            },
            {
              type: 'resource_link' as const,
              uri: pathToFileURL(abs).href,
              name: target,
              mimeType: 'application/pdf',
              description: 'Rendered PDF file',
            },
            ...previewImages,
          ],
        };
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
      inputSchema: {
        topic: z
          .enum(SCHEMA_TOPICS)
          .describe('Documentation section; start with overview and request json-schema only for exact fields'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ topic }) => text(schemaTopicText(topic)),
  );

  server.registerResource(
    'slip-json-schema',
    'slip://schema',
    {
      title: '.slip JSON Schema',
      description:
        'Authoritative validation schema for the .slip file format; use slip_schema for authoring guidance',
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
