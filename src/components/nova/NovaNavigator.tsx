import { Link } from "@tanstack/react-router";
import { BrainCircuit, FolderKanban, Home, Landmark, Layers3 } from "lucide-react";

const WORKSPACE_SECTIONS = ["Create", "Build", "Research", "Assets", "Publish", "Collaborate", "Automate", "Insights"];

export function NovaNavigator({ projectId }: { projectId?: string }) {
  return (
    <aside className="flex h-full flex-col rounded-[18px] bg-[#141721] px-4 py-[18px] text-[#e5e8f2] shadow-sm">
      <div className="mb-5 flex items-center gap-2 px-2 text-sm font-semibold tracking-[0.18em]">
        <BrainCircuit className="size-4" /> NOVA
      </div>
      <nav aria-label="Nova workspace navigation" className="space-y-1 text-sm">
        <Link to="/nova" className="flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <Home className="size-4" /> Home
        </Link>
        {projectId ? (
          <Link to="/nova/projects/$projectId" params={{ projectId }} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <FolderKanban className="size-4" /> Project
          </Link>
        ) : (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-white/60"><FolderKanban className="size-4" /> Projects</div>
        )}
        {WORKSPACE_SECTIONS.map((label) => (
          <button key={label} type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" title={`${label} stays inside the current RONSAS Project Graph.`}>
            <Layers3 className="size-4" /> {label}
          </button>
        ))}
        <Link to="/myify" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <Layers3 className="size-4" /> DataNest
        </Link>
        <Link to="/governance/workspace" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <Landmark className="size-4" /> Governance
        </Link>
      </nav>
    </aside>
  );
}
