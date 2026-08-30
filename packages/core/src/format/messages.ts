/**
 * 사용자에게 표시하는 `.slip` 검증·마이그레이션 메시지를 언어별로 정의한다.
 *
 * 파싱과 검증은 동기로 실행된다. 진입점은 {@link withFormatLocale}에서 언어를
 * 선택하고, 스키마와 마이그레이션 코드는 {@link fmt}에서 해당 메시지 사전을 읽는다.
 * 이 방식은 비동기 코드에 사용하지 않는다.
 */
import { ko as zodKo, ja as zodJa } from 'zod/locales';
import { resolveMessageLocale, type MessageLocale } from '../i18n.js';

/** `.slip` 검증·파싱·마이그레이션 메시지 목록 */
interface FormatMessages {
  colorFormat(): string;
  srcFormat(): string;
  semverFormat(): string;
  percentagesSum(): string;
  itemsPerPageMax(max: number): string;
  minItemsMax(max: number): string;
  maxItemsMax(max: number): string;
  columnsMax(max: number): string;
  rowsMax(max: number): string;
  cellsMax(max: number): string;
  bandsMax(max: number): string;
  bandFromAboveTo(bandId: string): string;
  bandOutOfRange(bandId: string, rows: number): string;
  bandsMustCoverRows(): string;
  bandOrderInvalid(bandId: string): string;
  bandItemExactlyOne(): string;
  bandPagesOnlyPageBands(bandId: string): string;
  bandRepeatOnlyGroupStart(bandId: string): string;
  bandNeedsGroupBy(bandId: string): string;
  duplicateBandId(bandId: string): string;
  groupByDuplicate(field: string): string;
  cellSourceExclusive(row: number, column: number): string;
  cellSpanOutOfRange(row: number, column: number, rows: number, columns: number): string;
  cellSpanCrossesBand(row: number, column: number): string;
  cellOverlaps(row: number, column: number): string;
  autoMergeNeedsRepeat(column: number): string;
  autoMergeNotCovered(column: number): string;
  flowAreaInvalid(): string;
  flowAreaOutOfPaper(bottom: number, height: number): string;
  afterTargetMissing(target: string): string;
  afterTargetCycle(): string;
  imageSourceRequired(): string;
  imageSourceExclusive(): string;
  barcodeSourceExclusive(): string;
  radiusWithDashedBorder(): string;
  polygonSidesMin(): string;
  polygonSidesMax(): string;
  fieldSourceExclusive(name: string): string;
  conditionalFormatEffectRequired(): string;
  conditionalFormatsMax(max: number): string;
  paddingTooLarge(): string;
  mimeTypeFormat(): string;
  elementsMax(max: number): string;
  subFieldsOnlyForList(): string;
  duplicateSubField(key: string): string;
  pagesMax(max: number): string;
  assetsMax(max: number): string;
  parametersMax(max: number): string;
  duplicateParameterKey(key: string): string;
  duplicateAssetId(id: string): string;
  assetSelfReference(id: string): string;
  missingAsset(id: string): string;
  duplicatePageKey(key: string): string;
  duplicateElementId(id: string): string;
  issuedExternalImage(): string;
  imageValueFormat(): string;
  envelopeInvalid(issues: string): string;
  bodyInvalid(issues: string): string;
  valueTooDeep(): string;
  invalidJson(): string;
  migrateSemver(): string;
  migrateNewer(version: string, current: string): string;
  migrateCycle(version: string): string;
  migrateNoPath(from: string, to: string): string;
}

