export const DAILY_SCRIPTURE_URL = "https://raw.githubusercontent.com/trueChristian/daily-scripture/refs/heads/master/README.json";

export interface DailyReference {
  date: string;
  translation: string;
  bookName: string;
  chapter: number;
  verse: number;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dailyDateKey(value: string): string | null {
  const normalized = value.replace(/(\d{1,2})-([A-Za-z]+)/, "$1 $2");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed);
}

export function dailyIsCurrent(date: string, now = new Date()): boolean {
  return dailyDateKey(date) === localDateKey(now);
}

export function parseDailyReference(value: unknown): DailyReference {
  if (!value || typeof value !== "object") throw new Error("The daily Scripture response is invalid.");
  const data = value as Record<string, unknown>;
  const date = String(data.date ?? "");
  const link = String(data.getbible ?? data.url ?? data.link ?? "");
  const name = String(data.name ?? data.reference ?? "");
  const urlParts = link.split("/").filter(Boolean);
  const getBibleIndex = urlParts.findIndex((part) => part.toLowerCase().includes("getbible.life"));
  const path = getBibleIndex >= 0 ? urlParts.slice(getBibleIndex + 1) : [];
  const referenceMatch = name.match(/^(.+?)\s+(\d+):(\d+)/);
  const scripture = Array.isArray(data.scripture) ? data.scripture as Array<Record<string, unknown>> : [];

  const translation = String(data.translation ?? data.version ?? path[0] ?? "kjv").toLowerCase();
  const bookName = String(data.book ?? path[1] ?? referenceMatch?.[1] ?? "").replaceAll("%20", " ");
  const chapter = positiveNumber(data.chapter ?? path[2] ?? referenceMatch?.[2]);
  const verse = positiveNumber(data.verse ?? data.verses ?? path[3] ?? referenceMatch?.[3] ?? scripture[0]?.nr);

  if (!date || !bookName || !chapter || !verse) throw new Error("The daily Scripture response does not contain a complete reference.");
  return { date, translation, bookName, chapter, verse };
}
