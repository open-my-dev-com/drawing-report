import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 릴리즈 노트에 필요한 언어 구역과 표시 순서입니다. */
const RELEASE_NOTE_SECTIONS = ['한국어', '日本語', 'English'];

/**
 * 정규식 문자열에서 특별한 의미를 갖는 문자를 일반 문자로 바꿉니다.
 *
 * @param value - 정규식에 포함할 문자열
 * @returns 정규식에서 문자 그대로 해석되는 문자열
 */
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 버전에 대응하는 릴리즈 노트 경로를 반환합니다.
 *
 * @param root - 저장소 루트
 * @param version - 배포 버전
 * @returns 릴리즈 노트 경로
 */
function releaseNotesPath(root, version) {
  return path.join(root, 'docs', 'releases', `${version}.md`);
}

/**
 * 릴리즈 노트에 세 언어 구역이 순서대로 한 번씩 있고 내용이 비어 있지 않은지 검사합니다.
 *
 * @param markdown - 검사할 Markdown
 * @param version - 제목에서 요구할 버전. 생략하면 언어 구역만 검사합니다.
 * @returns 문제 설명 목록
 */
export function validateReleaseNotes(markdown, version) {
  if (typeof markdown !== 'string') return ['release notes are missing'];
  const problems = [];
  if (version !== undefined && !new RegExp(`^# SlipKit ${escapeRegularExpression(version)}\\s*$`, 'm').test(markdown)) {
    problems.push(`release notes title must be # SlipKit ${version}`);
  }
  const headings = [...markdown.matchAll(/^## (한국어|日本語|English)\s*$/gm)];
  if (headings.length !== RELEASE_NOTE_SECTIONS.length) {
    problems.push(`release notes must contain exactly ${RELEASE_NOTE_SECTIONS.join(', ')}`);
    return problems;
  }
  const actual = headings.map((match) => match[1]);
  if (!actual.every((heading, index) => heading === RELEASE_NOTE_SECTIONS[index])) {
    problems.push(`release note sections must be ordered ${RELEASE_NOTE_SECTIONS.join(', ')}`);
  }
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    if (markdown.slice(start, end).trim() === '') {
      problems.push(`release note section ${headings[index][1]} is empty`);
    }
  }
  return problems;
}

/**
 * 버전별 릴리즈 노트를 읽고 형식을 검사합니다.
 *
 * @param root - 저장소 루트
 * @param version - 배포 버전
 * @returns 릴리즈 노트 Markdown
 * @throws Error 파일이 없거나 세 언어 구역 계약을 지키지 않으면 발생합니다.
 */
export async function readReleaseNotes(root, version) {
  const file = releaseNotesPath(root, version);
  let markdown;
  try {
    markdown = await readFile(file, 'utf8');
  } catch {
    throw new Error(`release notes are missing: ${path.relative(root, file)}`);
  }
  const problems = validateReleaseNotes(markdown, version);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return markdown.trim();
}

/**
 * 세 언어 원문과 GitHub가 생성한 변경 목록을 합칩니다.
 *
 * @param localizedNotes - 저장소에서 검토한 세 언어 원문
 * @param generatedNotes - GitHub가 생성한 PR·기여자 변경 목록
 * @returns GitHub Release 본문
 */
export function buildReleaseBody(localizedNotes, generatedNotes) {
  return `${localizedNotes.trim()}\n\n---\n\n## Changes · 변경 내역 · 変更履歴\n\n${generatedNotes.trim()}\n`;
}