const EN: FormatMessages = {
  colorFormat: () => 'Color must be in #RRGGBB or #RRGGBBAA format',
  srcFormat: () => 'src must be an http(s) URL, data:<mime>;base64 or asset:// reference',
  semverFormat: () => 'schemaVersion must be in semver format',
  percentagesSum: () => 'Percentages must add up to 100',
  itemsPerPageMax: (max) => `itemsPerPage can be at most ${max}`,
  minItemsMax: (max) => `minItems can be at most ${max}`,
  maxItemsMax: (max) => `maxItems can be at most ${max}`,
  columnsMax: (max) => `A grid can have at most ${max} columns`,
  rowsMax: (max) => `A grid can have at most ${max} rows`,
  cellsMax: (max) => `A grid can have at most ${max} cells`,
  bandsMax: (max) => `A grid can have at most ${max} row bands`,
  bandFromAboveTo: (bandId) => `Row band '${bandId}': fromRow cannot be greater than toRow`,
  bandOutOfRange: (bandId, rows) => `Row band '${bandId}' is outside the rows (${rows})`,
  bandsMustCoverRows: () => 'Row bands must cover every row exactly once, without gaps or overlaps',
  bandOrderInvalid: (bandId) =>
    `Row band '${bandId}' is out of order — bands must follow before-data, page-start, group-start, item, group-end, after-data, page-end`,
  bandItemExactlyOne: () => 'A repeating grid needs exactly one item band',
  bandPagesOnlyPageBands: (bandId) =>
    `Row band '${bandId}': pages can only be set on page-start and page-end bands`,
  bandRepeatOnlyGroupStart: (bandId) =>
    `Row band '${bandId}': repeatOnPageBreak can only be set on group-start bands`,
  bandNeedsGroupBy: (bandId) => `Row band '${bandId}' requires groupBy on the repeat settings`,
  duplicateBandId: (bandId) => `Row band id '${bandId}' is used more than once`,
  groupByDuplicate: (field) => `groupBy field '${field}' is duplicated`,
  cellSourceExclusive: (row, column) =>
    `Cell (${row},${column}) can have only one of content, parameter or formula`,
  cellSpanOutOfRange: (row, column, rows, columns) =>
    `The merge span of cell (${row},${column}) is outside the grid (${rows}×${columns})`,
  cellSpanCrossesBand: (row, column) =>
    `The merge of cell (${row},${column}) crosses a row band boundary`,
  cellOverlaps: (row, column) => `Cell (${row},${column}) overlaps another cell`,
  autoMergeNeedsRepeat: (column) => `Auto merge on column ${column} requires repeat settings`,
  autoMergeNotCovered: (column) =>
    `Auto merge on column ${column} requires the column's item-band cell to cover the whole band height`,
  flowAreaInvalid: () => 'flowArea.top must be smaller than flowArea.bottom',
  flowAreaOutOfPaper: (bottom, height) =>
    `flowArea.bottom (${bottom}) cannot exceed the paper height (${height})`,
  afterTargetMissing: (target) =>
    `pagePlacement.target '${target}' must reference an element on the same page`,
  afterTargetCycle: () => 'pagePlacement.after references form a cycle',
  imageSourceRequired: () => 'An image requires either src or parameter',
  imageSourceExclusive: () => 'An image cannot have both src and parameter',
  barcodeSourceExclusive: () => 'A barcode must have exactly one of content, parameter or formula',
  radiusWithDashedBorder: () => 'radius cannot be combined with a dashed or dotted border',
  polygonSidesMin: () => 'The number of sides must be at least 3',
  polygonSidesMax: () => 'The number of sides can be at most 12',
  fieldSourceExclusive: (name) => `Field '${name}' must have exactly one of parameter or formula`,
  conditionalFormatEffectRequired: () =>
    'A conditional format rule must set at least one of fontColor, backgroundColor, borderColor, bold, italic, underline or strikethrough',
  conditionalFormatsMax: (max) => `At most ${max} conditional format rules are allowed`,
  paddingTooLarge: () => 'The paddings must add up to less than the paper size',
  mimeTypeFormat: () => 'Not a valid mimeType',
  elementsMax: (max) => `A page can have at most ${max} elements`,
  subFieldsOnlyForList: () => "Sub-fields are only allowed on parameters whose valueType is 'list'",
  duplicateSubField: (key) => `Duplicate sub-field name: ${key}`,
  pagesMax: (max) => `A document can have at most ${max} pages`,
  assetsMax: (max) => `A document can have at most ${max} assets`,
  parametersMax: (max) => `At most ${max} parameter definitions are allowed`,
  duplicateParameterKey: (key) => `Duplicate parameter key: ${key}`,
  duplicateAssetId: (id) => `Duplicate asset id: ${id}`,
  assetSelfReference: (id) => `An asset references itself: ${id}`,
  missingAsset: (id) => `Referenced asset does not exist: ${id}`,
  duplicatePageKey: (key) => `Duplicate page key: ${key}`,
  duplicateElementId: (id) => `Duplicate element id: ${id}`,
  issuedExternalImage: () =>
    'An issued voucher cannot contain external URL images (embed as base64)',
  imageValueFormat: () => 'A dynamic image value must be in data:<mime>;base64 format',
  envelopeInvalid: (issues) => `.slip envelope validation failed: ${issues}`,
  bodyInvalid: (issues) => `.slip body validation failed: ${issues}`,
  valueTooDeep: () => 'The values in the .slip body are nested too deeply',
  invalidJson: () => 'Not valid JSON',
  migrateSemver: () => 'schemaVersion is not in semver format',
  migrateNewer: (version, current) =>
    `This file's schemaVersion (${version}) is newer than the supported version (${current}). Update the library.`,
  migrateCycle: (version) => `The migration path contains a cycle: ${version}`,
  migrateNoPath: (from, to) => `There is no migration path from schemaVersion ${from} to ${to}`,
};

