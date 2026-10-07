/** Header for the quiet preview screens: the tenant's logo, or its name when it has none. */
export function QuietHeader({brandName, logoUrl}: {brandName: string; logoUrl?: string}) {
  return (
    <header className="quiet-header">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={brandName} className="quiet-logo" />
      ) : (
        brandName.toUpperCase()
      )}
    </header>
  );
}
