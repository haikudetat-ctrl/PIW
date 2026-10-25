import type {ReactNode} from "react";

/**
 * Navy header for the estimate screens. It shows the tenant's on-dark logo;
 * without one, its regular logo drawn in white; without a logo, its name.
 * `children` sit on the right (the fast quote's phone number).
 */
export function QuietHeader({brandName, logoUrl, logoOnDarkUrl, className, children}: {
  brandName: string;
  logoUrl?: string;
  logoOnDarkUrl?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={className ? `quiet-header ${className}` : "quiet-header"}>
      {logoOnDarkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoOnDarkUrl} alt={brandName} className="quiet-logo" />
      ) : logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={brandName} className="quiet-logo quiet-logo-mono" />
      ) : (
        <span className="quiet-brand-name">{brandName.toUpperCase()}</span>
      )}
      {children}
    </header>
  );
}
