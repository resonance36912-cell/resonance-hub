import path from "node:path";

export function getOpenNovaRoot(): string {
  const configured = process.env.RONS_OPENNOVA_ROOT?.trim();
  if (configured) return configured;

  const home = process.env.USERPROFILE?.trim() || process.env.HOME?.trim();
  if (!home) {
    throw new Error("RONS_OPENNOVA_ROOT is not configured and no user home directory is available");
  }
  return path.join(home, "Resonance", "OpenNova");
}

export function getRonsRuntimePath(...parts: string[]): string {
  return path.join(getOpenNovaRoot(), "runtime", ...parts);
}
