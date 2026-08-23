/**
 * 전표 값 정규화 (ADR-044).
 *
 * 수식은 숫자를 요구하는 자리에서 글자를 자동 변환하지 않는다(엄격 타입). 그래서
 * `number` 종류로 정의한 파라미터가 빈 값으로 들어오면(작성폼에서 칸을 비웠을 때 등)
 * 받는 시점에 0으로 바꿔 둔다 — 빈칸을 0으로 다루는 회계 양식 관례에 맞추고,
 * 미리보기·PDF·뷰어가 같은 값을 보게 한다.
 */
import type { ParameterDef } from './schema.js';

/**
 * `number` 종류 파라미터의 빈 값(미입력·null·빈 문자열)을 0으로 바꾼 값 묶음을 돌려준다.
 *
 * @remarks
 * 바뀔 값이 없으면 입력 객체를 그대로 돌려주고, 있을 때만 얕은 복사본을 만든다.
 * 최상위 파라미터만 다룬다 — 그리드 열에는 아직 종류 필드가 없다.
 *
 * @param values - 전표 값 묶음
 * @param parameters - 파라미터 정의부 (없으면 원본을 그대로 돌려준다)
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
