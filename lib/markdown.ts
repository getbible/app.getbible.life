import type { Chapter } from "./getbible";

export function chapterMarkdown(chapter: Chapter, copyrightNotice?: string): string {
  const verses = chapter.verses.map((verse) => `${verse.verse} ${verse.text.trim()}`).join("\n");
  const notice = copyrightNotice?.trim();
  return notice ? `${verses}\n\n---\n${notice}` : verses;
}

export function chapterMarkdownFilename(chapter: Chapter): string {
  const name = chapter.book_name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${name}-${chapter.chapter}.md`;
}
