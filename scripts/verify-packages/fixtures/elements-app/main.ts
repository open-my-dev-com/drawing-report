// Vite + Elements 소비자: 커스텀 엘리먼트를 등록하고 양식을 넘긴다.
import '@omdc-slipkit/elements';
import { createSlipKit } from '@omdc-slipkit/core';
import { template } from '../template.mjs';

const designer = document.getElementById('designer') as HTMLElement & { src: string; slipkit: unknown };
designer.slipkit = createSlipKit({ locale: 'en' });
designer.src = JSON.stringify(template);
