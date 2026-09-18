import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage } from "@/components/PolicyPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service | The Resonance Hub" },
      { name: "description", content: "Operational terms for using Reson8.life, Resonance applications, ecosystem passes, trials, and published pack offers." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Terms of Service"
      title="Terms for using Resonance services"
      summary="These terms describe the operational conditions for accessing Reson8.life and connected Resonance applications."
      sections={[
        {
          title: "Accounts and access",
          body: (
            <p>You are responsible for keeping account credentials secure and for activity performed through your account. Access may be suspended where needed to protect users, systems, payment integrity, or applicable law.</p>
          ),
        },
        {
          title: "AI-assisted outputs",
          body: (
            <p>Resonance tools can produce AI-assisted text, images, audio, video concepts, analysis, and recommendations. Outputs can contain errors or unsuitable suggestions and should be reviewed before publication, purchase decisions, professional use, or other consequential use.</p>
          ),
        },
        {
          title: "Inputs, outputs, and rights",
          body: (
            <p>You remain responsible for having the rights needed to upload or submit source material. We do not claim ownership of your original source material. Rights in generated outputs may depend on applicable law and on any third-party provider terms used to create them.</p>
          ),
        },
        {
          title: "Pricing and availability",
          body: (
            <>
              <p>Ecosystem passes are recurring Hub products billed through PayFast where checkout is shown as active. Individual-app once-off pack pricing may be published before one-time checkout is enabled; where this applies, the Hub labels the route as a waitlist and no pack payment is taken.</p>
              <p>Legacy monthly app plans may remain available only for existing subscribers while migration is completed.</p>
            </>
          ),
        },
        {
          title: "Acceptable use",
          body: (
            <p>Do not use the services to violate law, infringe rights, bypass security, access another user&apos;s data, distribute malware, overload infrastructure, or submit material you are not entitled to use.</p>
          ),
        },
        {
          title: "Availability and changes",
          body: (
            <p>Features, providers, limits, and pricing may change as the ecosystem develops. Material commercial changes should be disclosed before they apply to a new purchase or renewal. We may pause a feature when needed for security, reliability, maintenance, or provider availability.</p>
          ),
        },
      ]}
    />
  );
}
