import type { ReactNode } from "react";
import { PoweredByRake } from "@/components/brand/rake-logo";

// Homeowner estimate pages carry the tenant's brand; Rake is credited once,
// quietly, below the page content.
export default function RoofEstimateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <footer className="flex justify-center px-4 pt-2 pb-8">
        <PoweredByRake />
      </footer>
    </>
  );
}
