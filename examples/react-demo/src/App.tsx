/**
 * SlipKit React 데모 — 양식을 만들고, 전표를 쓰고, 파일로 주고받는 흐름 (F-22).
 *
 * 호스트 앱이 `@omdc-slipkit/react` 래퍼를 어떻게 붙이는지 보여준다.
 * 무엇을 저장하고 언제 이어 쓰는지는 바닐라·Vue 데모와 같은 `slipkit-demo-shared`를 쓴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlipDesigner, SlipForm } from '@omdc-slipkit/react';
import {
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import {
  AUTOSAVE_DELAY_MS,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  canResumeVoucher,
  createStores,
  initialTemplate,
  messages,
  restore,
  savedLabel,
  suggestedName,
  templateFromVoucher,
} from 'slipkit-demo-shared';

export function App() {
  // 저장소는 화면이 다시 그려져도 그대로 써야 하므로 한 번만 만든다
  const { store, localFile } = useMemo(() => createStores('slipkit-demo-react'), []);

  const [template, setTemplate] = useState<SlipTemplateFile>(() => initialTemplate());
  // 디자이너에 넣는 시작 입력 — 편집 중에는 바꾸지 않고, 외부 양식을 명시적으로 열 때만 갱신한다
  const [designerSrc, setDesignerSrc] = useState<string>(() => serializeSlipFile(template));
  const [voucher, setVoucher] = useState<SlipVoucherFile | null>(null);
  const [filling, setFilling] = useState(false);
  const [status, setStatus] = useState<string>(messages.welcome);
  const [autosave, setAutosave] = useState<string>('');
  // 전표 쓰기로 넘어간 시점의 파일 — 화면을 옮길 때만 새로 정한다
  const [formSrc, setFormSrc] = useState<string>('');
  const [booted, setBooted] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 자동 저장은 최신 값을 봐야 하므로 ref로도 들고 있는다
  const latest = useRef({ template, voucher });
  latest.current = { template, voucher };

  const saveNow = useCallback(async () => {
    try {
      await store.save(TEMPLATE_KEY, latest.current.template);
      if (latest.current.voucher) await store.save(VOUCHER_KEY, latest.current.voucher);
      setAutosave(savedLabel(new Date()));
    } catch (error) {
      setAutosave('');
      setStatus(messages.autosaveFailed(String(error)));
    }
  }, [store]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  /** 화면 전환 — 전표 쓰기로 갈 때 이어 쓸지 새로 시작할지 정한다 */
  const setMode = useCallback((fill: boolean, message?: string) => {
    setFilling(fill);
    localStorage.setItem(MODE_KEY, fill ? 'fill' : 'design');
    if (!fill) {
      setStatus(message ?? messages.design);
      return;
    }
    const current = latest.current;
    const continuing = canResumeVoucher(current.voucher);
    if (!continuing) setVoucher(null);
    setFormSrc(serializeSlipFile(continuing ? current.voucher! : current.template));
    setStatus(message ?? (continuing ? messages.fillContinue : messages.fillNew));
  }, []);

  // 시작 — 이전 작업이 있으면 그대로 이어서 연다
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedTemplate = await restore(store, TEMPLATE_KEY);
      const savedVoucher = await restore(store, VOUCHER_KEY);
      if (cancelled) return;
      const restored = savedTemplate?.kind === 'template';
      if (savedTemplate?.kind === 'template') {
        setTemplate(savedTemplate);
        latest.current.template = savedTemplate;
        setDesignerSrc(serializeSlipFile(savedTemplate));
      }
      if (savedVoucher?.kind === 'voucher') {
        setVoucher(savedVoucher);
        latest.current.voucher = savedVoucher;
      }
      setBooted(true);
      setMode(localStorage.getItem(MODE_KEY) === 'fill', restored ? messages.restored : messages.welcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, setMode]);

  const onDesignerChange = useCallback((file: SlipFile) => {
    if (file.kind !== 'template') return;
    setTemplate(file);
    latest.current.template = file;
    scheduleAutosave();
  }, [scheduleAutosave]);

  const onFormChange = useCallback((file: SlipFile) => {
    if (file.kind !== 'voucher') return;
    setVoucher(file);
    latest.current.voucher = file;
    scheduleAutosave();
  }, [scheduleAutosave]);

  const onFormIssue = useCallback((file: SlipFile) => {
    if (file.kind !== 'voucher') return;
    setVoucher(file);
    latest.current.voucher = file;
    void saveNow().then(() => setStatus(messages.issued));
  }, [saveNow]);

  /** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
  const activeFile = (): SlipFile => (filling && voucher ? voucher : template);

  const openDownloadDialog = (): void => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (filenameRef.current) filenameRef.current.value = suggestedName(activeFile());
    dialog.returnValue = 'cancel';
    dialog.showModal();
    filenameRef.current?.select();
  };

  const onDialogClose = (): void => {
    if (dialogRef.current?.returnValue !== 'ok') return;
    const file = activeFile();
    const name = filenameRef.current?.value.trim() || suggestedName(file);
    localFile
      .save(name, file)
      .then(() => setStatus(messages.downloaded(name)))
      .catch((error: unknown) => setStatus(messages.downloadFailed(String(error))));
  };

  const openFile = (): void => {
    localFile
      .load('')
      .then((file) => {
        if (file.kind === 'template') {
          setTemplate(file);
          setVoucher(null);
          latest.current = { template: file, voucher: null };
          setDesignerSrc(serializeSlipFile(file));
          setMode(false, messages.openedTemplate);
        } else {
          const fromVoucher = templateFromVoucher(file);
          setVoucher(file);
          setTemplate(fromVoucher);
          latest.current = { template: fromVoucher, voucher: file };
          setDesignerSrc(serializeSlipFile(fromVoucher));
          setFormSrc(serializeSlipFile(file));
          setFilling(true);
          localStorage.setItem(MODE_KEY, 'fill');
          setStatus(file.issued ? messages.openedIssued : messages.openedVoucher);
        }
        void saveNow();
      })
      .catch((error: unknown) => setStatus(messages.openFailed(String(error))));
  };

  const newSlip = (): void => {
    setVoucher(null);
    latest.current.voucher = null;
    void store.delete(VOUCHER_KEY).catch(() => undefined);
    setMode(true, messages.newSlip);
  };

  return (
    <>
      <header>
        <span className="title">SlipKit React 데모</span>
        <button aria-pressed={!filling} onClick={() => setMode(false)}>양식 만들기</button>
        <button aria-pressed={filling} onClick={() => setMode(true)}>전표 쓰기</button>
        <button hidden={!filling} onClick={newSlip}>새 전표</button>
        <span className="sep" />
        <button onClick={openDownloadDialog}>파일로 내려받기</button>
        <button onClick={openFile}>파일 열기</button>
        <span className="autosave">{autosave}</span>
        <span className="status">{status}</span>
      </header>

      <div className="pane" hidden={filling}>
        <SlipDesigner
          src={designerSrc}
          storage={store}
          onSlipChange={onDesignerChange}
        />
      </div>
      <div className="pane" hidden={!filling}>
        {booted && formSrc !== '' ? (
          <SlipForm src={formSrc} onSlipChange={onFormChange} onSlipIssue={onFormIssue} />
        ) : null}
      </div>

      <dialog ref={dialogRef} onClose={onDialogClose}>
        <form method="dialog">
          <h2>파일로 내려받기</h2>
          <div className="body">
            <label htmlFor="filename">파일 이름</label>
            <input id="filename" ref={filenameRef} name="filename" autoComplete="off" />
          </div>
          <div className="foot">
            <button value="cancel">취소</button>
            <button value="ok">내려받기</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
