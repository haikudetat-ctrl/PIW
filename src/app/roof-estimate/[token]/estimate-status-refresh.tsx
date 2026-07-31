"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function EstimateStatusRefresh({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const interval = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(interval);
  }, [pending, router]);
  return null;
}
