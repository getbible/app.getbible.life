import type { Chapter } from "./getbible";

export interface MarkdownFooter { translationName?: string; copyrightNotice?: string }

export function chapterMarkdown(chapter: Chapter, footer: MarkdownFooter = {}): string {
  const heading = `# ${chapter.book_name} ${chapter.chapter}`;
  const verses = chapter.verses.map((verse) => `${verse.verse}. ${verse.text.trim()}`).join("\n");
  const footerLines = [footer.translationName?.trim() ? `**${footer.translationName.trim()}**` : "", footer.copyrightNotice?.trim() ?? ""].filter(Boolean);
  return footerLines.length ? `${heading}\n\n${verses}\n\n---\n${footerLines.join("\n\n")}` : `${heading}\n\n${verses}`;
}

export function chapterMarkdownFilename(chapter: Chapter): string {
  const name = chapter.book_name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${name}-${chapter.chapter}.md`;
}
