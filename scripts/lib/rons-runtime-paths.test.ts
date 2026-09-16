import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import { getOpenNovaRoot, getRonsRuntimePath } from "../../src/lib/rons-runtime-paths.server";

const keys = ["RONS_OPENNOVA_ROOT", "USERPROFILE", "HOME"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of keys) delete process.env[key];
});

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("RONS runtime paths", () => {
  it("prefers the explicit OpenNova root", () => {
    process.env.RONS_OPENNOVA_ROOT = path.join("C:\\RONS", "OpenNova");
    process.env.USERPROFILE = "C:\\Users\\Ignored";
    expect(getOpenNovaRoot()).toBe(path.join("C:\\RONS", "OpenNova"));
    expect(getRonsRuntimePath("promotion", "contacts.json")).toBe(
      path.join("C:\\RONS", "OpenNova", "runtime", "promotion", "contacts.json"),
    );
  });

  it("falls back to the current user home", () => {
    process.env.USERPROFILE = "C:\\Users\\Operator";
    expect(getOpenNovaRoot()).toBe(path.join("C:\\Users\\Operator", "Resonance", "OpenNova"));
  });

  it("fails closed when no root or home is available", () => {
    expect(() => getOpenNovaRoot()).toThrow("RONS_OPENNOVA_ROOT is not configured");
  });
});
