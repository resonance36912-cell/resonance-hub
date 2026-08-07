/**
 * Dev-only fault injection for the app-status CSV/XLSX exports.
 *
 * The endpoint encodes the whole export in memory before it builds a Response,
 * so a producer that dies part-way through can never reach the client as a
 * truncated attachment. This helper lets tests prove that invariant by
 * simulating an encoder that fails *after* it has already emitted N bytes.
 *
 * Never enabled in production: the caller gates every use on import.meta.env.DEV.
 */

/** Chunk size used to walk the encoded body, mimicking an incremental encoder. */
const CHUNK = 1024;

export class ExportEncoderFault extends Error {
  constructor(
    readonly format: string,
    readonly emittedBytes: number,
    readonly totalBytes: number,
  ) {
    super(
      `injected ${format} encoder failure after ${emittedBytes} of ${totalBytes} bytes`,
    );
    this.name = "ExportEncoderFault";
  }
}

/**
 * Parses a single dev-only `faultAt` value.
 * Returns null when absent, empty, negative, or not a finite integer.
 */
export function parseFaultAt(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Parses one or more dev-only `faultAt` values.
 *
 * Accepts repeated query params (`?faultAt=1&faultAt=2048`) and/or
 * comma/space-separated lists (`?faultAt=1,2048`). Invalid entries are dropped.
 * The result is de-duplicated and sorted ascending, so the *earliest* offset
 * wins and the encoder can only ever fail once.
 */
export function parseFaultAts(raw: readonly (string | null)[] | string | null): number[] {
  const list = raw === null ? [] : typeof raw === "string" ? [raw] : [...raw];
  const offsets = new Set<number>();
  for (const entry of list) {
    if (entry === null) continue;
    for (const part of entry.split(/[,\s]+/)) {
      const value = parseFaultAt(part);
      if (value !== null) offsets.add(value);
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

/**
 * Walks `body` in chunks as an incremental encoder would and throws once at
 * least the earliest applicable offset has been "emitted".
 *
 * Accepts a single offset or a list of offsets; with several offsets the encoder
 * still dies exactly once (at the first one it reaches), so the client always
 * sees a single clean JSON error rather than partial attachment bytes.
 *
 * Offsets at or beyond the body length never fault: the encoder finished before
 * reaching them, so the export must succeed normally.
 */
export function injectExportFault(
  body: Uint8Array | string,
  faultAt: number | readonly number[] | null,
  format: string,
): void {
  if (faultAt === null) return;
  const offsets = (typeof faultAt === "number" ? [faultAt] : [...faultAt]).sort(
    (a, b) => a - b,
  );
  if (offsets.length === 0) return;

  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  const total = bytes.byteLength;
  const reachable = offsets.filter((o) => o < total);
  if (reachable.length === 0) return;
  const target = reachable[0]!;

  let emitted = 0;
  while (emitted < total) {
    emitted = Math.min(emitted + CHUNK, total);
    if (emitted >= target) {
      throw new ExportEncoderFault(format, emitted, total);
    }
  }
}

