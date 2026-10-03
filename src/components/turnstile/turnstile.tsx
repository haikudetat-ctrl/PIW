"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile, rendered explicitly so the token can be refreshed
// after each submission. Invisible in most cases; Cloudflare shows an
// interactive check only when it needs one. The server verifies the token.

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

type TurnstileWindow = Window & {turnstile?: TurnstileApi; __piwTurnstilePromise?: Promise<void>};

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<void> {
  const win = window as TurnstileWindow;
  if (win.turnstile) return Promise.resolve();
  win.__piwTurnstilePromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.append(script);
  });
  return win.__piwTurnstilePromise;
}

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  resetKey = 0,
}: {
  siteKey: string;
  action: string;
  onToken(token: string | null): void;
  // Bump to request a fresh token (tokens are single-use).
  resetKey?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCallback = useRef(onToken);

  useEffect(() => {
    tokenCallback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile().then(() => {
      const api = (window as TurnstileWindow).turnstile;
      if (cancelled || !api || !container.current || widgetId.current) return;
      widgetId.current = api.render(container.current, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        callback: (token: string) => tokenCallback.current(token),
        "expired-callback": () => tokenCallback.current(null),
        "error-callback": () => tokenCallback.current(null),
      });
    }).catch(() => tokenCallback.current(null));
    return () => {
      cancelled = true;
      const api = (window as TurnstileWindow).turnstile;
      if (api && widgetId.current) api.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action, siteKey]);

  useEffect(() => {
    const api = (window as TurnstileWindow).turnstile;
    if (resetKey > 0 && api && widgetId.current) {
      tokenCallback.current(null);
      api.reset(widgetId.current);
    }
  }, [resetKey]);

  return <div ref={container} data-testid="turnstile-widget" />;
}
