export type MemoryPlasticity = {
  weight: number;
  plasticity: number;
  confidence: number;
  protection: "working" | "learned" | "canonical" | "governance";
};

export type PlasticitySignal = {
  evidence?: number;
  validatedSuccess?: number;
  humanReinforcement?: number;
  contradiction?: number;
  staleness?: number;
  retrievalOnly?: number;
  approvedGovernanceEventId?: string;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function applyPlasticityUpdate(
  current: MemoryPlasticity,
  signal: PlasticitySignal,
): MemoryPlasticity {
  if (current.protection === "governance" && !signal.approvedGovernanceEventId) {
    return current;
  }

  const onlyRetrieval =
    (signal.retrievalOnly ?? 0) > 0 &&
    (signal.evidence ?? 0) === 0 &&
    (signal.validatedSuccess ?? 0) === 0 &&
    (signal.humanReinforcement ?? 0) === 0 &&
    (signal.contradiction ?? 0) === 0 &&
    (signal.staleness ?? 0) === 0;
  if (onlyRetrieval) return { ...current };

  const delta =
    0.12 * (signal.evidence ?? 0) +
    0.16 * (signal.validatedSuccess ?? 0) +
    0.14 * (signal.humanReinforcement ?? 0) -
    0.18 * (signal.contradiction ?? 0) -
    0.06 * (signal.staleness ?? 0);

  return {
    ...current,
    weight: clamp01(current.weight + delta * current.plasticity),
  };
}
