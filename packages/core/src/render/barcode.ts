/**
 * 바코드 종류별 값 형식 검사.
 *
 * 렌더링 엔진은 형식에 맞지 않는 값을 조용히 건너뛰어 빈자리를 남기므로, 변환 계층에서
 * 같은 규칙으로 먼저 검사해 요소 이름을 담은 오류로 알린다. 규칙은 각 규격의 허용 문자와
 * 자릿수, GTIN 계열의 검사 숫자다.
 */
import type { BarcodeKind } from '../format/schema.js';

/** GTIN 계열(EAN·UPC·ITF-14)의 마지막 자리가 modulo-10 검사 숫자와 맞는지 확인한다. */
function passesCheckDigit(input: string, checkDigitPosition: number): boolean {
  // 검사 숫자 없이 한 자리 짧게 적은 값은 렌더링 엔진이 검사 숫자를 만들어 붙이므로 그대로 허용한다.
  if (input.length !== checkDigitPosition) return true;
  const digits = input.slice(0, -1).replace(/[^0-9]/g, '');
  let sum = 0;
  let weightThree = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * (weightThree ? 3 : 1);
    weightThree = !weightThree;
  }
  return String((10 - (sum % 10)) % 10) === input.slice(-1);
}

/** Code128에 넣을 수 없는 전각·가나·한자 문자 */
const CODE128_FORBIDDEN =
  /[゠-ヿ぀-ゟ々-〆ム-鿏]|[Ａ-Ｚａ-ｚ０-９！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝〜　]/;

/** QR 코드에 넣을 수 있는 최대 문자 수 */
const QR_MAX_LENGTH = 499;
/** PDF417에 넣을 수 있는 최대 문자 수 */
const PDF417_MAX_LENGTH = 1000;
/** GS1 DataMatrix 값의 최대 길이 */
const GS1_DATAMATRIX_MAX_LENGTH = 52;

/**
 * 바코드 종류에 맞는 값인지 검사한다.
 *
 * @param kind - 바코드 종류
 * @param value - 비어 있지 않은 바코드 값
 * @returns 그릴 수 있는 값이면 true
 */
export function isValidBarcodeValue(kind: BarcodeKind, value: string): boolean {
  if (value === '') return false;
  switch (kind) {
    case 'qrcode':
      return value.length <= QR_MAX_LENGTH;
    case 'japanpost':
      return /^(\d{7})(\d|[A-Z]|-)+$/.test(value);
    case 'ean13':
      return /^\d{12}$|^\d{13}$/.test(value) && passesCheckDigit(value, 13);
    case 'ean8':
      return /^\d{7}$|^\d{8}$/.test(value) && passesCheckDigit(value, 8);
    case 'code39':
      return /^(\d|[A-Z]|[-.$/+%]|\s)+$/.test(value);
    case 'code128':
      return !CODE128_FORBIDDEN.test(value);
    case 'nw7':
      return /^[A-Da-d]([0-9.$:/+-])+[A-Da-d]$/.test(value);
    case 'itf14':
      return /^\d{13}$|^\d{14}$/.test(value) && passesCheckDigit(value, 14);
    case 'upca':
      return /^\d{11}$|^\d{12}$/.test(value) && passesCheckDigit(value, 12);
    case 'upce':
      return /^0(\d{6}$|\d{7}$)/.test(value) && passesCheckDigit(value, 8);
    case 'gs1datamatrix': {
      const match = /\((01)\)(\d*)(\(|$)/.exec(value);
      if (match === null || value.length > GS1_DATAMATRIX_MAX_LENGTH) return false;
      const gtin = match[2] ?? '';
      if (![8, 12, 13, 14].includes(gtin.length)) return false;
      return passesCheckDigit(gtin, gtin.length);
    }
    case 'pdf417':
      return value.length <= PDF417_MAX_LENGTH;
  }
}
