/**
 * 바코드 종류 목록과 규격 제약.
 *
 * @remarks
 * 호스트가 종류를 제한하지 않으면 이 목록을 그대로 쓴다.
 */

import type { BarcodeKind } from '@omdc-slipkit/core';

/**
 * 바코드 종류의 표시 순서와 이름.
 * 국제 표준 이름을 사용하므로 로케일별 문구로 관리하지 않는다.
 */
export const BARCODE_KINDS: readonly { value: BarcodeKind; label: string }[] = [
  { value: 'qrcode', label: 'QR Code' },
  { value: 'code128', label: 'CODE128' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'code39', label: 'CODE39' },
  { value: 'ean8', label: 'EAN-8' },
  { value: 'upca', label: 'UPC-A' },
  { value: 'upce', label: 'UPC-E' },
  { value: 'itf14', label: 'ITF-14' },
  { value: 'nw7', label: 'NW-7 (CODABAR)' },
  { value: 'japanpost', label: 'Japan Post' },
  { value: 'gs1datamatrix', label: 'GS1 DataMatrix' },
  { value: 'pdf417', label: 'PDF417' },
];

/** 캔버스에서 정사각형 격자로 표시할 2차원 바코드 종류 */
export const BARCODE_2D: ReadonlySet<BarcodeKind> = new Set(['qrcode', 'gs1datamatrix']);

/**
 * 편집 중인 고정 바코드 값의 형식을 검사한다.
 * 길이가 정해진 종류와 CODE39만 검사하며 파라미터와 수식 값은 검사하지 않는다.
 */
export const BARCODE_DIGIT_RULES: Partial<Record<BarcodeKind, number>> = {
  ean13: 13, ean8: 8, upca: 12, itf14: 14,
};
