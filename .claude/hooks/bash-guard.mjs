#!/usr/bin/env node
/**
 * PreToolUse(Bash) 훅 — 개발 규칙 보호 (ADR-024).
 *
 * 1) main 보호: main으로의 push, main 위에서의 commit/push를 차단한다.
 * 2) 검증 게이트: git commit 전에 `pnpm lint && pnpm -r typecheck && pnpm -r build && pnpm -r test`를
 *    실행해 실패하면 커밋을 차단한다.
 *
 * 종료 코드 2 = 차단 (stderr가 Claude에게 사유로 전달됨). 0 = 통과.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

// 명령을 &&·;·| 세그먼트로 나누고, 따옴표 문자열(커밋 메시지 등)은 검사에서 제외한다
const segments = command.split(/&&|\|\||;|\|/).map((seg) => seg.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, ' '));
const pushSegments = segments.filter((seg) => /\bgit\b[\s\S]*\bpush\b/.test(seg));
const hasGitCommit = segments.some((seg) => /\bgit\b[\s\S]*\bcommit\b/.test(seg));

if (pushSegments.length > 0) {
  const targetsMain = pushSegments.some((seg) =>
    seg.split(/\s+/).some((t) => t === 'main' || t.endsWith(':main')),
  );
  if (targetsMain) {
    block('[bash-guard] main 직접 푸시는 금지입니다 (.claude/rules/branching.md·ADR-024). 변경은 작업 브랜치에서 PR로만 병합하세요.');
  }
  if (currentBranch() === 'main') {
    block('[bash-guard] 현재 브랜치가 main입니다. main에서는 푸시할 수 없습니다. 규칙 형식(<type>/<scope>-<topic>)의 작업 브랜치를 만들어 진행하세요.');
  }
}

if (hasGitCommit) {
  if (currentBranch() === 'main') {
    block('[bash-guard] main 직접 커밋은 금지입니다 (.claude/rules/branching.md·ADR-024). 작업 브랜치를 만들어 커밋하세요.');
  }
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
