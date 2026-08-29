/**
 * SlipKit React 데모 — 양식을 만들고, 전표를 쓰고, 발행된 전표를 확인하고, 파일로 주고받는 흐름 (F-22).
 *
 * 호스트 앱이 `@omdc-slipkit/react` 래퍼를 어떻게 붙이는지 보여준다.
 * 무엇을 저장하고 언제 이어 쓰는지는 바닐라·Vue 데모와 같은 `slipkit-demo-shared`를 쓴다.
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
  createStores,
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
  type DemoMode,
} from 'slipkit-demo-shared';

// 데모 언어 — 주소의 ?locale= 값이 우선하고, 없으면 빌드 설정값을 쓴다
const locale = resolveDemoLocale(location.search, import.meta.env.VITE_SLIPKIT_LOCALE as string | undefined);
const messages = getMessages(locale);
document.documentElement.lang = locale ?? 'en';
document.title = messages.appTitle('React');

// 공통 설정은 여기 한 번만 적는다 — 컴포넌트, 자동 저장, 파일 주고받기, PDF 렌더링이
// 전부 이 인스턴스의 폰트·로케일·암호화 키를 사용한다.
// 암호화 키는 .env(VITE_SLIPKIT_KEY)에서 한 번 읽고, 없으면 데모 샘플 키를 명시적으로 쓴다.
const slipKit = createSlipKit({
  getFonts: () => loadDefaultFonts(locale?.toLowerCase().startsWith('ja') ? 'ja' : 'ko'),
  ...(locale === undefined ? {} : { locale }),
  encryption: resolveDemoEncryption(import.meta.env.VITE_SLIPKIT_KEY as string | undefined),
});

// 호스트가 용지 후보를 공급하는 예시 — 기본 용지 뒤에 추가로 표시된다.
// 폰트(getFonts)와 바코드 종류(getBarcodeKinds)도 같은 방식으로 공급할 수 있다.
const designerSettings: SlipDesignerSettings = {
  getPaperSizes: () => [{ name: 'Label 100x150', width: 100, height: 150 }],
};

export function App() {
  // 저장소는 화면이 다시 그려져도 그대로 써야 하므로 한 번만 만든다
  const { store, files } = useMemo(() => createStores(slipKit, 'slipkit-demo-react'), []);

  const [template, setTemplate] = useState<SlipTemplateFile>(() => initialTemplate(locale));
  // 디자이너에 넣는 시작 입력 — 편집 중에는 바꾸지 않고, 외부 양식을 명시적으로 열 때만 갱신한다
  const [designerSrc, setDesignerSrc] = useState<string>(() => serializeSlipFile(template));
  const [voucher, setVoucher] = useState<SlipVoucherFile | null>(null);
  const [issued, setIssued] = useState<SlipVoucherFile | null>(null);
  const [mode, setMode] = useState<DemoMode>('design');
  const [status, setStatus] = useState<string>(messages.welcome);
  const [autosave, setAutosave] = useState<string>('');
  // 전표 쓰기·조회로 넘어간 시점의 파일 — 화면을 옮길 때만 새로 정한다
  const [formSrc, setFormSrc] = useState<string>('');
  const [viewerSrc, setViewerSrc] = useState<string>('');
  const [booted, setBooted] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 자동 저장은 최신 값을 봐야 하므로 ref로도 들고 있는다
  const latest = useRef({ template, voucher, issued });
  latest.current = { template, voucher, issued };

  const saveNow = useCallback(async () => {
    try {
      await store.save(TEMPLATE_KEY, latest.current.template);
      if (latest.current.voucher) await store.save(VOUCHER_KEY, latest.current.voucher);
      setAutosave(savedLabel(new Date(), locale));
    } catch (error) {
      setAutosave('');
      setStatus(messages.autosaveFailed(reasonOf(error)));
    }
  }, [store]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  /** 화면 전환 — 양식 편집, 전표 작성, 발행 전표 조회 */
  const switchMode = useCallback((next: DemoMode, message?: string) => {
    const current = latest.current;
    // 발행된 전표가 없으면 조회 화면을 열 수 없다.
    if (next === 'view' && !current.issued) next = 'design';
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
    if (next === 'fill') {
      const continuing = canResumeVoucher(current.voucher);
      // 이어 쓸 전표가 없으면 buildVoucher로 양식에서 빈 전표를 만들어 시작한다.
      const target = continuing ? current.voucher! : buildVoucher(current.template, {});
      if (!continuing) {
        setVoucher(target);
        latest.current.voucher = target;
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

  // 시작 — 이전 작업이 있으면 그대로 이어서 연다
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
    // 발행된 전표는 작성 대상에서 내리고 조회 화면으로 넘긴다.
    setVoucher(null);
    setIssued(file);
    latest.current.voucher = null;
    latest.current.issued = file;
    void store.save(ISSUED_KEY, file).catch(() => undefined);
    void store.delete(VOUCHER_KEY).catch(() => undefined);
    switchMode('view', messages.issued);
  }, [store, switchMode]);

  /** 지금 화면에서 다루고 있는 파일 — 내려받기 대상 */
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
          setDesignerSrc(serializeSlipFile(file));
          switchMode('design', messages.openedTemplate);
        } else if (file.issued) {
          setIssued(file);
          latest.current.issued = file;
          void store.save(ISSUED_KEY, file).catch(() => undefined);
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
        // 파일 선택 취소는 오류가 아니므로 안내를 바꾸지 않는다.
        if (isCancelled(error)) return;
        setStatus(messages.openFailed(reasonOf(error)));
      });
  };

  const newSlip = (): void => {
    setVoucher(null);
    latest.current.voucher = null;
    void store.delete(VOUCHER_KEY).catch(() => undefined);
    switchMode('fill', messages.newSlip);
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

      <div className="pane" hidden={mode !== 'design'}>
        {/* UI 언어와 렌더 설정은 slipkit이 공급한다 — 컴포넌트 locale은 다르게 표시할 때만 쓴다 */}
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
    </>
  );
}
