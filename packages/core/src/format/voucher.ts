/**
 * 전표 조립 헬퍼 (ADR-052).
 *
 * UI 없이 core만으로 전표를 만들 때, 양식(template)과 값(values)을 합쳐 전표(voucher)
 * 객체를 만드는 일을 한곳에 둔다. 작성폼(`<slip-form>`)도 같은 규칙으로 전표를 조립하므로
 * 이 함수를 공유해 조립 규칙이 갈라지지 않게 한다.
 */
import type { JsonValue, SlipTemplateFile, SlipVoucherFile } from './schema.js';
import { normalizeNumericParameters } from './normalize.js';

/** JSON 왕복 깊은 복사 — 전표가 입력 양식·값과 참조를 공유하지 않게 한다 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 양식과 값으로 발행 전(`issued: false`) 전표를 조립한다 (ADR-052).
 *
 * @remarks
 * - 값은 파라미터 물리명(`key`)을 키로 담는다. 목록(list) 파라미터는 항목 객체 배열,
 *   이미지 파라미터는 `data:` base64 문자열이다 (SPEC §7, ADR-036).
 * - `number` 파라미터의 빈 값(미입력·null·빈 문자열)은 0으로 맞춘다 (ADR-044) — 작성폼과
 *   같은 결과를 내도록.
 * - 수식으로 계산되는 값(예: 합계금액)은 `values`에 넣지 않아도 렌더 시 계산된다.
 * - 결과는 입력 양식·값과 참조를 공유하지 않는 독립 객체다.
 * - 값을 확정하려면 `issued: true`로 바꾼다 — 작성폼에서 더 고칠 수 없게 잠긴다.
 *
 * @param template - 바탕 양식 파일 (`parseSlipFile` 결과 등, `kind: 'template'`)
 * @param values - 파라미터 값 묶음 (물리명 → 값)
 * @returns 발행 전 전표 파일 (`kind: 'voucher'`, `issued: false`)
 *
 * @example
 * ```ts
 * const template = parseSlipFile(templateJson);
 * if (template.kind !== 'template') throw new Error('양식 파일이 아닙니다');
 * const voucher = buildVoucher(template, {
 *   tradeDate: '2026-08-24',
 *   items: [{ itemName: '연필', quantity: 12, unitPrice: 300, amount: 3600 }],
 * });
 * const pdf = await renderSlipToPdf(voucher, { fonts });
 * ```
 */
export function buildVoucher(
  template: SlipTemplateFile,
  values: Record<string, JsonValue>,
): SlipVoucherFile {
  const normalized = normalizeNumericParameters(
    clone(values),
    template.template.parameters,
  ) as Record<string, JsonValue>;
  return {
    schemaVersion: template.schemaVersion,
    kind: 'voucher',
    templateSnapshot: clone(template.template),
    values: normalized,
    issued: false,
  };
}
