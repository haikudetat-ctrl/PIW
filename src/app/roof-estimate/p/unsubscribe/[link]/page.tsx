import { loadQuietBrand } from "../../../quiet/quiet-brand";
import { QuietHeader } from "../../../quiet/quiet-header";
import "../../../quiet/quiet.css";

export const metadata = {robots: {index: false, follow: false}};

export default async function PreviewUnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{link: string}>;
  searchParams: Promise<{done?: string}>;
}) {
  const {link} = await params;
  const {done} = await searchParams;
  const brand = await loadQuietBrand();
  return (
    <main className="quiet-flow">
      <div className="quiet-frame">
        <QuietHeader brandName={brand.name} logoUrl={brand.logoUrl} />
        <section className="quiet-body">
          {done === "1" ? (
            <>
              <h1 className="quiet-question">You’re unsubscribed.</h1>
              <p className="quiet-lede">We won’t send you any more roof report emails.</p>
            </>
          ) : (
            <>
              <h1 className="quiet-question">Stop roof report emails?</h1>
              <p className="quiet-lede">You won’t receive any more reminders about this roof estimate.</p>
              <form method="post" action={`/api/property-preview/unsubscribe/${encodeURIComponent(link)}`} className="quiet-form">
                <input type="hidden" name="confirm" value="1" />
                <button type="submit" className="quiet-submit">Unsubscribe</button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
