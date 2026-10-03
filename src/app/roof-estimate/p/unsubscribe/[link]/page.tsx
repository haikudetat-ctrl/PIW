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
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#edf2f3] px-4 text-slate-950">
      <div className="w-full max-w-md text-center">
        {done === "1" ? (
          <>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">You’re unsubscribed.</h1>
            <p className="mt-4 text-base leading-7 text-slate-600">We won’t send you any more roof report emails.</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">Stop roof report emails?</h1>
            <p className="mt-4 text-base leading-7 text-slate-600">You won’t receive any more reminders about this roof estimate.</p>
            <form method="post" action={`/api/property-preview/unsubscribe/${encodeURIComponent(link)}`} className="mt-7">
              <input type="hidden" name="confirm" value="1" />
              <button type="submit" className="min-h-12 w-full rounded-xl bg-slate-950 px-5 text-base font-bold text-white hover:bg-slate-800">
                Unsubscribe
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
