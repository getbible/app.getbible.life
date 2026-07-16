export const LIGHT_PALETTES = [
  { id: "white", name: "Pure white" },
  { id: "paper", name: "Warm paper" },
  { id: "ivory", name: "Soft ivory" },
  { id: "mist", name: "Cool mist" },
] as const;

export const DARK_PALETTES = [
  { id: "black", name: "Pure black" },
  { id: "brown", name: "Warm brown" },
  { id: "charcoal", name: "Soft charcoal" },
  { id: "navy", name: "Midnight blue" },
] as const;

export const READER_FONTS = [
  { id: "serif", name: "Classic serif" },
  { id: "book", name: "Book serif" },
  { id: "baskerville", name: "Baskerville" },
  { id: "garamond", name: "Garamond" },
  { id: "charter", name: "Charter" },
  { id: "cambria", name: "Cambria" },
  { id: "times", name: "Times New Roman" },
  { id: "sans", name: "Clean sans" },
  { id: "system", name: "System sans" },
] as const;

export function validPalette(
  palettes: ReadonlyArray<{ id: string }>,
  candidate: string | null,
  fallback: string,
): string {
  return candidate && palettes.some((palette) => palette.id === candidate) ? candidate : fallback;
}
