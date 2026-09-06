import { z } from "zod";
import type { RonsMcpTool } from "../index";

type UpdateEntry = {
  id?: string;
  title?: string;
  date?: string;
  summary?: string;
  url?: string;
  [key: string]: unknown;
};

const listUpdatesTool: RonsMcpTool = {
  name: "list_updates",
  title: "List Reson8 updates",
  description:
    "List recent Reson8 project updates published at /content/updates.json on the site.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of updates to return (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ limit }: { limit?: number }) => {
    const max = limit ?? 10;
    const res = await fetch("https://reson8.life/content/updates.json", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return {
        content: [{ type: "text" as const, text: `Failed to fetch updates: ${res.status}` }],
        isError: true,
      };
    }

    const raw = (await res.json()) as unknown;
    const arr: UpdateEntry[] = Array.isArray(raw)
      ? (raw as UpdateEntry[])
      : Array.isArray((raw as { updates?: UpdateEntry[] })?.updates)
        ? ((raw as { updates: UpdateEntry[] }).updates)
        : [];
    const items = arr.slice(0, max);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
      structuredContent: { items },
    };
  },
};

export default listUpdatesTool;