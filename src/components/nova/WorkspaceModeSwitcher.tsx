export function WorkspaceModeSwitcher() {
  return <nav aria-label="Workspace modes">{["Content","Products","Media","Research","Brand","Apps"].map(mode=><button type="button" key={mode}>{mode}</button>)}</nav>;
}
export default WorkspaceModeSwitcher;
