import {renderPublicHtml} from "../lib/static-html";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = await renderPublicHtml(["index.html"]);
  if (!html) return new Response("Not found", {status: 404});

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
