/**
 * 전표 값을 파라미터 정의에 맞춰 정규화한다.
 *
 * 수식은 문자열을 숫자로 자동 변환하지 않으므로 `number` 파라미터의 빈 값은 입력 단계에서
 * 0으로 변환한다. 작성 폼, 미리보기, PDF 렌더러는 이 규칙을 함께 사용한다.
 */
import type { ParameterDef } from './schema.js';

/**
 * `number` 파라미터의 빈 값(미입력, null, 빈 문자열)을 0으로 변환한다.
 *
 * @remarks
 * 변경할 값이 없으면 입력 객체를 반환하고, 변경이 필요할 때만 얕은 복사본을 만든다.
 * 값 종류가 정의된 최상위 파라미터만 처리한다.
 *
 * @param values - 전표 값 묶음
 * @param parameters - 파라미터 정의. 생략하면 입력 값을 반환한다
 * @returns 정규화된 값 묶음 (바뀐 것이 없으면 원본과 동일한 참조)
 */
export function normalizeNumericParameters(
  values: Record<string, unknown>,
  parameters?: readonly ParameterDef[],
): Record<string, unknown> {
  if (!parameters?.length) return values;
  let out: Record<string, unknown> | undefined;
  for (const parameter of parameters) {
    if (parameter.valueType !== 'number') continue;
    const value = values[parameter.key];
    if (value === undefined || value === null || value === '') {
      if (!out) out = { ...values };
      out[parameter.key] = 0;
    }
  }
  return out ?? values;
}
