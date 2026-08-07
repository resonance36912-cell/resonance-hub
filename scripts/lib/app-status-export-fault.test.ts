import { describe, expect, it } from "vitest";
import {
  ExportEncoderFault,
  injectExportFault,
  parseFaultAt,
  parseFaultAts,
} from "../../src/lib/app-status-export-fault";

const body = "x".repeat(8192);

describe("parseFaultAt", () => {
  it("accepts non-negative integers and rejects everything else", () => {
    expect(parseFaultAt("0")).toBe(0);
    expect(parseFaultAt("1024")).toBe(1024);
    expect(parseFaultAt(null)).toBeNull();
    expect(parseFaultAt("")).toBeNull();
    expect(parseFaultAt("  ")).toBeNull();
    expect(parseFaultAt("-1")).toBeNull();
    expect(parseFaultAt("1.5")).toBeNull();
    expect(parseFaultAt("abc")).toBeNull();
  });
});

describe("parseFaultAts", () => {
  it("parses repeated params, comma and space lists", () => {
    expect(parseFaultAts(["1", "2048"])).toEqual([1, 2048]);
    expect(parseFaultAts("1,2048,64")).toEqual([1, 64, 2048]);
    expect(parseFaultAts(["4096 512", "1"])).toEqual([1, 512, 4096]);
  });

  it("drops invalid entries, de-duplicates and sorts ascending", () => {
    expect(parseFaultAts(["nope", "-3", "", "5,5,3"])).toEqual([3, 5]);
    expect(parseFaultAts([null, "7"])).toEqual([7]);
    expect(parseFaultAts(null)).toEqual([]);
    expect(parseFaultAts([])).toEqual([]);
  });
});

describe("injectExportFault with multiple offsets", () => {
  it("does nothing without offsets", () => {
    expect(() => injectExportFault(body, null, "csv")).not.toThrow();
    expect(() => injectExportFault(body, [], "csv")).not.toThrow();
  });

  it("fails exactly once, at the earliest reachable offset", () => {
    let thrown: ExportEncoderFault | null = null;
    try {
      injectExportFault(body, [4096, 1, 2048], "csv");
    } catch (error) {
      thrown = error as ExportEncoderFault;
    }
    expect(thrown).toBeInstanceOf(ExportEncoderFault);
    expect(thrown!.name).toBe("ExportEncoderFault");
    expect(thrown!.format).toBe("csv");
    // Earliest offset (1) is reached in the first 1 KB chunk.
    expect(thrown!.emittedBytes).toBe(1024);
    expect(thrown!.totalBytes).toBe(body.length);
  });

  it("is order-independent", () => {
    const emitted = (offsets: number[]) => {
      try {
        injectExportFault(body, offsets, "csv");
      } catch (error) {
        return (error as ExportEncoderFault).emittedBytes;
      }
      return null;
    };
    expect(emitted([2048, 5000])).toBe(emitted([5000, 2048]));
  });

  it("ignores offsets at or beyond the body length", () => {
    expect(() =>
      injectExportFault(body, [body.length, body.length + 10_000], "xlsx"),
    ).not.toThrow();
  });

  it("still faults when only one of many offsets is reachable", () => {
    expect(() => injectExportFault(body, [999_999, 4096], "xlsx")).toThrow(
      ExportEncoderFault,
    );
  });

  it("treats a single number the same as a one-element list", () => {
    const one = (() => {
      try {
        injectExportFault(body, 3000, "csv");
      } catch (error) {
        return (error as ExportEncoderFault).emittedBytes;
      }
      return null;
    })();
    const many = (() => {
      try {
        injectExportFault(body, [3000], "csv");
      } catch (error) {
        return (error as ExportEncoderFault).emittedBytes;
      }
      return null;
    })();
    expect(one).toBe(many);
  });
});
