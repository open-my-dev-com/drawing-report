/**
 * SlipKit 데모 — 디자이너·저장소 어댑터를 실제 사용 흐름 그대로 보여준다.
 * 여기 있는 코드가 곧 호스트 앱이 SlipKit을 붙이는 방법의 예시다.
 */
import { presets, IndexedDbStorage, LocalFileStorage } from '@omdc-slipkit/elements';
import { serializeSlipFile, SlipStorageError, type SlipFile } from '@omdc-slipkit/core';

const designer = document.getElementById('designer') as HTMLElement & { src: string };
const statusEl = document.getElementById('status')!;

function status(message: string): void {
  statusEl.textContent = message;
}

// 최초 화면은 거래명세서 프리셋으로 시작
let current: SlipFile = presets[0]!.create();
designer.src = serializeSlipFile(current);

// 디자이너에서 편집할 때마다 최신 파일을 받아 둔다
designer.addEventListener('slip-change', (event) => {
  current = (event as CustomEvent<{ file: SlipFile }>).detail.file;
  status('편집됨 (저장 안 됨)');
});

const DOC_ID = 'demo-template';
const idb = new IndexedDbStorage({ dbName: 'slipkit-demo' });
const local = new LocalFileStorage();

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
      designer.src = serializeSlipFile(file);
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
      designer.src = serializeSlipFile(file);
      status('.slip 파일을 열었습니다');
    })
    .catch((error: unknown) => status(`열기 실패: ${String(error)}`));
});