const KO: FormatMessages = {
  colorFormat: () => '색상은 #RRGGBB 또는 #RRGGBBAA 형식이어야 합니다',
  srcFormat: () => 'src는 http(s) URL, data:<mime>;base64 또는 asset:// 형식이어야 합니다',
  semverFormat: () => 'schemaVersion은 semver 형식이어야 합니다',
  percentagesSum: () => '비율의 합은 100이어야 합니다',
  itemsPerPageMax: (max) => `itemsPerPage는 최대 ${max}입니다`,
  minItemsMax: (max) => `minItems는 최대 ${max}입니다`,
  maxItemsMax: (max) => `maxItems는 최대 ${max}입니다`,
  columnsMax: (max) => `열 수는 최대 ${max}개입니다`,
  rowsMax: (max) => `행 수는 최대 ${max}개입니다`,
  cellsMax: (max) => `셀 수는 최대 ${max}개입니다`,
  bandsMax: (max) => `행 구간은 최대 ${max}개입니다`,
  bandFromAboveTo: (bandId) => `행 구간 '${bandId}': fromRow는 toRow보다 클 수 없습니다`,
  bandOutOfRange: (bandId, rows) => `행 구간 '${bandId}'이(가) 행 수(${rows})를 벗어납니다`,
  bandsMustCoverRows: () => '행 구간은 모든 행을 겹침과 빈틈 없이 정확히 한 번씩 포함해야 합니다',
  bandOrderInvalid: (bandId) =>
    `행 구간 '${bandId}'의 순서가 잘못되었습니다 — before-data, page-start, group-start, item, group-end, after-data, page-end 순서를 따라야 합니다`,
  bandItemExactlyOne: () => '반복 그리드에는 item 구간이 정확히 하나 필요합니다',
  bandPagesOnlyPageBands: (bandId) =>
    `행 구간 '${bandId}': pages는 page-start와 page-end 구간에만 지정할 수 있습니다`,
  bandRepeatOnlyGroupStart: (bandId) =>
    `행 구간 '${bandId}': repeatOnPageBreak는 group-start 구간에만 지정할 수 있습니다`,
  bandNeedsGroupBy: (bandId) => `행 구간 '${bandId}'은(는) 반복 설정에 groupBy가 있어야 사용할 수 있습니다`,
  duplicateBandId: (bandId) => `행 구간 id '${bandId}'이(가) 중복되었습니다`,
  groupByDuplicate: (field) => `groupBy 필드 '${field}'이(가) 중복되었습니다`,
  cellSourceExclusive: (row, column) => `셀(${row},${column})은 content·parameter·formula 중 하나만 가질 수 있습니다`,
  cellSpanOutOfRange: (row, column, rows, columns) =>
    `셀(${row},${column})의 병합 범위가 그리드(${rows}×${columns})를 벗어납니다`,
  cellSpanCrossesBand: (row, column) => `셀(${row},${column})의 병합이 행 구간 경계를 넘습니다`,
  cellOverlaps: (row, column) => `셀(${row},${column})이 다른 셀과 겹칩니다`,
  autoMergeNeedsRepeat: (column) => `${column}열의 자동 병합은 반복 설정이 있어야 켤 수 있습니다`,
  autoMergeNotCovered: (column) =>
    `${column}열의 자동 병합은 그 열의 항목 구간 셀이 구간 전체 높이를 차지할 때만 켤 수 있습니다`,
  flowAreaInvalid: () => 'flowArea.top은 flowArea.bottom보다 작아야 합니다',
  flowAreaOutOfPaper: (bottom, height) => `flowArea.bottom(${bottom})은 용지 높이(${height})를 넘을 수 없습니다`,
  afterTargetMissing: (target) => `pagePlacement.target '${target}'은(는) 같은 페이지의 요소를 가리켜야 합니다`,
  afterTargetCycle: () => 'pagePlacement의 after 참조가 순환합니다',
  imageSourceRequired: () => '이미지는 src 또는 parameter 중 하나가 필요합니다',
  imageSourceExclusive: () => '이미지는 src와 parameter를 함께 가질 수 없습니다',
  barcodeSourceExclusive: () => '바코드는 content·parameter·formula 중 하나만 가져야 합니다',
  radiusWithDashedBorder: () => 'radius와 파선·점선 테두리는 함께 지정할 수 없습니다',
  polygonSidesMin: () => '다각형의 변은 3개 이상이어야 합니다',
  polygonSidesMax: () => '다각형의 변은 최대 12개입니다',
  fieldSourceExclusive: (name) => `필드 '${name}'는 parameter·formula 중 하나만 가져야 합니다`,
  conditionalFormatEffectRequired: () =>
    '조건부 서식 규칙은 색(fontColor·backgroundColor·borderColor)이나 강조(bold·italic·underline·strikethrough)를 하나 이상 지정해야 합니다',
  conditionalFormatsMax: (max) => `조건부 서식 규칙은 최대 ${max}개입니다`,
  paddingTooLarge: () => '여백의 합이 용지 크기보다 작아야 합니다',
  mimeTypeFormat: () => 'mimeType 값의 형식이 올바르지 않습니다',
  elementsMax: (max) => `페이지당 요소는 최대 ${max}개입니다`,
  subFieldsOnlyForList: () => "하위 필드는 valueType이 'list'인 파라미터에만 둘 수 있습니다",
  duplicateSubField: (key) => `하위 필드 이름이 중복됩니다: ${key}`,
  pagesMax: (max) => `페이지는 최대 ${max}개입니다`,
  assetsMax: (max) => `에셋은 최대 ${max}개입니다`,
  parametersMax: (max) => `파라미터 정의는 최대 ${max}개입니다`,
  duplicateParameterKey: (key) => `파라미터 키가 중복됩니다: ${key}`,
  duplicateAssetId: (id) => `에셋 ID가 중복됩니다: ${id}`,
  assetSelfReference: (id) => `에셋이 자기 자신을 참조합니다: ${id}`,
  missingAsset: (id) => `참조하는 에셋이 없습니다: ${id}`,
  duplicatePageKey: (key) => `페이지 키가 중복됩니다: ${key}`,
  duplicateElementId: (id) => `요소 ID가 중복됩니다: ${id}`,
  issuedExternalImage: () =>
    '발행된 전표(issued: true)에는 외부 URL 이미지를 포함할 수 없습니다. 이미지를 base64로 포함해야 합니다',
  imageValueFormat: () => '변동 이미지 값은 data:<mime>;base64 형식이어야 합니다',
  envelopeInvalid: (issues) => `.slip 봉투 검증 실패: ${issues}`,
  bodyInvalid: (issues) => `.slip 본문 검증 실패: ${issues}`,
  valueTooDeep: () => '.slip 본문에 포함된 값의 중첩이 너무 깊습니다',
  invalidJson: () => '유효한 JSON이 아닙니다',
  migrateSemver: () => 'schemaVersion이 semver 형식이 아닙니다',
  migrateNewer: (version, current) =>
    `이 파일의 schemaVersion(${version})은 지원 버전(${current})보다 새롭습니다. 라이브러리를 업데이트하세요.`,
  migrateCycle: (version) => `마이그레이션 경로에 순환이 있습니다: ${version}`,
  migrateNoPath: (from, to) =>
    `schemaVersion ${from}에서 ${to} 버전으로 변환하는 마이그레이션 경로가 없습니다`,
};

