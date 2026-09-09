/**
 * 공백뿐인 수식과 조건식을 판정합니다. 디자이너 캔버스, 자동 병합, 경고 집계와 작성 폼이 함께 씁니다.
 *
 * @remarks
 * 저장된 수식 문자열이 비었거나 공백만 있으면 PDF 변환은 빈 값으로 그리고 조건부 서식은 규칙을
 * 적용하지 않습니다. 화면도 같은 판정을 써서, 편집 중 비워 둔 수식이 캔버스·작성 폼에서만
 * "빈 수식" 오류로 보이지 않게 합니다. 실제 문법 오류만 오류로 표시합니다.
 */

/**
 * 수식·조건식이 비었거나 공백만 있는지 판정합니다.
 *
 * @param source - 판정할 수식이나 조건식입니다. `undefined`이면 수식이 없는 것으로 판단합니다.
 * @returns 비었거나 공백뿐이면 true
 */
export function isBlankFormula(source: string | undefined): boolean {
  return source === undefined || source.trim() === '';
}
