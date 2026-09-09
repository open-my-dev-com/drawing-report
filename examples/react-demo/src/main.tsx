/**
 * SlipKit React 데모의 진입점입니다.
 * 바닐라 데모와 같은 기능을 React로 연결한 예시이며 연결 방법만 다릅니다.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'slipkit-demo-shared/demo.css';
import { App } from './App.js';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
