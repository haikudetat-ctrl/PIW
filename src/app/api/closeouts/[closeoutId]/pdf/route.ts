import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { renderCloseoutPackage } from "@/modules/closeouts/package-data";
import { CLOSEOUT_BUCKET } from "@/modules/closeouts/photo-prep";

export const runtime = "nodejs";
export const maxDuration = 60;

// Signed-in preview of a closeout package. The closeout is read through
// the user's session first, so row level security decides who may see it.
// Once filed, this serves the exact PDF sent to JobNimbus.
export async function GET(_request: Request, ctx: { params: Promise<{ closeoutId: string }> }) {
  const parsedId = z.uuid().safeParse((await ctx.params).closeoutId);
  if (!parsedId.success) return NextResponse.json({ error: "not found" }, { status: 404 });
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: closeout } = await supabase.from("job_closeouts").select("id").eq("id", parsedId.data).maybeSingle();
  if (!closeout) return NextResponse.json({ error: "not found" }, { status: 404 });

  const service = createServiceClient();
  const { data: filed } = await service
    .from("job_closeout_jobnimbus_writes")
    .select("package_path")
    .eq("closeout_id", closeout.id)
    .eq("kind", "attach_package")
    .eq("status", "succeeded")
    .maybeSingle();

  let bytes: Uint8Array<ArrayBuffer>;
  let filename = `closeout-${closeout.id.slice(0, 8)}.pdf`;
  if (filed?.package_path) {
    const download = await service.storage.from(CLOSEOUT_BUCKET).download(filed.package_path);
    if (download.error || !download.data) return NextResponse.json({ error: "package unavailable" }, { status: 502 });
    bytes = new Uint8Array(await download.data.arrayBuffer());
  } else {
    const rendered = await renderCloseoutPackage(service, closeout.id);
    bytes = rendered.bytes;
    filename = rendered.filename;
  }

  return new NextResponse(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "cache-control": "no-store",
    },
  });
}