const JA: FormatMessages = {
  colorFormat: () => '色は #RRGGBB または #RRGGBBAA 形式でなければなりません',
  srcFormat: () => 'src は http(s) URL、data:<mime>;base64 または asset:// 形式でなければなりません',
  semverFormat: () => 'schemaVersion は semver 形式でなければなりません',
  percentagesSum: () => '比率の合計は 100 でなければなりません',
  itemsPerPageMax: (max) => `itemsPerPage は最大 ${max} です`,
  minItemsMax: (max) => `minItems は最大 ${max} です`,
  maxItemsMax: (max) => `maxItems は最大 ${max} です`,
  columnsMax: (max) => `列数は最大 ${max} 個です`,
  rowsMax: (max) => `行数は最大 ${max} 個です`,
  cellsMax: (max) => `セル数は最大 ${max} 個です`,
  bandsMax: (max) => `行範囲は最大 ${max} 個です`,
  bandFromAboveTo: (bandId) => `行範囲 '${bandId}': fromRow は toRow より大きくできません`,
  bandOutOfRange: (bandId, rows) => `行範囲 '${bandId}' が行数(${rows})を超えています`,
  bandsMustCoverRows: () => '行範囲は重なりや抜けなく、すべての行をちょうど 1 回ずつ含める必要があります',
  bandOrderInvalid: (bandId) =>
    `行範囲 '${bandId}' の順序が正しくありません — before-data, page-start, group-start, item, group-end, after-data, page-end の順序に従う必要があります`,
  bandItemExactlyOne: () => '繰り返しグリッドには item 範囲がちょうど 1 つ必要です',
  bandPagesOnlyPageBands: (bandId) =>
    `行範囲 '${bandId}': pages は page-start と page-end の範囲にのみ指定できます`,
  bandRepeatOnlyGroupStart: (bandId) =>
    `行範囲 '${bandId}': repeatOnPageBreak は group-start の範囲にのみ指定できます`,
  bandNeedsGroupBy: (bandId) => `行範囲 '${bandId}' は繰り返し設定に groupBy がある場合のみ使用できます`,
  duplicateBandId: (bandId) => `行範囲 id '${bandId}' が重複しています`,
  groupByDuplicate: (field) => `groupBy フィールド '${field}' が重複しています`,
  cellSourceExclusive: (row, column) =>
    `セル(${row},${column})は content・parameter・formula のいずれか 1 つだけ持てます`,
  cellSpanOutOfRange: (row, column, rows, columns) =>
    `セル(${row},${column})の結合範囲がグリッド(${rows}×${columns})を超えています`,
  cellSpanCrossesBand: (row, column) => `セル(${row},${column})の結合が行範囲の境界を越えています`,
  cellOverlaps: (row, column) => `セル(${row},${column})が他のセルと重なっています`,
  autoMergeNeedsRepeat: (column) => `${column}列の自動結合は繰り返し設定がある場合のみ有効にできます`,
  autoMergeNotCovered: (column) =>
    `${column}列の自動結合はその列の項目範囲セルが範囲全体の高さを占める場合のみ有効にできます`,
  flowAreaInvalid: () => 'flowArea.top は flowArea.bottom より小さくなければなりません',
  flowAreaOutOfPaper: (bottom, height) => `flowArea.bottom(${bottom})は用紙の高さ(${height})を超えられません`,
  afterTargetMissing: (target) => `pagePlacement.target '${target}' は同じページの要素を参照する必要があります`,
  afterTargetCycle: () => 'pagePlacement の after 参照が循環しています',
  imageSourceRequired: () => '画像には src または parameter のどちらか一方が必要です',
  imageSourceExclusive: () => '画像は src と parameter を同時に持てません',
  barcodeSourceExclusive: () => 'バーコードは content・parameter・formula のいずれか 1 つだけ持てます',
  radiusWithDashedBorder: () => 'radius は破線・点線の枠線と同時に指定できません',
  polygonSidesMin: () => '辺の数は 3 以上でなければなりません',
  polygonSidesMax: () => '辺の数は最大 12 です',
  fieldSourceExclusive: (name) => `フィールド '${name}' は parameter・formula のいずれか 1 つだけ持てます`,
  conditionalFormatEffectRequired: () =>
    '条件付き書式のルールは色(fontColor・backgroundColor・borderColor)または強調(bold・italic・underline・strikethrough)を 1 つ以上指定しなければなりません',
  conditionalFormatsMax: (max) => `条件付き書式のルールは最大 ${max} 個です`,
  paddingTooLarge: () => '余白の合計は用紙サイズより小さくなければなりません',
  mimeTypeFormat: () => 'mimeType の形式ではありません',
  elementsMax: (max) => `1 ページの要素は最大 ${max} 個です`,
  subFieldsOnlyForList: () => "サブフィールドは valueType が 'list' のパラメータにのみ置けます",
  duplicateSubField: (key) => `サブフィールド名が重複しています: ${key}`,
  pagesMax: (max) => `ページは最大 ${max} 個です`,
  assetsMax: (max) => `アセットは最大 ${max} 個です`,
  parametersMax: (max) => `パラメータ定義は最大 ${max} 個です`,
  duplicateParameterKey: (key) => `パラメータ key が重複しています: ${key}`,
  duplicateAssetId: (id) => `アセット id が重複しています: ${id}`,
  assetSelfReference: (id) => `アセットが自分自身を参照しています: ${id}`,
  missingAsset: (id) => `参照先のアセットがありません: ${id}`,
  duplicatePageKey: (key) => `ページ key が重複しています: ${key}`,
  duplicateElementId: (id) => `要素 id が重複しています: ${id}`,
  issuedExternalImage: () => '発行(issued)された伝票は外部 URL の画像を含められません (base64 埋め込みが必要です)',
  imageValueFormat: () => '可変画像の値は data:<mime>;base64 形式でなければなりません',
  envelopeInvalid: (issues) => `.slip エンベロープの検証に失敗しました: ${issues}`,
  bodyInvalid: (issues) => `.slip 本文の検証に失敗しました: ${issues}`,
  valueTooDeep: () => '.slip 本文の値のネストが深すぎます',
  invalidJson: () => '有効な JSON ではありません',
  migrateSemver: () => 'schemaVersion が semver 形式ではありません',
  migrateNewer: (version, current) =>
    `このファイルの schemaVersion(${version})は対応バージョン(${current})より新しいです。ライブラリを更新してください。`,
  migrateCycle: (version) => `マイグレーション経路に循環があります: ${version}`,
  migrateNoPath: (from, to) => `schemaVersion ${from} から ${to} へのマイグレーション経路がありません`,
};

