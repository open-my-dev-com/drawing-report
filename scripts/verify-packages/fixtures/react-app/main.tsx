// React 소비자: 래퍼 컴포넌트에 양식과 공통 설정을 넘기고, ref와 표준 HTML 속성도 함께 쓴다.
import { createSlipKit, type SlipFile } from '@omdc-slipkit/core';
import type { SlipDesigner as SlipDesignerElement } from '@omdc-slipkit/elements';
import { SlipDesigner, SlipViewer } from '@omdc-slipkit/react';
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { template } from '../template.mjs';

const slipkit = createSlipKit({ locale: 'en' });
const src = JSON.stringify(template);

function App() {
  const designerRef = useRef<SlipDesignerElement>(null);
  const onSlipChange = (file: SlipFile): void => {
    console.log(file.kind);
  };
  const onClick = (): void => {
    console.log(designerRef.current?.tagName);
  };
  return (
    <>
      <SlipDesigner
        ref={designerRef}
        className="designer"
        style={{ minHeight: '600px' }}
        aria-label="Template designer"
        onClick={onClick}
        src={src}
        slipkit={slipkit}
        onSlipChange={onSlipChange}
      />
      <SlipViewer src={src} slipkit={slipkit} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
