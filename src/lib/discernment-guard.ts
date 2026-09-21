/**
 * Discernment guard helpers — shared across spoke apps.
 *
 * Spoke generation routes (ePublisher, Creative Studio, Sync Vision,
 * YouTube Optimizer) MUST call `assertBriefDiscernment` before producing
 * any paid output, and MUST label the output with `formatProvenanceLabel`.
 */

import {
  verifyBriefDiscernment,
  type BriefDiscernmentInput,
  type DataProvenance,
  type DiscernmentEvaluation,
} from "./discernment";

export class DiscernmentBlockedError extends Error {
  readonly code = "DISCERNMENT_BLOCKED";
  readonly evaluation: DiscernmentEvaluation;

  constructor(evaluation: DiscernmentEvaluation) {
    super(
      evaluation.blockedReasons[0] ??
        "Brief did not meet discernment thresholds for paid generation.",
    );
    this.name = "DiscernmentBlockedError";
    this.evaluation = evaluation;
  }
}

/**
 * Throws `DiscernmentBlockedError` if the brief fails discernment.
 * Returns the full evaluation so callers can attach warnings to the response.
 *
 * Usage in a spoke server function:
 *
 *   const evaluation = assertBriefDiscernment(briefDiscernmentInput);
 *   const provenanceLabel = formatProvenanceLabel(evaluation.dataProvenance);
 */
export function assertBriefDiscernment(
  input: BriefDiscernmentInput,
): DiscernmentEvaluation {
  const evaluation = verifyBriefDiscernment(input);
  if (!evaluation.passedDiscernment) {
    throw new DiscernmentBlockedError(evaluation);
  }
  return evaluation;
}

export interface ProvenanceLabel {
  provenance: DataProvenance;
  short: string;
  long: string;
  tone: "positive" | "neutral" | "caution" | "blocked";
}

/**
 * Renders a consistent provenance badge for paid outputs across the suite.
 * Spokes should display `short` in compact UI and `long` in tooltips/exports.
 */
export function formatProvenanceLabel(
  provenance: DataProvenance,
): ProvenanceLabel {
  switch (provenance) {
    case "verified_source":
      return {
        provenance,
        short: "Verified source",
        long: "Generated from a verified source supplied by you.",
        tone: "positive",
      };
    case "user_provided":
      return {
        provenance,
        short: "User-provided",
        long: "Generated from context you provided. Not independently verified.",
        tone: "neutral",
      };
    case "public_estimate":
      return {
        provenance,
        short: "Estimated",
        long: "Generated from public estimates. Treat as directional, not factual.",
        tone: "caution",
      };
    case "insufficient":
      return {
        provenance,
        short: "Insufficient context",
        long: "Not enough context to generate a reliable paid output. Add more detail.",
        tone: "blocked",
      };
  }
}
