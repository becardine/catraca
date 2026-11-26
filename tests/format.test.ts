import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatCents,
  formatDateTime,
  parseLocalDateTime,
  parseMoney,
  toIsoWithOffset,
  toLocalInput,
} from "../src/lib/format.js";

describe("money", () => {
  it("formats cents as Brazilian currency with a regular space", () => {
    expect(formatCents(35000)).toBe("R$ 350,00");
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(123456789)).toBe("R$ 1.234.567,89");
    expect(centsToInput(15000)).toBe("150,00");
  });

  it("parses common price inputs", () => {
    expect(parseMoney("100")).toBe(10000);
    expect(parseMoney("100,00")).toBe(10000);
    expect(parseMoney("100.00")).toBe(10000);
    expect(parseMoney("100,5")).toBe(10050);
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("R$ 20,00")).toBe(2000);
    expect(parseMoney("-5")).toBe(-500);
    expect(parseMoney("0")).toBe(0);
  });

  it("rejects unparseable prices", () => {
    for (const v of ["abc", "", "1,234", "10,999", "1e3", undefined, 5]) {
      expect(parseMoney(v), String(v)).toBeNull();
    }
  });
});

describe("dates in America/Sao_Paulo (-03:00)", () => {
  it("parses datetime-local values as -03:00 and round-trips", () => {
    const d = parseLocalDateTime("2026-12-05T21:00");
    expect(d?.toISOString()).toBe("2026-12-06T00:00:00.000Z");
    expect(toLocalInput(d as Date)).toBe("2026-12-05T21:00");
    expect(formatDateTime(d as Date)).toBe("05/12/2026 21:00");
    expect(toIsoWithOffset(d as Date)).toBe("2026-12-05T21:00:00-03:00");
  });

  it("rejects malformed or impossible dates", () => {
    for (const v of ["amanhã", "2026-02-30T10:00", "2026-13-01T10:00", "2026-12-05", undefined]) {
      expect(parseLocalDateTime(v), String(v)).toBeNull();
    }
  });
});
