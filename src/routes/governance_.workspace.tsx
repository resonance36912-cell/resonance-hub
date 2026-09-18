import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import {
  addGovernanceEvidence,
  addGovernanceReview,
  createGovernanceProposal,
  getGovernanceProposal,
  listGovernanceParticipants,
  listGovernanceProposals,
  recordGovernanceDecision,
  registerGovernanceAgent,
  submitGovernanceProposal,
} from "@/lib/governance/functions";

export const Route = createFileRoute("/governance_/workspace")({
  head: () => ({
    meta: [
      { title: "Governance Workspace — The Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { next: "/governance/workspace" } });
    }
  },
  component: GovernanceWorkspace,
});

type Proposal = {
  id: string;
  title: string;
  summary: string;
  body?: string;
  status: string;
  version: number;
  created_by: string;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

type Participant = {
  id: string;
  kind: "human" | "ai" | "service";
  slug: string;
  display_name: string;
  role_label: string;
  status: string;
  created_at: string;
};

type Evidence = {
  id: string;
  label: string;
  kind: string;
  uri: string | null;
  sha256: string | null;
  summary: string | null;
  created_at: string;
};

type Review = {
  id: string;
  stance: string;
  rationale: string;
  confidence: number | null;
  evidence_ids: string[];
  created_at: string;
  participant?: Participant;
};

type Decision = {
  id: string;
  outcome: string;
  rationale: string;
  decided_by: string;
  created_at: string;
};

type GovernanceEvent = {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  participant_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ProposalDetail = {
  proposal: Proposal & { body: string };
  evidence: Evidence[];
  reviews: Review[];
  decision: Decision | null;
  events: GovernanceEvent[];
};

const REVIEWABLE = new Set(["submitted", "under_review", "decision_ready", "deferred"]);
const DECIDABLE = new Set(["submitted", "under_review", "decision_ready", "deferred"]);

function GovernanceWorkspace() {
  const qc = useQueryClient();
  const listProposals = useServerFn(listGovernanceProposals);
  const listParticipants = useServerFn(listGovernanceParticipants);
  const getProposal = useServerFn(getGovernanceProposal);
  const createProposal = useServerFn(createGovernanceProposal);
  const submitProposal = useServerFn(submitGovernanceProposal);
  const addEvidence = useServerFn(addGovernanceEvidence);
  const addReview = useServerFn(addGovernanceReview);
  const recordDecision = useServerFn(recordGovernanceDecision);
  const registerAgent = useServerFn(registerGovernanceAgent);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<"reference" | "artifact" | "hash" | "note">(
    "reference",
  );
  const [evidenceUri, setEvidenceUri] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [stance, setStance] = useState<"support" | "oppose" | "neutral" | "abstain">("neutral");
  const [reviewRationale, setReviewRationale] = useState("");
  const [confidence, setConfidence] = useState("0.5");
  const [decisionOutcome, setDecisionOutcome] = useState<"approved" | "declined" | "deferred">(
    "approved",
  );
  const [decisionRationale, setDecisionRationale] = useState("");
  const [agentKind, setAgentKind] = useState<"ai" | "service">("ai");
  const [agentSlug, setAgentSlug] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("");

  const authQ = useQuery({
    queryKey: ["governance-auth-user"],
    queryFn: async () => {
      const { data, error } = await ronsAuth.getUser();
      if (error || !data.user) throw new Error("Authentication required");
      return data.user;
    },
  });

  const adminQ = useQuery({
    queryKey: ["governance-is-admin", authQ.data?.id],
    enabled: Boolean(authQ.data?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authQ.data!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

  const proposalsQ = useQuery({
    queryKey: ["governance-proposals"],
    queryFn: async () => (await listProposals()).proposals as Proposal[],
  });

  const participantsQ = useQuery({
    queryKey: ["governance-participants"],
    queryFn: async () => (await listParticipants()).participants as Participant[],
  });

  useEffect(() => {
    const proposals = proposalsQ.data ?? [];
    if (!selectedId && proposals[0]) setSelectedId(proposals[0].id);
    if (selectedId && !proposals.some((proposal) => proposal.id === selectedId)) {
      setSelectedId(proposals[0]?.id ?? null);
    }
  }, [proposalsQ.data, selectedId]);

  const detailQ = useQuery({
    queryKey: ["governance-proposal", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await getProposal({ data: { id: selectedId! } })) as ProposalDetail,
  });

  const refreshSelected = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["governance-proposals"] }),
      qc.invalidateQueries({ queryKey: ["governance-proposal", selectedId] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: () => createProposal({ data: { title, summary, body, metadata: {} } }),
    onSuccess: async (result) => {
      const proposal = result.proposal as Proposal;
      setTitle("");
      setSummary("");
      setBody("");
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ["governance-proposals"] });
      setSelectedId(proposal.id);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitProposal({
        data: { id: detailQ.data!.proposal.id, expected_version: detailQ.data!.proposal.version },
      }),
    onSuccess: refreshSelected,
  });

  const evidenceMutation = useMutation({
    mutationFn: () =>
      addEvidence({
        data: {
          proposal_id: detailQ.data!.proposal.id,
          label: evidenceLabel,
          kind: evidenceKind,
          ...(evidenceUri ? { uri: evidenceUri } : {}),
          ...(evidenceSummary ? { summary: evidenceSummary } : {}),
        },
      }),
    onSuccess: async () => {
      setEvidenceLabel("");
      setEvidenceUri("");
      setEvidenceSummary("");
      await refreshSelected();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      addReview({
        data: {
          proposal_id: detailQ.data!.proposal.id,
          stance,
          rationale: reviewRationale,
          confidence: Number(confidence),
          evidence_ids: [],
        },
      }),
    onSuccess: async () => {
      setReviewRationale("");
      await refreshSelected();
      await qc.invalidateQueries({ queryKey: ["governance-participants"] });
    },
  });

  const decisionMutation = useMutation({
    mutationFn: () =>
      recordDecision({
        data: {
          proposal_id: detailQ.data!.proposal.id,
          expected_version: detailQ.data!.proposal.version,
          outcome: decisionOutcome,
          rationale: decisionRationale,
        },
      }),
    onSuccess: async () => {
      setDecisionRationale("");
      await refreshSelected();
    },
  });

  const agentMutation = useMutation({
    mutationFn: () =>
      registerAgent({
        data: {
          kind: agentKind,
          slug: agentSlug,
          display_name: agentName,
          role_label: agentRole,
          metadata: {},
        },
      }),
    onSuccess: async () => {
      setAgentSlug("");
      setAgentName("");
      setAgentRole("");
      await qc.invalidateQueries({ queryKey: ["governance-participants"] });
    },
  });

  const detail = detailQ.data;
  const isAdmin = adminQ.data === true;
  const isCreator = detail?.proposal.created_by === authQ.data?.id;
  const board = useMemo(
    () => (participantsQ.data ?? []).filter((participant) => participant.kind !== "human"),
    [participantsQ.data],
  );
  const error =
    createMutation.error ||
    submitMutation.error ||
    evidenceMutation.error ||
    reviewMutation.error ||
    decisionMutation.error ||
    agentMutation.error;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1500px] px-4 py-8 md:px-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Resonance · Governed Workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Governance Workspace</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Proposals, evidence, human review, advisory AI/service participants, canonical
              decisions, and an append-only audit timeline.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/governance" className="text-primary hover:underline">
              Constitution
            </Link>
            <Link to="/" className="text-primary hover:underline">
              Back to Hub
            </Link>
            <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
              {isAdmin ? "Admin decision authority" : "Authenticated participant"}
            </span>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error instanceof Error ? error.message : "Governance action failed"}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_330px]">
          <aside className="space-y-4">
            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Proposal Registry</h2>
                <button
                  onClick={() => setCreateOpen((v) => !v)}
                  className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  {createOpen ? "Close" : "New"}
                </button>
              </div>
              {createOpen && (
                <form
                  className="mb-4 space-y-2 border-b pb-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createMutation.mutate();
                  }}
                >
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Proposal title"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    minLength={3}
                    maxLength={180}
                  />
                  <textarea
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Executive summary"
                    className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    minLength={10}
                    maxLength={1200}
                  />
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Full proposal body"
                    className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    minLength={20}
                    maxLength={20000}
                  />
                  <button
                    disabled={createMutation.isPending}
                    className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Creating…" : "Create draft"}
                  </button>
                </form>
              )}
              <div className="space-y-2">
                {proposalsQ.isLoading && (
                  <p className="text-sm text-muted-foreground">Loading proposals…</p>
                )}
                {(proposalsQ.data ?? []).map((proposal) => (
                  <button
                    key={proposal.id}
                    onClick={() => setSelectedId(proposal.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${selectedId === proposal.id ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-tight">{proposal.title}</span>
                      <Status status={proposal.status} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {proposal.summary}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      v{proposal.version} · {formatDate(proposal.updated_at)}
                    </p>
                  </button>
                ))}
                {!proposalsQ.isLoading && (proposalsQ.data?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground">No proposals yet.</p>
                )}
              </div>
            </section>
          </aside>

          <main className="min-w-0 space-y-4">
            {!selectedId && <EmptyCard text="Create or select a proposal to begin." />}
            {selectedId && detailQ.isLoading && <EmptyCard text="Loading proposal…" />}
            {detail && (
              <>
                <section className="rounded-xl border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2">
                        <Status status={detail.proposal.status} />
                        <span className="text-xs text-muted-foreground">
                          Version {detail.proposal.version}
                        </span>
                      </div>
                      <h2 className="text-2xl font-semibold tracking-tight">
                        {detail.proposal.title}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {detail.proposal.summary}
                      </p>
                    </div>
                    {detail.proposal.status === "draft" && isCreator && (
                      <button
                        disabled={submitMutation.isPending}
                        onClick={() => submitMutation.mutate()}
                        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                      >
                        {submitMutation.isPending ? "Submitting…" : "Submit for review"}
                      </button>
                    )}
                  </div>
                  <div className="mt-5 whitespace-pre-wrap rounded-lg border bg-background p-4 text-sm leading-7">
                    {detail.proposal.body}
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-xl border bg-card p-5">
                    <h3 className="font-semibold">Evidence</h3>
                    <form
                      className="mt-3 grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        evidenceMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <input
                          value={evidenceLabel}
                          onChange={(e) => setEvidenceLabel(e.target.value)}
                          placeholder="Evidence label"
                          className="rounded-md border bg-background px-3 py-2 text-sm"
                          required
                          maxLength={180}
                        />
                        <select
                          value={evidenceKind}
                          onChange={(e) => setEvidenceKind(e.target.value as typeof evidenceKind)}
                          className="rounded-md border bg-background px-2 py-2 text-sm"
                        >
                          <option value="reference">Reference</option>
                          <option value="artifact">Artifact</option>
                          <option value="hash">Hash</option>
                          <option value="note">Note</option>
                        </select>
                      </div>
                      <input
                        value={evidenceUri}
                        onChange={(e) => setEvidenceUri(e.target.value)}
                        placeholder="Optional https:// reference"
                        type="url"
                        className="rounded-md border bg-background px-3 py-2 text-sm"
                      />
                      <textarea
                        value={evidenceSummary}
                        onChange={(e) => setEvidenceSummary(e.target.value)}
                        placeholder="Optional evidence summary"
                        className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
                        maxLength={2000}
                      />
                      <button
                        disabled={evidenceMutation.isPending}
                        className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      >
                        Add evidence
                      </button>
                    </form>
                    <div className="mt-4 space-y-2">
                      {detail.evidence.map((item) => (
                        <div key={item.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium">{item.label}</span>
                            <span className="text-xs text-muted-foreground">{item.kind}</span>
                          </div>
                          {item.summary && (
                            <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                          )}
                          {item.uri && (
                            <a
                              href={item.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block truncate text-xs text-primary hover:underline"
                            >
                              {item.uri}
                            </a>
                          )}
                        </div>
                      ))}
                      {detail.evidence.length === 0 && (
                        <p className="text-sm text-muted-foreground">No evidence attached.</p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-xl border bg-card p-5">
                    <h3 className="font-semibold">Human Review</h3>
                    {REVIEWABLE.has(detail.proposal.status) ? (
                      <form
                        className="mt-3 grid gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          reviewMutation.mutate();
                        }}
                      >
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                          <select
                            value={stance}
                            onChange={(e) => setStance(e.target.value as typeof stance)}
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                          >
                            <option value="support">Support</option>
                            <option value="oppose">Oppose</option>
                            <option value="neutral">Neutral</option>
                            <option value="abstain">Abstain</option>
                          </select>
                          <input
                            value={confidence}
                            onChange={(e) => setConfidence(e.target.value)}
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            aria-label="Confidence"
                          />
                        </div>
                        <textarea
                          value={reviewRationale}
                          onChange={(e) => setReviewRationale(e.target.value)}
                          placeholder="Review rationale"
                          className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
                          required
                          minLength={10}
                          maxLength={8000}
                        />
                        <button
                          disabled={reviewMutation.isPending}
                          className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                        >
                          Record review
                        </button>
                      </form>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Reviews open after submission and close after a final decision.
                      </p>
                    )}
                    <div className="mt-4 space-y-2">
                      {detail.reviews.map((review) => (
                        <div key={review.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">
                              {review.participant?.display_name ?? "Reviewer"}
                            </span>
                            <span className="text-xs uppercase text-muted-foreground">
                              {review.stance}
                              {review.confidence !== null
                                ? ` · ${Math.round(review.confidence * 100)}%`
                                : ""}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {review.rationale}
                          </p>
                        </div>
                      ))}
                      {detail.reviews.length === 0 && (
                        <p className="text-sm text-muted-foreground">No reviews recorded.</p>
                      )}
                    </div>
                  </section>
                </div>

                {isAdmin && DECIDABLE.has(detail.proposal.status) && !detail.decision && (
                  <section className="rounded-xl border border-primary/30 bg-card p-5">
                    <h3 className="font-semibold">Canonical Decision</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Admin-gated human authority. AI/service participants remain advisory.
                    </p>
                    <form
                      className="mt-3 grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        decisionMutation.mutate();
                      }}
                    >
                      <select
                        value={decisionOutcome}
                        onChange={(e) =>
                          setDecisionOutcome(e.target.value as typeof decisionOutcome)
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <option value="approved">Approve</option>
                        <option value="declined">Decline</option>
                        <option value="deferred">Defer</option>
                      </select>
                      <textarea
                        value={decisionRationale}
                        onChange={(e) => setDecisionRationale(e.target.value)}
                        placeholder="Decision rationale"
                        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
                        required
                        minLength={10}
                        maxLength={10000}
                      />
                      <button
                        disabled={decisionMutation.isPending}
                        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                      >
                        Record canonical decision
                      </button>
                    </form>
                  </section>
                )}

                {detail.decision && (
                  <section className="rounded-xl border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">Decision Record</h3>
                      <Status status={detail.decision.outcome} />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {detail.decision.rationale}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Recorded {formatDate(detail.decision.created_at)}
                    </p>
                  </section>
                )}

                <section className="rounded-xl border bg-card p-5">
                  <h3 className="font-semibold">Audit Timeline</h3>
                  <div className="mt-3 space-y-3">
                    {detail.events.map((event) => (
                      <div
                        key={event.id}
                        className="grid grid-cols-[120px_1fr] gap-3 border-l-2 border-border pl-3 text-sm"
                      >
                        <span className="text-xs text-muted-foreground">
                          {formatDate(event.created_at)}
                        </span>
                        <div>
                          <p className="font-medium">{event.event_type}</p>
                          {Object.keys(event.metadata ?? {}).length > 0 && (
                            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                              {JSON.stringify(event.metadata)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </main>

          <aside className="space-y-4">
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Advisory Board</h2>
                <span className="text-xs text-muted-foreground">{board.length} agents</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Registered AI/service identities are explicit and auditable. They do not hold final
                decision authority.
              </p>
              <div className="mt-3 space-y-2">
                {board.map((participant) => (
                  <div key={participant.id} className="rounded-lg border p-3">
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium">{participant.display_name}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {participant.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{participant.role_label}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {participant.slug}
                    </p>
                  </div>
                ))}
                {board.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No AI/service participants registered.
                  </p>
                )}
              </div>
            </section>

            {isAdmin && (
              <section className="rounded-xl border bg-card p-4">
                <h3 className="font-semibold">Register Advisory Agent</h3>
                <form
                  className="mt-3 grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    agentMutation.mutate();
                  }}
                >
                  <select
                    value={agentKind}
                    onChange={(e) => setAgentKind(e.target.value as typeof agentKind)}
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="ai">AI</option>
                    <option value="service">Service</option>
                  </select>
                  <input
                    value={agentSlug}
                    onChange={(e) => setAgentSlug(e.target.value)}
                    placeholder="agent-slug"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    minLength={2}
                    maxLength={80}
                    pattern="[a-z0-9][a-z0-9_-]*"
                  />
                  <input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Display name"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    maxLength={120}
                  />
                  <input
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
                    placeholder="Advisory role"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    required
                    maxLength={160}
                  />
                  <button
                    disabled={agentMutation.isPending}
                    className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Register agent
                  </button>
                </form>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Status({ status }: { status: string }) {
  return (
    <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {status.replaceAll("_", " ")}
    </span>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}
