import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & POPIA | The Resonance Hub" },
      { name: "description", content: "How The Resonance handles account, billing, usage, project, support, and technical data across Reson8.life." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy & POPIA"
      title="Privacy and data handling"
      summary="This policy explains the operational data practices used to run Reson8.life and the connected Resonance applications."
      sections={[
        {
          title: "Information we handle",
          body: (
            <>
              <p>Depending on the feature you use, we may handle account and contact details, authentication identifiers, billing and transaction metadata, app usage and project metadata, uploaded or generated content, support communications, and technical/security logs.</p>
              <p>Payment-card details are handled by the payment provider rather than stored as card data by the Resonance Hub.</p>
            </>
          ),
        },
        {
          title: "Why we use information",
          body: (
            <p>We use information to authenticate users, operate requested features, deliver entitlements, process and reconcile payments, provide support, prevent abuse, secure the service, recover failed workflows, and improve reliability and usability.</p>
          ),
        },
        {
          title: "Service providers and sharing",
          body: (
            <p>Information may be shared with service providers only where needed to operate the requested service, such as authentication, hosting, email, payments, analytics, or AI/media processing. We do not sell conversation, project, or account data to advertisers.</p>
          ),
        },
        {
          title: "Retention and deletion",
          body: (
            <p>We aim to retain personal information and project data only for as long as needed for the service, security, support, billing records, dispute handling, or applicable legal obligations. Where deletion is technically and legally available, users may request it through the contact address below.</p>
          ),
        },
        {
          title: "Your choices and rights",
          body: (
            <p>You may request access to or correction of personal information, object to certain processing, or request deletion where applicable. We may need to verify identity before acting on a request. Applicable POPIA and other mandatory rights are not limited by this policy.</p>
          ),
        },
        {
          title: "Security and incidents",
          body: (
            <p>We use access controls, audit logging, environment separation, and other technical safeguards appropriate to the service. If a qualifying personal-information security compromise occurs, notification and response will follow applicable requirements.</p>
          ),
        },
      ]}
    />
  );
}
