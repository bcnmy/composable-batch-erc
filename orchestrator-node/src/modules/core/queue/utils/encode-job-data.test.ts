import { describe, expect, it } from "vitest";
import { encodeJobData } from "./encode-job-data";

describe("encodeJobData", () => {
  it("should convert BigInt to string with 'n' suffix", () => {
    expect(encodeJobData(123n)).toBe("123n");
    expect(encodeJobData(0n)).toBe("0n");
  });

  it("should not modify regular strings", () => {
    expect(encodeJobData("hello")).toBe("hello");
    expect(encodeJobData("123")).toBe("123");
  });

  it("should recursively encode BigInt in arrays", () => {
    const input = [1n, "text", [2n, "3"]];
    const expected = ["1n", "text", ["2n", "3"]];
    expect(encodeJobData(input)).toEqual(expected);
  });

  it("should recursively encode BigInt in objects", () => {
    const input = { a: 5n, b: "test", nested: { c: 10n } };
    const expected = { a: "5n", b: "test", nested: { c: "10n" } };
    expect(encodeJobData(input)).toEqual(expected);
  });

  it("should leave numbers, booleans and null unchanged", () => {
    expect(encodeJobData(42)).toBe(42);
    expect(encodeJobData(true)).toBe(true);
    expect(encodeJobData(null)).toBe(null);
  });

  it("should handle deeply nested structures with BigInt", () => {
    const input = {
      level1: {
        level2: {
          arr: [100n, { value: 200n }],
        },
      },
    };
    const expected = {
      level1: {
        level2: {
          arr: ["100n", { value: "200n" }],
        },
      },
    };
    expect(encodeJobData(input)).toEqual(expected);
  });

  it("should not modify undefined values", () => {
    const input = { a: undefined, b: 1n };
    const output = encodeJobData(input);
    expect(Object.keys(output)).toContain("a");
    expect(output.b).toBe("1n");
  });
});
