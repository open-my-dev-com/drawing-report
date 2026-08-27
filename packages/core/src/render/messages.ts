/**
 * 사용자에게 표시하는 렌더링 메시지를 언어별로 정의한다.
 *
 * 렌더링은 비동기로 실행되므로 언어를 모듈 상태에 저장하지 않는다.
 * 호출자가 전달한 로케일로 {@link rm}에서 메시지 사전을 선택한다.
 * `subject*` 함수는 오류가 발생한 요소를 언어에 맞는 명사구로 만든다.
 */
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

/** 렌더링 오류 메시지 목록. `what`은 `subject*`로 만든 대상 이름이다. */
interface RenderMessages {
  subjectField(name: string, id: string): string;
  subjectGrid(name: string, id: string): string;
  subjectGridCell(name: string, id: string, row: number, column: number): string;
  subjectImage(name: string, id: string): string;
  subjectBarcode(name: string, id: string): string;
  notFinite(what: string): string;
  notText(what: string): string;
  formulaFailed(what: string, reason: string): string;
  repeatNotArray(what: string, parameter: string): string;
  repeatItemNotObject(what: string, index: number): string;
  noImageSource(what: string): string;
  missingAsset(what: string, assetId: string): string;
  assetNotEmbedded(what: string, assetId: string): string;
  externalUrl(what: string, src: string): string;
  imageValueNotString(what: string, parameter: string): string;
  imageValueNotData(what: string, parameter: string): string;
  multipleFallbackFonts(): string;
  duplicateFontName(): string;
}

const EN: RenderMessages = {
  subjectField: (name, id) => `field '${name}' (${id})`,
  subjectGrid: (name, id) => `grid '${name}' (${id})`,
  subjectGridCell: (name, id, row, column) => `cell (${row},${column}) of grid '${name}' (${id})`,
  subjectImage: (name, id) => `image '${name}' (${id})`,
  subjectBarcode: (name, id) => `barcode '${name}' (${id})`,
  notFinite: (what) => `The value of ${what} is not a finite number`,
  notText: (what) => `The value of ${what} is an array or object and cannot be shown as text`,
  formulaFailed: (what, reason) => `Failed to evaluate the formula of ${what}: ${reason}`,
  repeatNotArray: (what, parameter) => `The repeat value '${parameter}' of ${what} must be an array of objects`,
  repeatItemNotObject: (what, index) => `Item ${index} of ${what} must be an object`,
  noImageSource: (what) => `${what} has no image to draw (src or parameter required)`,
  missingAsset: (what, assetId) => `The asset referenced by ${what} does not exist: ${assetId}`,
  assetNotEmbedded: (what, assetId) =>
    `The asset '${assetId}' referenced by ${what} is not embedded in the file (data: base64 required)`,
  externalUrl: (what, src) =>
    `${what} references an external URL (${src}). To render a PDF, embed the image in the file (data: base64 or asset://)`,
  imageValueNotString: (what, parameter) => `The value '${parameter}' of ${what} must be an image string`,
  imageValueNotData: (what, parameter) =>
    `The value '${parameter}' of ${what} must be data: base64 (the host must embed URLs before sending)`,
  multipleFallbackFonts: () => 'Only one fallback font can be specified',
  duplicateFontName: () => 'Duplicate font name',
};

