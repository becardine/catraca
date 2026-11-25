import { describe, expect, it } from "vitest";
import { newId, randomToken } from "../src/lib/ids.js";

describe("newId", () => {
  it.each(["usr", "evt", "tkt", "custom"])(
    "preserves the %s prefix and appends 10 lowercase alphabet characters",
    (prefix) => {
      const id = newId(prefix);

      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(id).toMatch(new RegExp(`^${prefix}_[23456789abcdefghjkmnpqrstvwxyz]{10}$`));
    },
  );

  it("generates 1000 unique ids with the same prefix", () => {
    const ids = Array.from({ length: 1000 }, () => newId("tkt"));

    expect(new Set(ids).size).toBe(1000);
  });
});

describe("randomToken", () => {
  it.each([0, 1, 10, 32, 128])(
    "returns exactly %i characters using only the allowed alphabet",
    (length) => {
      const token = randomToken(length);

      expect(token).toHaveLength(length);
      expect(token).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]*$/);
    },
  );
});
