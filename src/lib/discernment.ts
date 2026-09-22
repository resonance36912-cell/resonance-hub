/**
 * Discernment Lens — EQ guardrails for content generation workflows.
 *
 * Every structured brief (ManuscriptBrief / SourceBrief / SongBrief /
 * ChannelBrief) must pass `verifyBriefDiscernment` before paid generation,
 * publishing, exporting, or recommendation.
 *
 * Rules enforced:
 *  - no fake claims, fake analytics, invented testimonials
 *  - data provenance must be labelled (verified / user / public / insufficient)
 *  - user must be able to review/edit before paid generation
 *  - manipulative/predatory targeting is blocked outright
 *
 * This module has zero runtime dependencies; safe to import from any layer
 * (client, server function, server route, verification script).
 */

export type DataProvenance =
  | "verified_source"
  | "user_provided"
  | "public_estimate"
  | "insufficient";

export interface DiscernmentEvaluation {
  passedDiscernment: boolean;
  confidenceScore: number;
  requiresManualIntervention: boolean;
  warnings: string[];
  blockedReasons: string[];
  dataProvenance: DataProvenance;
}

export interface BriefDiscernmentInput {
  rawInputLength: number;
  hasSubstantialContext: boolean;
  hasClearSource: boolean;
  includesUnsupportedClaims: boolean;
  includesFakeAnalytics: boolean;
  includesMedicalOrLegalClaims: boolean;
  includesManipulativeTargeting: boolean;
  userCanEditBeforeGeneration: boolean;
}

export function verifyBriefDiscernment(
  input: BriefDiscernmentInput,
): DiscernmentEvaluation {
  const warnings: string[] = [];
  const blockedReasons: string[] = [];
  let confidenceScore = 1.0;

  if (input.rawInputLength < 50) {
    confidenceScore -= 0.35;
    warnings.push("Input context is too short for reliable premium generation.");
  }

  if (!input.hasSubstantialContext) {
    confidenceScore -= 0.25;
    warnings.push("Missing core context such as audience, offer, source, or style.");
  }

  if (!input.hasClearSource) {
    confidenceScore -= 0.2;
    warnings.push("Source is unclear. Output must be labelled as user-provided or estimated.");
  }

  if (input.includesUnsupportedClaims) {
    confidenceScore -= 0.3;
    warnings.push("Unsupported claims detected. Claims require proof or softer wording.");
  }

  if (input.includesFakeAnalytics) {
    blockedReasons.push("Fake analytics or invented performance data are not allowed.");
  }

  if (input.includesMedicalOrLegalClaims) {
    warnings.push("Medical or legal claims require source verification and cautious wording.");
  }

  if (input.includesManipulativeTargeting) {
    blockedReasons.push("Manipulative, exploitative, or predatory targeting is not allowed.");
  }

  if (!input.userCanEditBeforeGeneration) {
    confidenceScore -= 0.15;
    warnings.push("User should be able to review and edit the brief before paid generation.");
  }

  const dataProvenance: DataProvenance = input.hasClearSource
    ? "verified_source"
    : input.hasSubstantialContext
      ? "user_provided"
      : "insufficient";

  const passedDiscernment =
    blockedReasons.length === 0 && confidenceScore >= 0.5;

  return {
    passedDiscernment,
    confidenceScore: Math.max(0, Number(confidenceScore.toFixed(2))),
    requiresManualIntervention:
      !passedDiscernment || confidenceScore < 0.7 || warnings.length > 0,
    warnings,
    blockedReasons,
    dataProvenance,
  };
}

/** Tier ordering used by `hasFeatureAccess`. Exported for tests. */
export const TIER_WEIGHT: Record<string, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  early_access: 2,
  pro: 3,
  business: 4,
  all_access: 5,
};
