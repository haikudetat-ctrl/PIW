import {renderPublicHtml} from "../../../lib/static-html";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {params: Promise<{path: string[]}>},
) {
  const {path} = await context.params;
  const html = await renderPublicHtml(path);
  if (!html) return new Response("Not found", {status: 404});

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