const KO: RenderMessages = {
  subjectField: (name, id) => `필드 '${name}' (${id})`,
  subjectGrid: (name, id) => `그리드 '${name}' (${id})`,
  subjectGridCell: (name, id, row, column) => `그리드 '${name}' (${id})의 셀 (${row},${column})`,
  subjectImage: (name, id) => `이미지 '${name}' (${id})`,
  subjectBarcode: (name, id) => `바코드 '${name}' (${id})`,
  notFinite: (what) => `${what}의 값이 유한한 수가 아닙니다`,
  notText: (what) => `${what}의 값은 배열 또는 객체이므로 텍스트로 표시할 수 없습니다`,
  formulaFailed: (what, reason) => `${what}의 수식을 계산하지 못했습니다: ${reason}`,
  repeatNotArray: (what, parameter) => `${what}의 반복 값은 객체 배열이어야 합니다: ${parameter}`,
  repeatItemNotObject: (what, index) => `${what}의 ${index}번째 항목은 객체여야 합니다`,
  noImageSource: (what) => `${what}에 사용할 이미지가 없습니다. src 또는 parameter를 지정하세요`,
  missingAsset: (what, assetId) => `${what}에서 참조하는 에셋을 찾을 수 없습니다: ${assetId}`,
  assetNotEmbedded: (what, assetId) =>
    `${what}에서 참조한 에셋 '${assetId}'가 파일에 포함되어 있지 않습니다. data: base64 형식의 데이터가 필요합니다`,
  externalUrl: (what, src) =>
    `${what}에서 외부 URL 이미지를 참조하고 있습니다: ${src}. PDF로 출력하려면 이미지를 data: base64 또는 asset:// 형식으로 전달해야 합니다`,
  imageValueNotString: (_what, parameter) => `파라미터 '${parameter}'의 이미지 값은 문자열이어야 합니다`,
  imageValueNotData: (what, parameter) =>
    `파라미터 '${parameter}'의 이미지 값은 data: base64 형식이어야 합니다. ${what}에 사용할 외부 URL은 호스트에서 base64로 변환해 전달해야 합니다`,
  multipleFallbackFonts: () => '대체 폰트(fallback)는 하나만 지정할 수 있습니다',
  duplicateFontName: () => '폰트 이름이 중복되었습니다',
};

const JA: RenderMessages = {
  subjectField: (name, id) => `フィールド '${name}'(${id})`,
  subjectGrid: (name, id) => `グリッド '${name}'(${id})`,
  subjectGridCell: (name, id, row, column) => `グリッド '${name}'(${id})のセル(${row},${column})`,
  subjectImage: (name, id) => `画像 '${name}'(${id})`,
  subjectBarcode: (name, id) => `バーコード '${name}'(${id})`,
  notFinite: (what) => `${what}の値が有限な数ではありません`,
  notText: (what) => `${what}の値は配列・オブジェクトのためテキストとして表示できません`,
  formulaFailed: (what, reason) => `${what}の数式を計算できませんでした: ${reason}`,
  repeatNotArray: (what, parameter) => `${what}の繰り返し値 '${parameter}' はオブジェクトの配列でなければなりません`,
  repeatItemNotObject: (what, index) => `${what}の ${index} 番目の項目はオブジェクトでなければなりません`,
  noImageSource: (what) => `${what}に描く画像がありません (src または parameter が必要です)`,
  missingAsset: (what, assetId) => `${what}が参照するアセットが見つかりません: ${assetId}`,
  assetNotEmbedded: (what, assetId) =>
    `${what}が参照するアセット '${assetId}' はファイルに埋め込まれていません (data: base64 が必要です)`,
  externalUrl: (what, src) =>
    `${what}は外部 URL(${src})を参照しています。PDF に出力するには画像をファイルに埋め込む必要があります (data: base64 または asset://)`,
  imageValueNotString: (what, parameter) => `${what}の値 '${parameter}' は画像の文字列でなければなりません`,
  imageValueNotData: (what, parameter) =>
    `${what}の値 '${parameter}' は data: base64 でなければなりません (URL はホストが埋め込んで渡します)`,
  multipleFallbackFonts: () => '代替(fallback)フォントは 1 つだけ指定できます',
  duplicateFontName: () => 'フォント名が重複しています',
};

const CATALOG: Record<MessageLocale, RenderMessages> = { en: EN, ko: KO, ja: JA };

/**
 * 로케일에 맞는 렌더링 메시지 사전을 반환한다.
 *
 * @param locale - BCP 47 로케일 (생략하면 영어)
 * @returns 메시지 사전
 */
export function rm(locale?: string): RenderMessages {
  return CATALOG[resolveMessageLocale(locale)];
}
