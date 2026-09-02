// React 소비자: 래퍼 컴포넌트에 양식과 공통 설정을 넘긴다.
import { createSlipKit, type SlipFile } from '@omdc-slipkit/core';
import { SlipDesigner, SlipViewer } from '@omdc-slipkit/react';
import { createRoot } from 'react-dom/client';
import { template } from '../template.mjs';

const slipkit = createSlipKit({ locale: 'en' });
const src = JSON.stringify(template);

function App() {
  const onSlipChange = (file: SlipFile): void => {
    console.log(file.kind);
  };
  return (
    <>
      <SlipDesigner src={src} slipkit={slipkit} onSlipChange={onSlipChange} />
      <SlipViewer src={src} slipkit={slipkit} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