const CATALOG: Record<MessageLocale, FormatMessages> = { en: EN, ko: KO, ja: JA };

// 동기 실행 중 사용할 메시지 사전을 모듈 상태로 유지한다.
let current: FormatMessages = EN;
let currentLocale: MessageLocale = 'en';

/**
 * 지정한 로케일의 메시지 사전을 사용해 함수를 실행한다. 실행 후에는 이전 사전으로 복원한다.
 *
 * @param locale - BCP 47 로케일 (생략하면 현재 메시지 사전 유지)
 * @param fn - 실행할 동기 함수
 * @returns `fn`의 반환값
 */
export function withFormatLocale<T>(locale: string | undefined, fn: () => T): T {
  if (locale === undefined) return fn();
  const previousMessages = current;
  const previousLocale = currentLocale;
  currentLocale = resolveMessageLocale(locale);
  current = CATALOG[currentLocale];
  try {
    return fn();
  } finally {
    current = previousMessages;
    currentLocale = previousLocale;
  }
}

/** 현재 선택된 `.slip` 형식 메시지 사전 */
export function fmt(): FormatMessages {
  return current;
}

/** Zod 로케일이 제공하는 내장 메시지 변환 함수 타입 */
type ZodErrorMap = NonNullable<ReturnType<typeof zodKo>['localeError']>;

// 필수 값 누락과 타입 불일치 등 Zod 내장 메시지에 적용할 언어별 파싱 옵션.
// 스키마에 직접 지정한 메시지가 이 옵션보다 우선한다.
const ZOD_PARSE_PARAMS: Record<MessageLocale, { error?: ZodErrorMap }> = {
  en: {},
  ko: { error: zodKo().localeError },
  ja: { error: zodJa().localeError },
};

/** 현재 선택된 언어의 Zod `safeParse` 옵션 (영어이면 빈 객체) */
export function zodParseParams(): { error?: ZodErrorMap } {
  return ZOD_PARSE_PARAMS[currentLocale];
}
