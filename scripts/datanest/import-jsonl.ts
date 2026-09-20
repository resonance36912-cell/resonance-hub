import { readFile } from "node:fs/promises";
import { ingestDataNestEnvelope } from "../../src/lib/datanest/import-service.server";
import { parseImportJsonl, runImportEnvelopes } from "../../src/lib/datanest/importers";

const file = process.argv[2];
const sourceKey = process.argv[3] ?? "jsonl-import";
if (!file) throw new Error("usage: bun run scripts/datanest/import-jsonl.ts <file> [source-key]");
const normalized = parseImportJsonl(await readFile(file, "utf8"), sourceKey);
const result = await runImportEnvelopes(normalized.envelopes, ingestDataNestEnvelope);
const summary = { ...result, normalization_errors: normalized.errors.length, input_duplicates: normalized.duplicates, completeness: normalized.errors.length || result.errors ? "partial" : "complete" };
console.log(JSON.stringify(summary, null, 2));
if (summary.completeness === "partial") process.exitCode = 1;
