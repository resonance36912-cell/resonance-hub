import { FormEvent } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const QUICK_ACTIONS = ["Create", "Research", "Build", "Automate", "Publish"] as const;

export function NovaComposer({
  value,
  onChange,
  onSubmit,
  busy = false,
  disabled = false,
  placeholder = "Ask Nova anything…",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy || disabled) return;
    void onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#c9cfde] bg-[#fbfbfc] p-3 shadow-sm dark:border-border dark:bg-card">
      <Textarea
        aria-label="Ask Nova"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || busy}
        className="min-h-[76px] resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" disabled title="Project attachments are added through the project asset flow.">
            <Paperclip className="size-4" /> Attach
          </Button>
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => onChange(value.trim() ? `${value.trim()}\n\n${action}: ` : `${action}: `)}
            >
              {action}
            </Button>
          ))}
        </div>
        <Button type="submit" size="icon" disabled={disabled || busy || !value.trim()} aria-label={busy ? "Nova is working" : "Send to Nova"}>
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </form>
  );
}
