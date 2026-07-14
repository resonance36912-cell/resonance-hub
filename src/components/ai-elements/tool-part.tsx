import { useState } from "react";
import { ChevronRight, Wrench, Check, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToolPartLike = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function toolNameFromPart(part: ToolPartLike): string {
  if (part.toolName) return part.toolName;
  if (part.type === "dynamic-tool") return "tool";
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return part.type;
}

function formatJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolPart({ part }: { part: ToolPartLike }) {
  const [open, setOpen] = useState(false);
  const name = toolNameFromPart(part);
  const state = part.state ?? "input-streaming";
  const isError = state === "output-error";
  const isDone = state === "output-available";
  const isRunning = state === "input-streaming" || state === "input-available";

  const statusIcon = isError ? (
    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
  ) : isDone ? (
    <Check className="h-3.5 w-3.5 text-emerald-600" />
  ) : (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  );

  const statusLabel = isError
    ? "Error"
    : isDone
      ? "Completed"
      : isRunning
        ? state === "input-streaming"
          ? "Preparing…"
          : "Running…"
        : state;

  return (
    <div
      className={cn(
        "my-2 rounded-md border bg-background/60 text-sm",
        isError && "border-destructive/40 bg-destructive/5",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{name}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {statusIcon}
          <span>{statusLabel}</span>
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t px-3 py-2">
          {part.input !== undefined ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Arguments
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 text-xs">
                <code>{formatJson(part.input)}</code>
              </pre>
            </div>
          ) : null}

          {isError ? (
            <div>
              <div className="mb-1 text-xs font-medium text-destructive">Error</div>
              <pre className="max-h-64 overflow-auto rounded bg-destructive/10 p-2 text-xs text-destructive">
                <code>{part.errorText ?? formatJson(part.output) ?? "Unknown error"}</code>
              </pre>
            </div>
          ) : part.output !== undefined ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Result
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 text-xs">
                <code>{formatJson(part.output)}</code>
              </pre>
            </div>
          ) : null}

          {part.toolCallId ? (
            <div className="text-[10px] text-muted-foreground/70 font-mono">
              call_id: {part.toolCallId}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function isToolPart(part: { type: string }): part is ToolPartLike {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}
