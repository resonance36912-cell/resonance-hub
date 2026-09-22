const DEFAULT_GATEWAY = "http://127.0.0.1:58600";

type QueryRow = Record<string, unknown>;
type QueryData = QueryRow[] | QueryRow | null;
type QueryResult = {
  data: QueryData;
  error: Error | null;
  count?: number | null;
};
type QueryEnvelope = {
  data: QueryRow[];
  count?: number | null;
};
type Filter = { column: string; op: string; value: unknown };
type SelectOptions = { count?: "exact"; head?: boolean };

function gatewayUrl(): string {
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, "");
}

async function procedureKey(): Promise<string> {
  const path = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE?.trim();
  if (!path) throw new Error("Sovereign gateway procedure key path is not configured");
  const nodeFsPromises = "node:fs/promises";
  const { readFile } = await import(/* @vite-ignore */ nodeFsPromises);
  const key = (await readFile(path, "utf8")).trim();
  if (key.length < 32 || key.length > 4096) {
    throw new Error("Sovereign gateway procedure key is invalid");
  }
  return key;
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  procedure = false,
): Promise<T> {
  const endpoint = new URL(`${gatewayUrl()}${path}`);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
  ) {
    throw new Error("Sovereign database gateway must be loopback HTTP");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (procedure) headers["X-RONS-Procedure-Key"] = await procedureKey();

  const response = await fetch(endpoint, {
    method: "POST",
    // Keep redirect handling in this adapter so Cloudflare Workers can run the request.
    // Manual mode prevents fetch from forwarding the procedure key or query body.
    redirect: "manual",
    headers,
    body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Sovereign database request rejected redirect (${response.status})`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Sovereign database request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

function isQueryEnvelope(value: QueryRow[] | QueryEnvelope): value is QueryEnvelope {
  return !Array.isArray(value);
}

class SovereignQuery implements PromiseLike<QueryResult> {
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private values: unknown = null;
  private filters: Filter[] = [];
  private options: Record<string, unknown> = {};
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(private readonly table: string) {}

  select(columns = "*", options: SelectOptions = {}) {
    this.columns = columns;
    if (options.count) this.options.count = options.count;
    if (options.head === true) this.options.head = true;
    return this;
  }

  insert(values: unknown) {
    this.action = "insert";
    this.values = values;
    return this;
  }

  upsert(values: unknown, options: { onConflict?: string } = {}) {
    this.action = "upsert";
    this.values = values;
    if (options.onConflict) this.options.on_conflict = options.onConflict;
    return this;
  }

  update(values: unknown) {
    this.action = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  textSearch(column: string, query: string, _options?: unknown) {
    this.filters.push({ column, op: "text_search", value: query });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.options.order = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.options.limit = value;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  async then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const raw = await request<QueryRow[] | QueryEnvelope>("/v1/db/query", {
        table: this.table,
        action: this.action,
        columns: this.columns,
        values: this.values,
        filters: this.filters,
        options: this.options,
      });

      const rows = isQueryEnvelope(raw) ? raw.data : raw;
      if (
        (this.singleMode === "single" && rows.length !== 1) ||
        (this.singleMode === "maybeSingle" && rows.length > 1)
      ) {
        throw new Error(
          `Sovereign database ${this.singleMode} expected ${this.singleMode === "single" ? "exactly one row" : "at most one row"}; received ${rows.length}`,
        );
      }
      let data: QueryData = this.singleMode ? (rows[0] ?? null) : rows;

      if (!this.singleMode && this.columns !== "*") {
        const wanted = this.columns
          .split(",")
          .map((column) => column.trim())
          .filter(Boolean);
        data = rows.map((row) => Object.fromEntries(wanted.map((column) => [column, row[column]])));
      }

      const result: QueryResult = {
        data,
        error: null,
        ...(isQueryEnvelope(raw) ? { count: raw.count ?? null } : {}),
      };
      return onfulfilled ? await onfulfilled(result) : (result as TResult1);
    } catch (error) {
      const result: QueryResult = {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      return onfulfilled ? await onfulfilled(result) : (result as TResult1);
    }
  }
}

export function createSovereignDb() {
  return {
    from(table: string) {
      return new SovereignQuery(table);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      try {
        const result = await request<Record<string, unknown>>(
          "/v1/db/procedure",
          { name, args },
          true,
        );
        if (name === "nova_transition_job") {
          return { data: result.job ?? null, error: null };
        }
        if (name === "datanest_approve_memory" || name === "datanest_supersede_memory") {
          return { data: result.memory ?? null, error: null };
        }
        return { data: result, error: null };
      } catch (error) {
        return {
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}