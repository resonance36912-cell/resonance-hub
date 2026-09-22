import { readFile } from "node:fs/promises";
import { ingestDataNestEnvelope } from "../../src/lib/datanest/import-service.server";
import { normalizeChatGptExport, runImportEnvelopes } from "../../src/lib/datanest/importers";

const file = process.argv[2];
if (!file) throw new Error("usage: bun run scripts/datanest/import-chatgpt-export.ts <conversations.json>");
const normalized = normalizeChatGptExport(JSON.parse(await readFile(file, "utf8")));
const result = await runImportEnvelopes(normalized.envelopes, ingestDataNestEnvelope);
const summary = { ...result, normalization_errors: normalized.errors.length, input_duplicates: normalized.duplicates, completeness: normalized.errors.length || result.errors ? "partial" : "complete" };
console.log(JSON.stringify(summary, null, 2));
if (summary.completeness === "partial") process.exitCode = 1;
