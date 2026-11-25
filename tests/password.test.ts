import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("s3cret");
    expect(stored).not.toContain("s3cret");
    expect(await verifyPassword("s3cret", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});
