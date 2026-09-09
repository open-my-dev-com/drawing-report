/**
 * SlipKit React 데모입니다. 양식을 만들고, 전표를 작성하고, 발행된 전표를 확인하며, 파일로 주고받는 흐름을 보여 줍니다.
 *
 * 호스트 애플리케이션이 `@omdc-slipkit/react` 래퍼를 연결하는 방법을 보여 줍니다.
 * 무엇을 저장하고 언제 이어 쓰는지는 바닐라·Vue 데모와 같은 `slipkit-demo-shared`를 씁니다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlipDesigner, SlipForm, SlipViewer } from '@omdc-slipkit/react';
import {
  buildVoucher,
  createSlipKit,
  serializeSlipFile,
  type SlipFile,
  type SlipTemplateFile,
  type SlipVoucherFile,
} from '@omdc-slipkit/core';
import type { SlipDesignerSettings } from '@omdc-slipkit/elements';
import { loadDefaultFonts } from '@omdc-slipkit/elements';
import {
  AUTOSAVE_DELAY_MS,
  ISSUED_KEY,
  MODE_KEY,
  TEMPLATE_KEY,
  VOUCHER_KEY,
  asDemoMode,
  canResumeVoucher,
  createDemoStorageQueue,
  createStores,
  demoFontLocale,
  getMessages,
  initialTemplate,
  isCancelled,
  reasonOf,
  resolveDemoEncryption,
  resolveDemoLocale,
  restore,
  saveBytes,
  savedLabel,
  suggestedName,
  templateFromVoucher,
  usesDemoSampleKey,
  type DemoMode,
} from 'slipkit-demo-shared';

// 데모 언어는 주소의 ?locale= 값을 우선하며, 값이 없으면 빌드 설정을 사용합니다.
const locale = resolveDemoLocale(location.search, import.meta.env.VITE_SLIPKIT_LOCALE as string | undefined);
const messages = getMessages(locale);
document.documentElement.lang = locale ?? 'en';
document.title = messages.appTitle('React');

// 공통 설정은 여기 한 번만 적습니다. 컴포넌트, 자동 저장, 파일 주고받기, PDF 렌더링이
// 컴포넌트와 저장소는 모두 이 인스턴스의 폰트·로케일·암호화 키를 사용합니다.
// 암호화 키는 .env(VITE_SLIPKIT_KEY)에서 한 번 읽고, 없으면 데모 샘플 키를 명시적으로 씁니다.
const slipKit = createSlipKit({
  // 데모는 PDF 내려받기를 직접 렌더링하므로 동봉 기본 폰트를 명시적으로 제공합니다.
  // 컴포넌트 미리보기는 이 설정이 없어도 같은 기본 폰트를 사용합니다.
  getFonts: () => loadDefaultFonts(demoFontLocale(locale)),
  ...(locale === undefined ? {} : { locale }),
  encryption: resolveDemoEncryption(import.meta.env.VITE_SLIPKIT_KEY as string | undefined),
});

// 호스트가 제공한 용지 후보는 기본 용지 뒤에 표시됩니다.
// 바코드 종류(getBarcodeKinds)도 같은 방식으로 제공하고, 폰트는 위 createSlipKit의 getFonts로 제공합니다.
const designerSettings: SlipDesignerSettings = {
  getPaperSizes: () => [{ name: 'Label 100x150', width: 100, height: 150 }],
};

// 공개된 샘플 키를 사용하는 동안에만 화면에 키 경고를 표시합니다.
const sampleKey = usesDemoSampleKey(import.meta.env.VITE_SLIPKIT_KEY as string | undefined);

export function App() {
  // 저장소는 화면이 다시 그려져도 그대로 써야 하므로 한 번만 만듭니다.
  const { store, files } = useMemo(() => createStores(slipKit, 'slipkit-demo-react'), []);
  const storageQueue = useMemo(() => createDemoStorageQueue(store), [store]);

  const [template, setTemplate] = useState<SlipTemplateFile>(() => initialTemplate(locale));
  // 디자이너의 시작 입력은 편집 중에 바꾸지 않고, 외부 양식을 명시적으로 열 때만 갱신합니다.
  const [designerSrc, setDesignerSrc] = useState<string>(() => serializeSlipFile(template));
  const [voucher, setVoucher] = useState<SlipVoucherFile | null>(null);
  const [issued, setIssued] = useState<SlipVoucherFile | null>(null);
  const [mode, setMode] = useState<DemoMode>('design');
  const [status, setStatus] = useState<string>(messages.welcome);
  const [autosave, setAutosave] = useState<string>('');
  // 전표 작성·조회 화면으로 전환할 때만 파일을 새로 정합니다.
  const [formSrc, setFormSrc] = useState<string>('');
  // 새 전표를 시작할 때마다 SlipForm을 다시 마운트하기 위해 세션 번호를 증가시킵니다.
  const [formSession, setFormSession] = useState(0);
  const [viewerSrc, setViewerSrc] = useState<string>('');
  const [booted, setBooted] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 자동 저장은 최신 값을 봐야 하므로 ref로도 들고 있습니다.
  const latest = useRef({ template, voucher, issued });
  latest.current = { template, voucher, issued };

  /** 자동 저장 정리 작업의 실패도 자동 저장 실패와 같은 수준으로 알립니다. */
  const reportStorageFailure = useCallback((error: unknown) => {
    setStatus(messages.autosaveFailed(reasonOf(error)));
  }, []);

  const saveNow = useCallback(async () => {
    try {
      const current = latest.current;
      await storageQueue.save([
        [TEMPLATE_KEY, current.template],
        ...(current.voucher ? [[VOUCHER_KEY, current.voucher] as const] : []),
      ]);
      setAutosave(savedLabel(new Date(), locale));
    } catch (error) {
      setAutosave('');
      setStatus(messages.autosaveFailed(reasonOf(error)));
    }
  }, [storageQueue]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  /** 예약해 둔 자동 저장을 취소합니다. */
  const cancelAutosave = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** 양식 편집, 전표 작성, 발행 전표 조회 화면을 전환합니다. */
  const switchMode = useCallback((next: DemoMode, message?: string) => {
    const current = latest.current;
    // 발행된 전표가 없으면 조회 화면을 열 수 없습니다.
    if (next === 'view' && !current.issued) next = 'design';
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
    if (next === 'fill') {
      const continuing = canResumeVoucher(current.voucher);
      // 이어 쓸 전표가 없으면 buildVoucher로 양식에서 빈 전표를 만들어 시작합니다.
      const target = continuing ? current.voucher! : buildVoucher(current.template, {});
      if (!continuing) {
        setVoucher(target);
        latest.current.voucher = target;
        // 새 전표는 SlipForm을 다시 마운트해 시작합니다. 같은 양식이면 `src`가 그대로라 발행 상태가 해제되지 않습니다.
        setFormSession((session) => session + 1);
      }
      setFormSrc(serializeSlipFile(target));
      setStatus(message ?? (continuing ? messages.fillContinue : messages.fillNew));
    } else if (next === 'view') {
      setViewerSrc(serializeSlipFile(current.issued!));
      setStatus(message ?? messages.viewing);
    } else {
      setStatus(message ?? messages.design);
    }
  }, []);

  // 저장된 작업이 있으면 이어서 엽니다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedTemplate = await restore(store, TEMPLATE_KEY);
      const savedVoucher = await restore(store, VOUCHER_KEY);
      const savedIssued = await restore(store, ISSUED_KEY);
      if (cancelled) return;
      const restored = savedTemplate?.kind === 'template';
      if (savedTemplate?.kind === 'template') {
        setTemplate(savedTemplate);
        latest.current.template = savedTemplate;
        setDesignerSrc(serializeSlipFile(savedTemplate));
      }
      if (savedVoucher?.kind === 'voucher' && !savedVoucher.issued) {
        setVoucher(savedVoucher);
        latest.current.voucher = savedVoucher;
      }
      if (savedIssued?.kind === 'voucher' && savedIssued.issued) {
        setIssued(savedIssued);
        latest.current.issued = savedIssued;
      }
      setBooted(true);
      switchMode(asDemoMode(localStorage.getItem(MODE_KEY)), restored ? messages.restored : messages.welcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, switchMode]);

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
    // 발행한 전표는 작성 상태에서 제거하고 조회 화면에 표시합니다.
    setVoucher(null);
    setIssued(file);
    latest.current.voucher = null;
    latest.current.issued = file;
    void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
    void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
    switchMode('view', messages.issued);
  }, [storageQueue, switchMode, reportStorageFailure]);

  /** 지금 화면에서 내려받을 파일을 반환합니다. */
  const activeFile = (): SlipFile => {
    if (mode === 'view' && issued) return issued;
    if (mode === 'fill' && voucher) return voucher;
    return template;
  };

  const openDownloadDialog = (): void => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (filenameRef.current) filenameRef.current.value = suggestedName(activeFile(), locale);
    dialog.returnValue = 'cancel';
    dialog.showModal();
    filenameRef.current?.select();
  };

  const onDialogClose = (): void => {
    if (dialogRef.current?.returnValue !== 'ok') return;
    const file = activeFile();
    const name = filenameRef.current?.value.trim() || suggestedName(file, locale);
    files
      .download(name, file)
      .then(() => setStatus(messages.downloaded(name)))
      .catch((error: unknown) => setStatus(messages.downloadFailed(reasonOf(error))));
  };

  const downloadPdf = (): void => {
    const file = activeFile();
    const name = `${suggestedName(file, locale)}.pdf`;
    slipKit
      .render(file)
      .then((pdf) => {
        saveBytes(pdf, name, 'application/pdf');
        setStatus(messages.pdfDownloaded(name));
      })
      .catch((error: unknown) => setStatus(messages.pdfFailed(reasonOf(error))));
  };

  const openFile = (): void => {
    files
      .open()
      .then((file) => {
        if (file.kind === 'template') {
          setTemplate(file);
          setVoucher(null);
          latest.current.template = file;
          latest.current.voucher = null;
          // 열기 전에 작성하던 전표 초안도 삭제합니다. 남겨 두면 다음 실행에서 다시 표시됩니다.
          void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
          setDesignerSrc(serializeSlipFile(file));
          switchMode('design', messages.openedTemplate);
        } else if (file.issued) {
          setIssued(file);
          latest.current.issued = file;
          void storageQueue.save([[ISSUED_KEY, file]]).catch(reportStorageFailure);
          switchMode('view', messages.openedIssued);
        } else {
          const fromVoucher = templateFromVoucher(file);
          setVoucher(file);
          setTemplate(fromVoucher);
          latest.current.template = fromVoucher;
          latest.current.voucher = file;
          setDesignerSrc(serializeSlipFile(fromVoucher));
          switchMode('fill', messages.openedVoucher);
        }
        void saveNow();
      })
      .catch((error: unknown) => {
        // 파일 선택 취소는 오류가 아니므로 안내를 바꾸지 않습니다.
        if (isCancelled(error)) return;
        setStatus(messages.openFailed(reasonOf(error)));
      });
  };

  const newSlip = (): void => {
    setVoucher(null);
    latest.current.voucher = null;
    void storageQueue.delete([VOUCHER_KEY]).catch(reportStorageFailure);
    switchMode('fill', messages.newSlip);
  };

  const openClearDialog = (): void => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    dialog.returnValue = 'cancel';
    dialog.showModal();
  };

  /** 저장 데이터를 지운 뒤 초기 상태로 되돌립니다. 화면을 다시 만들기 전까지 자동 저장을 예약하지 않습니다. */
  const resetToInitial = (): void => {
    const fresh = initialTemplate(locale);
    latest.current = { template: fresh, voucher: null, issued: null };
    setTemplate(fresh);
    setVoucher(null);
    setIssued(null);
    setDesignerSrc(serializeSlipFile(fresh));
    // 작성·조회 화면을 내려 이전 전표를 남기지 않습니다. 다음에 열 때 빈 전표로 다시 만듭니다.
    setFormSrc('');
    setViewerSrc('');
    setFormSession((session) => session + 1);
    setAutosave('');
    // 방금 삭제한 마지막 화면 정보(localStorage)를 다시 쓰지 않도록 switchMode를 거치지 않습니다.
    setMode('design');
    setStatus(messages.cleared);
  };

  const clearStorage = async (): Promise<void> => {
    // 예약된 저장이 남아 있으면 지운 직후 다시 저장됩니다. 먼저 취소합니다.
    cancelAutosave();
    try {
      await storageQueue.clear();
    } catch (error) {
      setStatus(messages.clearFailed(reasonOf(error)));
      return;
    }
    resetToInitial();
  };

  const onClearDialogClose = (): void => {
    // 취소하면 저장된 내용을 그대로 둡니다.
    if (clearDialogRef.current?.returnValue !== 'ok') return;
    void clearStorage();
  };

  return (
    <>
      <header>
        <span className="title">{messages.appTitle('React')}</span>
        <button aria-pressed={mode === 'design'} onClick={() => switchMode('design')}>{messages.buttonDesign}</button>
        <button aria-pressed={mode === 'fill'} onClick={() => switchMode('fill')}>{messages.buttonFill}</button>
        <button aria-pressed={mode === 'view'} hidden={issued === null} onClick={() => switchMode('view')}>
          {messages.buttonView}
        </button>
        <button hidden={mode !== 'fill'} onClick={newSlip}>{messages.buttonNewSlip}</button>
        <span className="sep" />
        <button onClick={openDownloadDialog}>{messages.buttonDownload}</button>
        <button onClick={downloadPdf}>{messages.buttonPdf}</button>
        <button onClick={openFile}>{messages.buttonOpen}</button>
        <span className="autosave">{autosave}</span>
        <span className="status">{status}</span>
      </header>

      <div className="notice">
        <span>{messages.storageNotice}</span>
        {sampleKey && <span className="warn">{messages.storageKeyWarning}</span>}
        <button onClick={openClearDialog}>{messages.buttonClearStorage}</button>
      </div>

      <div className="pane" hidden={mode !== 'design'}>
        {/* UI 언어와 렌더링 설정은 slipkit이 제공합니다. 컴포넌트 locale은 별도로 표시해야 할 때만 사용합니다. */}
        <SlipDesigner
          src={designerSrc}
          slipkit={slipKit}
          settings={designerSettings}
          storage={store}
          onSlipChange={onDesignerChange}
        />
      </div>
      <div className="pane" hidden={mode !== 'fill'}>
        {booted && formSrc !== '' ? (
          <SlipForm
            key={formSession}
            src={formSrc}
            slipkit={slipKit}
            onSlipChange={onFormChange}
            onSlipIssue={onFormIssue}
          />
        ) : null}
      </div>
      <div className="pane" hidden={mode !== 'view'}>
        {viewerSrc !== '' ? <SlipViewer src={viewerSrc} slipkit={slipKit} /> : null}
      </div>

      <dialog ref={dialogRef} onClose={onDialogClose}>
        <form method="dialog">
          <h2>{messages.buttonDownload}</h2>
          <div className="body">
            <label htmlFor="filename">{messages.filenameLabel}</label>
            <input id="filename" ref={filenameRef} name="filename" autoComplete="off" />
          </div>
          <div className="foot">
            <button value="cancel">{messages.cancel}</button>
            <button value="ok">{messages.download}</button>
          </div>
        </form>
      </dialog>

      <dialog ref={clearDialogRef} onClose={onClearDialogClose}>
        <form method="dialog">
          <h2>{messages.clearConfirmTitle}</h2>
          <div className="body">
            <p>{messages.clearConfirmBody}</p>
          </div>
          <div className="foot">
            <button value="cancel">{messages.cancel}</button>
            <button value="ok" className="danger">{messages.clearConfirmOk}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
