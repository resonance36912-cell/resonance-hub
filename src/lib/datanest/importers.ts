export type ImportEnvelope = {
  source_key: string;
  external_id: string;
  content_type: string;
  occurred_at?: string;
  source_uri?: string;
  visibility: "private" | "shareable";
  content: string;
  metadata: Record<string, unknown>;
};

export type ImportFailure = { index: number; error: string };
export type ImportNormalizationResult = {
  envelopes: ImportEnvelope[];
  duplicates: number;
  errors: ImportFailure[];
  completeness: "partial" | "complete";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

function normalizeEnvelope(value: unknown, defaultSourceKey: string): ImportEnvelope {
  if (!isRecord(value)) throw new Error("row_not_object");
  const sourceKey = typeof value.source_key === "string" && value.source_key.trim()
    ? value.source_key.trim()
    : defaultSourceKey.trim();
  if (!sourceKey) throw new Error("source_key_required");
  if (typeof value.external_id !== "string" || !value.external_id.trim()) throw new Error("external_id_required");
  if (typeof value.content_type !== "string" || !value.content_type.trim()) throw new Error("content_type_required");
  if (typeof value.content !== "string") throw new Error("content_must_be_string");
  const visibility = value.visibility === "shareable" ? "shareable" : value.visibility === "private" ? "private" : null;
  if (!visibility) throw new Error("visibility_invalid");
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const occurredAt = normalizeTimestamp(value.occurred_at);
  const sourceUri = typeof value.source_uri === "string" && value.source_uri.trim() ? value.source_uri.trim() : undefined;
  return {
    source_key: sourceKey,
    external_id: value.external_id.trim(),
    content_type: value.content_type.trim(),
    ...(occurredAt ? { occurred_at: occurredAt } : {}),
    ...(sourceUri ? { source_uri: sourceUri } : {}),
    visibility,
    content: value.content,
    metadata,
  };
}

export function parseImportJsonl(text: string, defaultSourceKey: string): ImportNormalizationResult {
  const envelopes: ImportEnvelope[] = [];
  const errors: ImportFailure[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const envelope = normalizeEnvelope(JSON.parse(line), defaultSourceKey);
      const identity = \`\${envelope.source_key}\0\${envelope.external_id}\0\${envelope.content}\`;
      if (seen.has(identity)) { duplicates += 1; continue; }
      seen.add(identity);
      envelopes.push(envelope);
    } catch (error) {
      errors.push({ index: index + 1, error: error instanceof Error ? error.message : "invalid_row" });
    }
  }
  return { envelopes, duplicates, errors, completeness: errors.length > 0 ? "partial" : "complete" };
}

function serializeContentParts(parts: unknown[]): { content: string; nonTextParts: number } {
  let nonTextParts = 0;
  const content = parts.map((part) => {
    if (typeof part === "string") return part;
    nonTextParts += 1;
    try { return JSON.stringify(part); } catch { return "[UNSERIALIZABLE_PART]"; }
  }).join("\n");
  return { content, nonTextParts };
}

export function normalizeChatGptExport(input: unknown): ImportNormalizationResult {
  if (!Array.isArray(input)) throw new Error("invalid_chatgpt_export");
  const envelopes: ImportEnvelope[] = [];
  const errors: ImportFailure[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let nodeIndex = 0;

  for (const rawConversation of input) {
    if (!isRecord(rawConversation)) {
      errors.push({ index: nodeIndex += 1, error: "conversation_not_object" });
      continue;
    }
    const conversationId = String(rawConversation.id ?? rawConversation.conversation_id ?? \`conversation-\${nodeIndex + 1}\`);
    const title = typeof rawConversation.title === "string" ? rawConversation.title : "";
    const mapping = isRecord(rawConversation.mapping) ? rawConversation.mapping : {};
    for (const [mappingKey, rawNode] of Object.entries(mapping)) {
      nodeIndex += 1;
      try {
        if (!isRecord(rawNode) || !isRecord(rawNode.message)) continue;
        const message = rawNode.message;
        const contentObject = isRecord(message.content) ? message.content : {};
        const parts = Array.isArray(contentObject.parts) ? contentObject.parts : [];
        const { content, nonTextParts } = serializeContentParts(parts);
        if (!content && parts.length === 0) continue;
        const messageId = String(message.id ?? rawNode.id ?? mappingKey);
        const parentId = typeof rawNode.parent === "string" ? rawNode.parent : null;
        const exactIdentity = JSON.stringify({ messageId, parentId, content });
        if (seen.has(exactIdentity)) { duplicates += 1; continue; }
        seen.add(exactIdentity);
        const occurredAt = normalizeTimestamp(message.create_time);
        const author = isRecord(message.author) && typeof message.author.role === "string" ? message.author.role : "unknown";
        envelopes.push({
          source_key: "chatgpt-export",
          external_id: \`chatgpt:\${conversationId}:\${messageId}:\${mappingKey}\`,
          content_type: "application/vnd.openai.chat-message+json",
          ...(occurredAt ? { occurred_at: occurredAt } : {}),
          visibility: "private",
          content,
          metadata: {
            conversation_id: conversationId,
            conversation_title: title,
            node_id: String(rawNode.id ?? mappingKey),
            parent_id: parentId,
            author_role: author,
            non_text_parts: nonTextParts,
          },
        });
      } catch (error) {
        errors.push({ index: nodeIndex, error: error instanceof Error ? error.message : "invalid_message" });
      }
    }
  }
  return { envelopes, duplicates, errors, completeness: errors.length > 0 ? "partial" : "complete" };
}

export type GitHistoryRecord = {
  hash: string;
  occurred_at?: string;
  message: string;
  author?: string;
  source_uri?: string;
};

export function normalizeGitHistory(records: readonly GitHistoryRecord[], sourceKey: string): ImportNormalizationResult {
  const envelopes: ImportEnvelope[] = [];
  const errors: ImportFailure[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  records.forEach((record, index) => {
    try {
      const hash = String(record.hash ?? "").trim();
      if (!hash) throw new Error("commit_hash_required");
      if (seen.has(hash)) {
        duplicates += 1;
        return;
      }
      seen.add(hash);
      const occurredAt = normalizeTimestamp(record.occurred_at);
      envelopes.push({
        source_key: sourceKey,
        external_id: \`git:\${hash}\`,
        content_type: "application/vnd.git.commit+json",
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        ...(record.source_uri ? { source_uri: record.source_uri } : {}),
        visibility: "private",
        content: String(record.message ?? ""),
        metadata: { commit_hash: hash, author: String(record.author ?? "") },
      });
    } catch (error) {
      errors.push({ index: index + 1, error: error instanceof Error ? error.message : "invalid_commit" });
    }
  });
  return { envelopes, duplicates, errors, completeness: errors.length > 0 ? "partial" : "complete" };
}

export async function runImportEnvelopes(
  envelopes: readonly ImportEnvelope[],
  ingest: (envelope: ImportEnvelope) => Promise<{ duplicate?: boolean } | void>,
) {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const failures: ImportFailure[] = [];
  for (let index = 0; index < envelopes.length; index += 1) {
    try {
      const result = await ingest(envelopes[index]);
      if (result?.duplicate) duplicates += 1;
      else imported += 1;
    } catch (error) {
      errors += 1;
      failures.push({ index: index + 1, error: error instanceof Error ? error.message : "ingest_failed" });
    }
  }
  return {
    discovered: envelopes.length,
    imported,
    duplicates,
    errors,
    failures,
    completeness: errors > 0 ? "partial" as const : "complete" as const,
  };
}
