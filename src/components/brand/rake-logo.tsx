// RAKE wordmark from the brand kit (Drive: RAKE/Logo Files/RAKE_BLK_Logo.svg),
// filled with currentColor so it follows the surrounding text colour.
export function RakeLogo({ className, title = "Rake" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 1914.77 542.82" role="img" aria-label={title} className={className} fill="currentColor">
      <path d="M257.63,319.83h-125.96v216.93H0V.51h238.11c60.4,0,106.87,13.75,139.4,41.25,32.53,27.5,48.8,67.53,48.8,120.07,0,33.4-9.02,62.49-27.07,87.29-18.05,24.8-43.15,43.34-75.32,55.61l125.96,227.61v4.42h-75.87l-116.38-216.93ZM131.67,262.01h108.65c35.11,0,63.04-9.1,83.79-27.3,20.75-18.2,31.12-42.56,31.12-73.06,0-33.21-9.89-58.66-29.65-76.37-19.77-17.71-48.31-26.69-85.63-26.94h-108.28v203.67Z" />
      <path d="M606.36,536.77h-133.51L677.63.51h122.46l205.15,536.25h-72.56l-165.63-432.24-160.69,432.24Z" />
      <path d="M1178.69,242.89L1391.89,6.57h85.45l-211.04,236.82,227.61,299.43h-84.71l-190.05-249.34" />
      <path d="M1644.8,288.38v190.05h269.97v57.82h-401.27V0h397.58v57.82h-266.28v230.56Z" />
      <polygon points="1701.84 239.21 1905.37 239.21 1905.37 297.04 1701.54 297.04" />
      <rect x="1023.31" y="5.65" width="131.3" height="536.25" />
      <rect x="786.25" y="491.75" width="43.62" height="43.62" />
      <rect x="786.25" y="426.2" width="43.62" height="43.62" />
      <rect x="720.69" y="426.2" width="43.62" height="43.62" />
      <rect x="720.69" y="491.75" width="43.62" height="43.62" />
    </svg>
  );
}

// Footer lockup for tenant-branded customer pages: the tenant owns the page,
// Rake is credited as the platform.
export function PoweredByRake({ className }: { className?: string }) {
  return (
    <a
      href="https://rake.2-stack.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-400 transition hover:text-slate-600 ${className ?? ""}`}
    >
      <span>Powered by</span>
      <RakeLogo className="h-3 w-auto" title="Rake" />
    </a>
  );
}
