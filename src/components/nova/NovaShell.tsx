import { useState, type ReactNode } from "react";
import { Menu, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NovaCanvas } from "@/components/nova/NovaCanvas";
import { NovaComposer } from "@/components/nova/NovaComposer";
import { NovaDecisionTray, type NovaDecisionSummary } from "@/components/nova/NovaDecisionTray";
import { NovaIntelligenceRail } from "@/components/nova/NovaIntelligenceRail";
import { NovaNavigator } from "@/components/nova/NovaNavigator";
import { RsgpStatus } from "@/components/nova/RsgpStatus";
import type { NovaJobSummary } from "@/components/nova/NovaJobProgress";

export type NovaDisplayMode = "simple" | "creator" | "builder" | "admin_rd";

export function NovaShell({
  children,
  projectId,
  projectName,
  jobs = [],
  decisions = [],
  memoryCount = 0,
  providerLabel,
  showStarterActions = false,
  onStarterAction,
  composerValue,
  onComposerChange,
  onComposerSubmit,
  composerBusy = false,
  composerDisabled = false,
}: {
  children: ReactNode;
  projectId?: string;
  projectName?: string;
  jobs?: NovaJobSummary[];
  decisions?: NovaDecisionSummary[];
  memoryCount?: number;
  providerLabel?: string;
  showStarterActions?: boolean;
  onStarterAction?: (action: string) => void;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onComposerSubmit: (value: string) => void | Promise<void>;
  composerBusy?: boolean;
  composerDisabled?: boolean;
}) {
  const [mode, setMode] = useState<NovaDisplayMode>("creator");

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#1a1c26] dark:bg-background dark:text-foreground">
      <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between border-b border-border/60 bg-white/95 px-4 backdrop-blur dark:bg-background/95 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open Nova navigation"><Menu className="size-5" /></Button></SheetTrigger>
              <SheetContent side="left" className="border-0 bg-[#141721] p-3 text-white"><SheetHeader className="sr-only"><SheetTitle>Nova navigation</SheetTitle></SheetHeader><NovaNavigator projectId={projectId} /></SheetContent>
            </Sheet>
          </div>
          <div className="truncate">
            <p className="text-lg font-semibold sm:text-[22px]">RONSAS · Nova Studio</p>
            {projectName && <p className="truncate text-xs text-muted-foreground">{projectName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="hidden text-xs text-muted-foreground md:flex md:items-center md:gap-2">
            View
            <select value={mode} onChange={(event) => setMode(event.target.value as NovaDisplayMode)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <option value="simple">Simple</option><option value="creator">Creator</option><option value="builder">Builder</option><option value="admin_rd">Admin/R&amp;D</option>
            </select>
          </label>
          <RsgpStatus />
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open Nova intelligence"><PanelRight className="size-5" /></Button></SheetTrigger>
              <SheetContent side="right" className="p-3"><SheetHeader className="sr-only"><SheetTitle>Nova intelligence</SheetTitle></SheetHeader><NovaIntelligenceRail jobs={jobs} decisions={decisions} memoryCount={memoryCount} providerLabel={providerLabel} /></SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-72px)] gap-[18px] p-[18px] lg:grid-cols-[230px_minmax(0,1fr)_310px]">
        <div className="hidden lg:block"><NovaNavigator projectId={projectId} /></div>
        <div className="min-w-0 space-y-[18px]">
          <NovaCanvas showStarterActions={showStarterActions} onStarterAction={onStarterAction}>{children}</NovaCanvas>
          <div className="sticky bottom-3 z-20"><NovaComposer value={composerValue} onChange={onComposerChange} onSubmit={onComposerSubmit} busy={composerBusy} disabled={composerDisabled} /></div>
          {mode === "simple" && decisions.length > 0 && <div className="lg:hidden"><NovaDecisionTray decisions={decisions} /></div>}
        </div>
        <div className="hidden lg:block"><NovaIntelligenceRail jobs={jobs} decisions={decisions} memoryCount={memoryCount} providerLabel={providerLabel} /></div>
      </div>
    </div>
  );
}
