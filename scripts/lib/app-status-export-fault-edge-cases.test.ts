import { describe, expect, it } from "vitest";
import {
  ExportEncoderFault,
  injectExportFault,
  parseFaultAts,
} from "../../src/lib/app-status-export-fault";

const body = "x".repeat(8192);

/** Emitted bytes for a fault, or null when the encoder finished cleanly. */
function emitted(raw: readonly (string | null)[] | string | null): number | null {
  try {
    injectExportFault(body, parseFaultAts(raw), "csv");
  } catch (error) {
    return (error as ExportEncoderFault).emittedBytes;
  }
  return null;
}

describe("parseFaultAts: extra commas", () => {
  it("ignores empty segments from leading, trailing and doubled commas", () => {
    expect(parseFaultAts(",1,")).toEqual([1]);
    expect(parseFaultAts(",,,1,,,2048,,,")).toEqual([1, 2048]);
    expect(parseFaultAts(",")).toEqual([]);
    expect(parseFaultAts(",,,,")).toEqual([]);
    expect(parseFaultAts([",", "64", ",,"])).toEqual([64]);
  });
});

describe("parseFaultAts: mixed delimiters and whitespace", () => {
  it("treats commas, spaces, tabs and newlines interchangeably", () => {
    expect(parseFaultAts("1, 2048")).toEqual([1, 2048]);
    expect(parseFaultAts("1 ,2048")).toEqual([1, 2048]);
    expect(parseFaultAts("1\t2048")).toEqual([1, 2048]);
    expect(parseFaultAts("1\n2048\r\n4096")).toEqual([1, 2048, 4096]);
    expect(parseFaultAts("  1 ,,  2048 \t, 4096  ")).toEqual([1, 2048, 4096]);
  });

  it("ignores whitespace-only params", () => {
    expect(parseFaultAts(["   ", "\t", "\n", "5"])).toEqual([5]);
    expect(parseFaultAts("   ")).toEqual([]);
  });
});

describe("parseFaultAts: dedupe and ordering", () => {
  it("collapses duplicates across params and delimiters", () => {
    expect(parseFaultAts(["512", "512, 512", " 512 "])).toEqual([512]);
    expect(parseFaultAts("3,1,2,3,2,1")).toEqual([1, 2, 3]);
  });

  it("sorts ascending regardless of input order", () => {
    expect(parseFaultAts("4096 1 2048")).toEqual([1, 2048, 4096]);
    expect(parseFaultAts(["9", "0"])).toEqual([0, 9]);
  });
});

describe("parseFaultAts: non-numeric tokens", () => {
  const junk = [
    "abc",
    "12abc",
    "1_000",
    "NaN",
    "Infinity",
    "-Infinity",
    "null",
    "undefined",
    "true",
    "[]",
    "{}",
    "1.5",
    "-1",
    "1/2",
    "１２３",
    "٣",
    "٣٤",
    "e5",
    ".",
    "+",
    "-",
  ];

  it("drops every non-numeric or non-integer token", () => {
    expect(parseFaultAts(junk.join(","))).toEqual([]);
    expect(parseFaultAts(junk)).toEqual([]);
  });

  it("keeps valid tokens mixed in with junk", () => {
    expect(parseFaultAts(["abc", "128", "1.5", "-2", "0"])).toEqual([0, 128]);
    expect(parseFaultAts("abc, 128 , NaN,,1.5 -3\t256")).toEqual([128, 256]);
  });

  it("accepts JS-numeric forms Number() coerces to integers", () => {
    expect(parseFaultAts("+5")).toEqual([5]);
    expect(parseFaultAts("1e3")).toEqual([1000]);
    expect(parseFaultAts("0x10")).toEqual([16]);
    expect(parseFaultAts("2.0")).toEqual([2]);
  });
});

describe("parseFaultAts: huge counts and huge values", () => {
  it("handles very long lists without losing the earliest offset", () => {
    const many = Array.from({ length: 5000 }, (_, i) => String(5000 - i)).join(",");
    const parsed = parseFaultAts(many);
    expect(parsed).toHaveLength(5000);
    expect(parsed[0]).toBe(1);
    expect(parsed[parsed.length - 1]).toBe(5000);
  });

  it("handles thousands of repeated params by collapsing them", () => {
    expect(parseFaultAts(Array.from({ length: 2000 }, () => "77"))).toEqual([77]);
  });

  it("keeps huge but valid integers, drops non-integer huge values", () => {
    expect(parseFaultAts("999999999999")).toEqual([999999999999]);
    expect(parseFaultAts("1e21")).toEqual([1e21]);
    expect(parseFaultAts("9".repeat(400))).toEqual([]); // Infinity → dropped
  });
});

describe("edge-case query strings still fault exactly once", () => {
  it("extra commas, mixed delimiters and junk all fault at the earliest offset", () => {
    const baseline = emitted("1");
    expect(baseline).toBe(1024);
    expect(emitted(",,1,,")).toBe(baseline);
    expect(emitted("  1 \t, 2048 ,, 4096 ")).toBe(baseline);
    expect(emitted(["abc", "1", "-9", "1.5"])).toBe(baseline);
    expect(emitted(Array.from({ length: 500 }, () => "1"))).toBe(baseline);
  });

  it("junk-only and empty-only query strings never fault", () => {
    expect(emitted(",,,,")).toBeNull();
    expect(emitted("   ")).toBeNull();
    expect(emitted(["abc", "-1", "1.5", ""])).toBeNull();
    expect(emitted(null)).toBeNull();
  });

  it("out-of-range offsets mixed with junk never fault", () => {
    expect(emitted([`${body.length}`, "abc", `${body.length + 5000}`])).toBeNull();
  });
});
