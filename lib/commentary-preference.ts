import type { CommentarySummary } from "./study-api.ts";

/** Keep an explicit choice; otherwise open TSK, even when the Bible uses another language. */
export function defaultCommentary(commentaries: readonly CommentarySummary[], language: string, preferred?: string | null): string {
  const available = commentaries.filter((item) => item.entry_count > 0);
  return available.find((item) => item.id === preferred)?.id
    ?? available.find((item) => item.id === "tsk")?.id
    ?? available.find((item) => item.language.toLowerCase() === language.toLowerCase())?.id
    ?? available.find((item) => item.language === "en")?.id
    ?? available[0]?.id
    ?? "";
}
