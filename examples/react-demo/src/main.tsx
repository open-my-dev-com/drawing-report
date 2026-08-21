/**
 * SlipKit React 데모 진입점 (F-22).
 * 바닐라 데모와 같은 기능을 React로 붙인 예시다 — 붙이는 방법만 다르다.
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
