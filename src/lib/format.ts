// Money and date helpers. Time zone: America/Sao_Paulo, fixed -03:00 (no DST in Brazil since 2019).

const OFFSET_MS = -3 * 60 * 60 * 1000;
const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 1234567 → "R$ 12.345,67" (regular space, so text search matches). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = (abs % 100).toString().padStart(2, "0");
  return `${sign}R$ ${reais},${centavos}`;
}

/** Value for a price input: 15000 → "150,00". */
export function centsToInput(cents: number): string {
  return formatCents(cents).replace("R$ ", "");
}

/**
 * Parses "100", "100,5", "100,00", "100.00", "1.234,56", "-5" into cents. Returns null when unparseable.
 * Sign is preserved so the caller can report "must be greater than zero".
 */
export function parseMoney(input: unknown): number | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^R\$\s*/, "");
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  let intPart: string;
  let fracPart = "";
  let m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s);
  if (m) {
    intPart = (m[1] ?? "").replaceAll(".", "");
    fracPart = m[2] ?? "";
  } else {
    m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
    if (!m) return null;
    intPart = m[1] ?? "";
    fracPart = m[2] ?? "";
  }
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** "2026-12-05T21:00" (datetime-local, São Paulo time) → Date. Null when invalid (e.g. 2026-02-30). */
export function parseLocalDateTime(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!LOCAL_INPUT_RE.test(value)) return null;
  const date = new Date(`${value}:00-03:00`);
  if (Number.isNaN(date.getTime()) || toLocalInput(date) !== value) return null;
  return date;
}

/** Date → "2026-12-05T21:00" in São Paulo time (for datetime-local inputs). */
export function toLocalInput(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

/** Date → "05/12/2026 21:00" in São Paulo time. */
export function formatDateTime(date: Date): string {
  const [day, time] = toLocalInput(date).split("T");
  const [y, mo, d] = (day ?? "").split("-");
  return `${d}/${mo}/${y} ${time}`;
}

/** Date → ISO 8601 with the São Paulo offset, e.g. "2026-12-05T21:00:00-03:00" (partner API). */
export function toIsoWithOffset(date: Date): string {
  return `${new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
}
