// 소비자 시나리오가 공유하는 최소 양식 — 텍스트 요소 하나만 둔다.
export const template = {
  schemaVersion: '0.1.0',
  kind: 'template',
  template: {
    meta: { title: 'Consumer check' },
    paper: { width: 210, height: 297, padding: [15, 15, 15, 15] },
    pages: [
      {
        elements: [
          {
            type: 'text',
            id: 'title',
            name: 'title',
            position: { x: 15, y: 20 },
            width: 180,
            height: 10,
            content: 'SlipKit consumer check',
          },
        ],
      },
    ],
    assets: [],
  },
};
