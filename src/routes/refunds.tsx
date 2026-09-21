import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";

export const Route = createFileRoute("/refunds")({
  head: () => ({
    meta: [
      { title: "Refunds & Billing Resolution | The Resonance Hub" },
      { name: "description", content: "How billing errors, duplicate charges, failed paid jobs, cancellations, credits, and refunds are handled across Resonance services." },
    ],
  }),
  component: RefundsPage,
});

function RefundsPage() {
  return (
    <PolicyPage
      eyebrow="Refunds & Billing"
      title="Refund and billing-resolution policy"
      summary="We distinguish recurring-pass cancellation, billing errors, failed paid work, and future once-off pack purchases so customers know what happens in each case."
      sections={[
        {
          title: "Ecosystem-pass cancellation",
          body: (
            <p>Cancelling an ecosystem pass stops future renewal. A completed billing period is generally treated as consumed once access has been delivered, subject to duplicate charges, verified billing errors, service failures, and any mandatory statutory rights.</p>
          ),
        },
        {
          title: "Duplicate or incorrect charges",
          body: (
            <p>If a duplicate or incorrect charge is confirmed, we will correct the account and arrange the appropriate refund or payment reversal through the available payment process.</p>
          ),
        },
        {
          title: "Failed paid generation or delivery",
          body: (
            <p>If the platform consumes a paid credit but fails to deliver the promised usable result because of a verified service failure, the normal remedy is to restore the consumed credit or re-run the job. Where restoration is not appropriate, support can review a refund.</p>
          ),
        },
        {
          title: "Once-off packs",
          body: (
            <p>Once-off pack checkout is not currently enabled on the Hub. Pack routes are availability/waitlist pages and do not take payment. Before one-time checkout is activated, the applicable refund and credit-consumption rules will be displayed before purchase.</p>
          ),
        },
        {
          title: "How to request a review",
          body: (
            <p>Email hello@reson8.life with the account email, transaction reference, affected app, date, and a short description. Do not send card numbers, passwords, private keys, or other authentication secrets.</p>
          ),
        },
      ]}
    />
  );
}
