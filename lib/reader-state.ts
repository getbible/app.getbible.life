export function boundaryTurn(
  deltaY: number,
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
): -1 | 0 | 1 {
  if (deltaY > 0 && viewportHeight + scrollY >= documentHeight - 2) return 1;
  if (deltaY < 0 && scrollY <= 1) return -1;
  return 0;
}

export function readerStorageKeys(keys: string[]): string[] {
  return keys.filter((key) => key.startsWith("getbible-reader:"));
}
