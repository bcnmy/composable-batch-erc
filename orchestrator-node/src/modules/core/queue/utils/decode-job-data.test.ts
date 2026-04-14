import { describe, expect, it } from "vitest";
import { decodeJobData } from "./decode-job-data";

describe("decodeJobData", () => {
  it("should convert string with 'n' suffix to BigInt", () => {
    expect(decodeJobData("123n")).toBe(123n);
  });

  it("should not modify regular strings", () => {
    expect(decodeJobData("hello")).toBe("hello");
    expect(decodeJobData("123")).toBe("123");
    expect(decodeJobData("123N")).toBe("123N");
  });

  it("should recursively decode BigInt strings in arrays", () => {
    const input = ["1n", "text", ["2n", "3"]];
    const expected = [1n, "text", [2n, "3"]];
    expect(decodeJobData(input)).toEqual(expected);
  });

  it("should recursively decode BigInt strings in objects", () => {
    const input = { a: "5n", b: "test", nested: { c: "10n" } };
    const expected = { a: 5n, b: "test", nested: { c: 10n } };
    expect(decodeJobData(input)).toEqual(expected);
  });

  it("should leave numbers, booleans and null unchanged", () => {
    expect(decodeJobData(42)).toBe(42);
    expect(decodeJobData(true)).toBe(true);
    expect(decodeJobData(null)).toBe(null);
  });

  it("should handle deeply nested structures with BigInt strings", () => {
    const input = {
      level1: {
        level2: {
          arr: ["100n", { value: "200n" }],
        },
      },
    };
    const expected = {
      level1: {
        level2: {
          arr: [100n, { value: 200n }],
        },
      },
    };
    expect(decodeJobData(input)).toEqual(expected);
  });

  it("should not convert invalid BigInt-like strings", () => {
    expect(decodeJobData("123nz")).toBe("123nz");
    expect(decodeJobData("n123n")).toBe("n123n");
    expect(decodeJobData("12.3n")).toBe("12.3n");
  });
});
