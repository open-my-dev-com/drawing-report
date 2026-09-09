#!/usr/bin/env node
/**
 * PreToolUse(Bash) 훅의 검사 항목입니다.
 *
 * 1) main 보호: main에 푸시하거나 main에서 커밋·푸시하는 명령을 차단합니다.
 * 2) 브랜치 형식: 커밋·푸시할 때 현재 브랜치가 규칙 형식(<type>/<scope>-<topic>)이 아니면
 *    차단합니다. 환경이 이름을 강제하는 등의 이유로 규칙에 맞지 않는 브랜치를 사용해야 할 때는
 *    `.claude/hooks/branch-guard.json`의 allowBranches에 패턴을 추가해 허용합니다.
 * 3) 검증 게이트: `git commit` 전에 `pnpm verify`를 실행하며, 검증에 실패하면 커밋을 차단합니다.
 *
 * 종료 코드가 2이면 명령을 차단하고 stderr로 이유를 전달합니다. 0이면 명령을 허용합니다.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let data = {};
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const command = data.tool_input?.command ?? '';
if (typeof command !== 'string' || command.length === 0) process.exit(0);

const cwd = data.cwd ?? process.cwd();

function block(message) {
  process.stderr.write(message);
  process.exit(2);
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// 브랜치 형식 규칙 (.claude/rules/branching.md): <type>/<scope>-<topic>
const BRANCH_FORMAT = /^(feat|fix|docs|proto|chore)\/(core|elements|react|vue|mcp|repo)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 브랜치 제어 설정입니다. `*` 와일드카드를 지원하며 거부 목록을 허용 목록보다 먼저 적용합니다.
function branchGuardConfig() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const patterns = (value) => (Array.isArray(value) ? value.filter((p) => typeof p === 'string') : []);
  try {
    const config = JSON.parse(readFileSync(join(projectDir, '.claude', 'hooks', 'branch-guard.json'), 'utf8'));
    return { deny: patterns(config.denyBranches), allow: patterns(config.allowBranches) };
  } catch {
    return { deny: [], allow: [] };
  }
}

function matchesPattern(branch, pattern) {
  const regex = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return regex.test(branch);
}

/** 커밋·푸시 대상 브랜치를 검사합니다. 거부 목록에 있거나 형식과 허용 목록에 맞지 않으면 차단합니다. */
function requireBranchAllowed(branch) {
  // 저장소 밖이거나 detached HEAD여서 브랜치를 확인할 수 없으면 여기서 판단하지 않습니다.
  if (branch === '' || branch === 'HEAD' || branch === 'main') return;
  const { deny, allow } = branchGuardConfig();
  if (deny.some((pattern) => matchesPattern(branch, pattern))) {
    block(
      `[bash-guard] 브랜치 이름 '${branch}'는 거부 목록에 포함되어 있어 사용할 수 없습니다(.claude/hooks/branch-guard.json denyBranches, ADR-058).\n` +
      `허용 목록에 추가해도 사용할 수 없습니다. 규칙 형식(<type>/<scope>-<topic>)의 새 브랜치로 작업을 옮겨야 합니다.`,
    );
  }
  if (BRANCH_FORMAT.test(branch)) return;
  if (allow.some((pattern) => matchesPattern(branch, pattern))) return;
  block(
    `[bash-guard] 브랜치 '${branch}'는 규칙 형식(<type>/<scope>-<topic>, .claude/rules/branching.md)이 아닙니다.\n` +
      `규칙 형식의 브랜치로 작업을 옮겨야 합니다. 환경에서 이름을 강제하는 등의 이유로 이 브랜치를 사용해야 한다면\n` +
      `.claude/hooks/branch-guard.json의 allowBranches에 패턴을 추가할 수 있습니다. 추가하기 전에 사용자 확인이 필요합니다(ADR-058).`,
  );
}

// heredoc 본문(커밋 메시지 등)은 명령이 아니므로 검사에서 제외합니다.
const withoutHeredocs = command.replace(/<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?[\s\S]*?\n\1\b/g, ' ');
// 명령을 &&·;·|·줄바꿈 구간으로 나누고, 따옴표 문자열(커밋 메시지 등)은 검사에서 제외합니다.
const segments = withoutHeredocs.split(/&&|\|\||;|\||\n/).map((seg) => seg.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, ' '));
const pushSegments = segments.filter((seg) => /\bgit\b[\s\S]*\bpush\b/.test(seg));
const hasGitCommit = segments.some((seg) => /\bgit\b[\s\S]*\bcommit\b/.test(seg));

if (pushSegments.length > 0) {
  const targetsMain = pushSegments.some((seg) =>
    seg.split(/\s+/).some((t) => t === 'main' || t.endsWith(':main')),
  );
  if (targetsMain) {
    block('[bash-guard] main에 직접 푸시할 수 없습니다(.claude/rules/branching.md·ADR-024). 작업 브랜치에서 PR로 병합하세요.');
  }
  const branch = currentBranch();
  if (branch === 'main') {
    block('[bash-guard] 현재 브랜치가 main입니다. main에서는 푸시할 수 없습니다. 규칙 형식(<type>/<scope>-<topic>)의 작업 브랜치를 만들어 진행하세요.');
  }
  requireBranchAllowed(branch);
}

if (hasGitCommit) {
  const branch = currentBranch();
  if (branch === 'main') {
    block('[bash-guard] main에 직접 커밋할 수 없습니다(.claude/rules/branching.md·ADR-024). 작업 브랜치를 만들어 커밋하세요.');
  }
  // 브랜치 형식이 올바르지 않으면 검증할 필요가 없으므로 형식을 먼저 검사합니다.
  requireBranchAllowed(branch);
  // 검증 게이트에 실패하면 커밋을 차단합니다.
  try {
    execSync('pnpm verify', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 540_000,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    const tail = output.length > 1500 ? `...(생략)...\n${output.slice(-1500)}` : output;
    block(
      `[bash-guard] 검증에 실패하여 커밋을 차단했습니다(CLAUDE.md).\n` +
        `pnpm verify를 통과해야 커밋할 수 있습니다.\n` +
        `실패하는 시험을 건너뛰거나 삭제하거나 기준을 완화해서는 안 됩니다.\n\n${tail}`,
    );
  }
}

process.exit(0);
