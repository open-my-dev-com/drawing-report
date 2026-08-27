import { constants, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.join(demoDir, 'workspace');
const fixturePath = path.join(demoDir, 'fixtures', 'sample-template.slip');
const samplePath = path.join(workspaceDir, 'sample-template.slip');

if (process.argv.includes('--reset')) {
  await rm(workspaceDir, { recursive: true, force: true });
}

await mkdir(workspaceDir, { recursive: true });

try {
  await copyFile(fixturePath, samplePath, constants.COPYFILE_EXCL);
  console.log(`MCP demo workspace prepared: ${samplePath}`);
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
  console.log(`MCP demo workspace kept: ${samplePath}`);
}
