import {LeadWebhookForm} from "@/components/lead-webhook-form";

export default function Home() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Rake Roofing</p>
        <h1>A sturdier roof starts with a straightforward conversation.</h1>
        <p className="lede">
          This deployable shell is ready for campaign content. Its lead form
          already uses the staging-safe intake proxy and preserves Meta click
          attribution.
        </p>
      </section>
      <LeadWebhookForm />
    </main>
  );
}
