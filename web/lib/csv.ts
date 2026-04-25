// Minimal CSV parser. Our mock files have no quoted fields with commas inside,
// so this stays simple and dependency-free.
export function parseCsv<T extends Record<string, string | number>>(
  text: string,
  numericFields: ReadonlyArray<keyof T> = [],
): T[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const numeric = new Set(numericFields as string[]);

  const out: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row: Record<string, string | number> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      const raw = (cols[j] ?? "").trim();
      row[key] = numeric.has(key) ? Number(raw) : raw;
    }
    out.push(row as T);
  }
  return out;
}
