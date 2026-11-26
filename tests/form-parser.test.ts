import { describe, expect, it } from "vitest";
import { parseFormBody } from "../src/lib/form-parser.js";

describe("form body parser", () => {
  it("decodes UTF-8 (browsers) and Latin-1 (curl on Windows) the same way", () => {
    expect(parseFormBody("name=Jazz+no+Por%C3%A3o")).toEqual({ name: "Jazz no Porão" });
    expect(parseFormBody("name=Jazz+no+Por%E3o&venue=Bar+do+Z%E9")).toEqual({
      name: "Jazz no Porão",
      venue: "Bar do Zé",
    });
  });

  it("handles empty values, keys without values and repeated keys", () => {
    expect(parseFormBody("a=&b&a=2&c=1%2C5")).toEqual({ a: "", b: "", c: "1,5" });
    expect(parseFormBody("")).toEqual({});
  });
});
