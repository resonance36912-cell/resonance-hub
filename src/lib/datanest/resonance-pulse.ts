export type PulseAuthority = {
  origin: "explicit" | "inferred";
  confirmed_by_user: boolean;
};

export type PulseRequestSignals = {
  majorDecision?: boolean;
  repeatedFailure?: boolean;
  breakthrough?: boolean;
  contradiction?: boolean;
  ambiguousPreference?: boolean;
  routineSuccess?: boolean;
};

export function pulseCanReinforce(pulse: PulseAuthority): boolean {
  return pulse.origin === "explicit" || pulse.confirmed_by_user;
}

export function shouldRequestPulse(signals: PulseRequestSignals): boolean {
  if (signals.routineSuccess) return false;
  return Boolean(
    signals.majorDecision ||
      signals.repeatedFailure ||
      signals.breakthrough ||
      signals.contradiction ||
      signals.ambiguousPreference,
  );
}
