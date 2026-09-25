import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from "./route";

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

test("redirects a successful code exchange only to a local path", async () => {
  const request = new NextRequest(
    "https://piw-sepia.vercel.app/auth/callback?code=valid-code&next=https://attacker.example",
  );

  const response = await GET(request);

  expect(response.headers.get("location")).toBe("https://piw-sepia.vercel.app/");
});
