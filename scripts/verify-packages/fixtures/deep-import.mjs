// 공개하지 않은 dist 내부 경로는 exports 맵이 거부해야 한다.
const targets = [
  '@omdc-slipkit/core/dist/index.js',
  '@omdc-slipkit/elements/dist/index.js',
  '@omdc-slipkit/mcp/dist/cli.js',
];
for (const target of targets) {
  try {
    await import(target);
    throw new Error(`${target} was importable`);
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
}
console.log('deep import rejected');
