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
 * Parses the dev-only `faultAt` query parameter.
 * Returns null when absent, empty, negative, or not a finite integer.
 */
export function parseFaultAt(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Walks `body` in chunks as an incremental encoder would and throws once at
 * least `faultAt` bytes have been "emitted".
 *
 * Offsets at or beyond the body length never fault: the encoder finished before
 * reaching them, so the export must succeed normally.
 */
export function injectExportFault(
  body: Uint8Array | string,
  faultAt: number | null,
  format: string,
): void {
  if (faultAt === null) return;
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  const total = bytes.byteLength;
  if (faultAt >= total) return;

  let emitted = 0;
  while (emitted < total) {
    emitted = Math.min(emitted + CHUNK, total);
    if (emitted >= faultAt) {
      throw new ExportEncoderFault(format, emitted, total);
    }
  }
}
