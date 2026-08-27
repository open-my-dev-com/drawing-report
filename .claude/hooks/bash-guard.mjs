#!/usr/bin/env node
/**
 * PreToolUse(Bash) 훅 — 개발 규칙 보호 (ADR-024/058).
 *
 * 1) main 보호: main으로의 push, main 위에서의 commit/push를 차단한다.
 * 2) 브랜치 형식: commit·push 시 현재 브랜치가 규칙 형식(<type>/<scope>-<topic>)이 아니면
 *    차단한다. 규칙에 맞지 않는 브랜치를 써야 할 때(환경이 이름을 강제하는 경우 등)는
 *    `.claude/hooks/branch-guard.json`의 allowBranches에 패턴을 추가해 허용한다 (ADR-058).
 * 3) 검증 게이트: git commit 전에 `pnpm lint && pnpm -r typecheck && pnpm -r build && pnpm -r test`를
 *    실행해 실패하면 커밋을 차단한다.
 *
 * 종료 코드 2 = 차단 (stderr가 Claude에게 사유로 전달됨). 0 = 통과.
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
const BRANCH_FORMAT = /^(feat|fix|docs|proto|chore)\/(core|elements|react|vue|repo)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 브랜치 제어 설정('*' 와일드카드) — 거부 목록은 허용 목록보다 우선한다 (ADR-058)
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

/** 커밋·푸시 대상 브랜치를 검사한다 — 거부 목록이면 무조건, 형식·허용 목록에 없어도 차단. */
function requireBranchAllowed(branch) {
  // 브랜치를 알 수 없는 상태(비저장소·detached HEAD)는 여기서 판단하지 않는다
  if (branch === '' || branch === 'HEAD' || branch === 'main') return;
  const { deny, allow } = branchGuardConfig();
  if (deny.some((pattern) => matchesPattern(branch, pattern))) {
    block(
      `[bash-guard] 브랜치 이름 '${branch}'는 사용이 금지되어 있습니다 (.claude/hooks/branch-guard.json denyBranches, ADR-058).\n` +
        `허용 목록으로도 열 수 없습니다. 규칙 형식(<type>/<scope>-<topic>)의 새 브랜치를 만들어 작업을 옮기세요.`,
    );
  }
  if (BRANCH_FORMAT.test(branch)) return;
  if (allow.some((pattern) => matchesPattern(branch, pattern))) return;
  block(
    `[bash-guard] 브랜치 '${branch}'는 규칙 형식(<type>/<scope>-<topic>, .claude/rules/branching.md)이 아닙니다.\n` +
      `규칙 형식의 브랜치로 옮겨 작업하세요. 이 브랜치를 그대로 써야 한다면(환경이 이름을 강제하는 경우 등)\n` +
      `.claude/hooks/branch-guard.json의 allowBranches에 패턴을 추가해 허용할 수 있습니다 — 사용자 확인 없이 임의로 추가하지 마세요 (ADR-058).`,
  );
}

// heredoc 본문(커밋 메시지 등)은 명령이 아니므로 검사에서 제외한다
const withoutHeredocs = command.replace(/<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?[\s\S]*?\n\1\b/g, ' ');
// 명령을 &&·;·|·줄바꿈 세그먼트로 나누고, 따옴표 문자열(커밋 메시지 등)은 검사에서 제외한다
const segments = withoutHeredocs.split(/&&|\|\||;|\||\n/).map((seg) => seg.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, ' '));
const pushSegments = segments.filter((seg) => /\bgit\b[\s\S]*\bpush\b/.test(seg));
const hasGitCommit = segments.some((seg) => /\bgit\b[\s\S]*\bcommit\b/.test(seg));

if (pushSegments.length > 0) {
  const targetsMain = pushSegments.some((seg) =>
    seg.split(/\s+/).some((t) => t === 'main' || t.endsWith(':main')),
  );
  if (targetsMain) {
    block('[bash-guard] main 직접 푸시는 금지입니다 (.claude/rules/branching.md·ADR-024). 변경은 작업 브랜치에서 PR로만 병합하세요.');
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
    block('[bash-guard] main 직접 커밋은 금지입니다 (.claude/rules/branching.md·ADR-024). 작업 브랜치를 만들어 커밋하세요.');
  }
  // 브랜치 형식 검사는 검증 게이트보다 먼저 — 형식이 어긋나면 게이트를 돌릴 필요가 없다
  requireBranchAllowed(branch);
  // 검증 게이트 — 실패 시 커밋 차단
  try {
    execSync('pnpm lint && pnpm -r typecheck && pnpm -r build && pnpm -r test', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 540_000,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    const tail = output.length > 1500 ? `...(생략)...\n${output.slice(-1500)}` : output;
    block(
      `[bash-guard] 검증 게이트 실패 — 커밋이 차단되었습니다 (CLAUDE.md).\n` +
        `pnpm lint && pnpm -r typecheck && pnpm -r build && pnpm -r test 가 모두 통과해야 커밋할 수 있습니다.\n` +
        `실패하는 테스트를 스킵·삭제·완화로 통과시키지 마세요.\n\n${tail}`,
    );
  }
}

process.exit(0);
