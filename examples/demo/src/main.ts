/**
 * SlipKit 데모 — 디자이너·저장소 어댑터를 실제 사용 흐름 그대로 보여준다.
 * 여기 있는 코드가 곧 호스트 앱이 SlipKit을 붙이는 방법의 예시다.
 */
import { presets, IndexedDbStorage, LocalFileStorage } from '@omdc-slipkit/elements';
import { serializeSlipFile, SlipStorageError, type SlipFile } from '@omdc-slipkit/core';

const designer = document.getElementById('designer') as HTMLElement & { src: string };
const form = document.getElementById('form') as HTMLElement & { src: string };
const statusEl = document.getElementById('status')!;

function status(message: string): void {
  statusEl.textContent = message;
}

/** 최초 화면은 거래명세서 프리셋으로 시작 */
let current: SlipFile = presets[0]!.create();
designer.src = serializeSlipFile(current);

// 디자이너에서 편집할 때마다 최신 파일을 받아 둔다
designer.addEventListener('slip-change', (event) => {
  current = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  status('편집됨 (저장 안 됨)');
});

/** 양식 편집 ↔ 전표 작성 전환 — 작성 모드로 갈 때 지금 양식을 그대로 넘긴다 */
function setMode(fill: boolean): void {
  designer.hidden = fill;
  form.hidden = !fill;
  document.getElementById('mode-design')!.setAttribute('aria-pressed', String(!fill));
  document.getElementById('mode-fill')!.setAttribute('aria-pressed', String(fill));
  if (fill) {
    form.src = serializeSlipFile(current);
    status('전표를 작성한 뒤 발행하면 해시가 기록됩니다');
  } else {
    status('양식을 편집합니다');
  }
}

document.getElementById('mode-design')!.addEventListener('click', () => setMode(false));
document.getElementById('mode-fill')!.addEventListener('click', () => setMode(true));

// 발행된 전표는 그대로 저장·다운로드 대상이 된다 (무결성 기록 포함)
form.addEventListener('slip-issue', (event) => {
  current = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  status('전표를 발행했습니다 — 저장·다운로드하면 무결성 기록까지 함께 담깁니다');
});

const DOC_ID = 'demo-template';
const idb = new IndexedDbStorage({ dbName: 'slipkit-demo' });
const local = new LocalFileStorage();

// 디자이너의 "내 양식" 저장·목록도 같은 IndexedDB 어댑터를 쓴다 (D-15)
(designer as unknown as { storage: typeof idb }).storage = idb;

document.getElementById('save')!.addEventListener('click', () => {
  idb
    .save(DOC_ID, current)
    .then(() => status('IndexedDB에 저장했습니다'))
    .catch((error: unknown) => status(`저장 실패: ${String(error)}`));
});

document.getElementById('load')!.addEventListener('click', () => {
  idb
    .load(DOC_ID)
    .then((file) => {
      current = file;
      setMode(file.kind === 'voucher');
      if (file.kind === 'voucher') form.src = serializeSlipFile(file);
      else designer.src = serializeSlipFile(file);
      status('IndexedDB에서 불러왔습니다');
    })
    .catch((error: unknown) => {
      status(
        error instanceof SlipStorageError && error.code === 'not-found'
          ? '저장된 양식이 없습니다 — 먼저 저장해 보세요'
          : `불러오기 실패: ${String(error)}`,
      );
    });
});

document.getElementById('download')!.addEventListener('click', () => {
  local
    .save('데모양식', current)
    .then(() => status('.slip 파일을 다운로드했습니다'))
    .catch((error: unknown) => status(`다운로드 실패: ${String(error)}`));
});

document.getElementById('open')!.addEventListener('click', () => {
  local
    .load('')
    .then((file) => {
      current = file;
      setMode(file.kind === 'voucher');
      if (file.kind === 'voucher') form.src = serializeSlipFile(file);
      else designer.src = serializeSlipFile(file);
      status('.slip 파일을 열었습니다');
    })
    .catch((error: unknown) => status(`열기 실패: ${String(error)}`));
});
