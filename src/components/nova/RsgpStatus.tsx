export function RsgpStatus() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
      <span>RSGP ✓ Governed</span>
      <span className="sr-only">RSGP governance controls are active for this Nova workspace.</span>
    </div>
  );
}
