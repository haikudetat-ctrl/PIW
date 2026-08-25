import Image from "next/image";
import Link from "next/link";
import type {CSSProperties} from "react";
import {campaignThemeCssVariables} from "../../../../shared/all-season-campaign-themes";
import {CampaignEstimateForm} from "./campaign-estimate-form";
import type {CampaignDefinition} from "./campaigns";

const processSteps = [
  ["Tell us about your home", "Choose the address so we begin with the right property and the right roof."],
  ["Get a clear first look", "We review what we can see and explain whether an inspection, repair, or replacement may make sense."],
  ["Talk with one local team", "An All Season specialist answers your questions and walks you through the options without pressure."],
] as const;

export function CampaignLandingPage({campaign}: {campaign: CampaignDefinition}) {
  const accentWords = new Set(campaign.bridgeAccents.map((word) => word.toLowerCase()));
  const headlineParts = campaign.bridgeHeadline.split(/(\s+)/);

  return (
    <main
      className="campaign-page"
      data-theme={campaign.visual.theme}
      style={campaignThemeCssVariables(campaign.visual) as CSSProperties}
    >
      <nav className="campaign-nav" aria-label="Campaign navigation">
        <Link className="campaign-brand" href="/" aria-label="All Season home">
          <Image src="/assets/all-season-sun.svg" alt="" width={48} height={48} />
          <span><strong>ALL SEASON</strong><small>Roofing &amp; Solar</small></span>
        </Link>
        <a className="campaign-phone" href="tel:+18888325050"><small>Talk to a local specialist</small><strong>(888) 832-5050</strong></a>
      </nav>

      <section className="campaign-hero">
        <div className="campaign-ad-ambient" aria-hidden="true">
          <Image src={campaign.image} alt="" fill priority sizes="100vw" />
        </div>
        <div className="campaign-ad-foreground">
          <Image src={campaign.image} alt={campaign.imageAlt} fill priority sizes="(max-width: 760px) 100vw, 62vw" />
        </div>
        <div className="campaign-conversion" id="estimate">
          <div className="campaign-bridge">
            <span>Start with confidence</span>
            <h1>
              {headlineParts.map((part, index) => {
                const word = part.toLowerCase().replace(/[^a-z0-9]/g, "");
                return accentWords.has(word)
                  ? <strong key={`${part}-${index}`}>{part}</strong>
                  : part;
              })}
            </h1>
            <p>{campaign.bridgeCopy}</p>
          </div>
          <CampaignEstimateForm campaign={campaign} />
        </div>
      </section>

      <section className="campaign-proof" aria-label="All Season proof points">
        {campaign.proofItems.map((item) => (
          <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>
        ))}
      </section>

      <section className="campaign-story">
        <div>
          <h2>{campaign.sectionTitle}</h2>
        </div>
        <p>{campaign.sectionCopy}</p>
      </section>

      <section className="campaign-process">
        {processSteps.map(([title, copy]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <footer className="campaign-footer">
        <p><strong>ALL SEASON</strong> | One New Jersey team before, during, and after the work.</p>
        <a href="#estimate">Get my roof estimate ↑</a>
      </footer>
    </main>
  );
}
