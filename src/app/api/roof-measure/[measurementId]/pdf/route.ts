import {NextResponse} from "next/server";
import {renderToBuffer} from "@react-pdf/renderer";
import {createElement} from "react";
import {z} from "zod";
import {roofEdgeKinds, type RoofEdgeKind} from "@/domain/roof-drawing";
import {canUseCrm, parseMyAccess} from "@/lib/auth/access";
import {createServerClient} from "@/lib/supabase/server";
import {MeasurementReportDocument, type MeasurementReportDocumentProps} from "@/modules/roof-measure/measurement-report-document";
import {buildMeasurementReportModel} from "@/modules/roof-measure/measurement-report";
import {jobLabel, measuredInputSchema, savedDrawingSchema} from "@/modules/roof-measure/saved-drawing";

export const runtime = "nodejs";
export const maxDuration = 60;

// Printable report for a saved roof drawing. Middleware lets /api through, so
// this checks the session itself; the row is read as the signed-in user, so
// roof_measurements RLS decides who can see it. There is no public link.

const STORIES: Record<string, string> = {one: "One", two: "Two", three_plus: "Three+"};

export async function GET(_request: Request, ctx: {params: Promise<{measurementId: string}>}) {
  const {measurementId} = await ctx.params;
  if (!z.uuid().safeParse(measurementId).success) return NextResponse.json({error: "not found"}, {status: 404});
  const supabase = await createServerClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const {data: accessRows} = await supabase.rpc("get_my_access");
  const access = parseMyAccess(accessRows);
  if (!access || !canUseCrm(access)) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data: row} = await supabase
    .from("roof_measurements")
    .select("id, company_id, address, latitude, longitude, job_jnid, solar_imagery_date, drawing, measured, stories, waste_percent, squares, lengths_ft, updated_at")
    .eq("id", measurementId)
    .maybeSingle();
  if (!row) return NextResponse.json({error: "not found"}, {status: 404});
  const drawing = savedDrawingSchema.safeParse(row.drawing);
  if (!drawing.success) return NextResponse.json({error: "drawing unreadable"}, {status: 422});
  const measured = row.measured ? measuredInputSchema.safeParse(row.measured) : null;

  const [{data: company}, {data: job}] = await Promise.all([
    supabase.from("companies").select("name").eq("id", row.company_id).maybeSingle(),
    row.job_jnid
      ? supabase.from("jn_jobs").select("number, address_line1, city").eq("company_id", row.company_id).eq("jnid", row.job_jnid).maybeSingle()
      : Promise.resolve({data: null}),
  ]);

  const origin = {lat: row.latitude, lng: row.longitude};
  const props: MeasurementReportDocumentProps = {
    companyName: company?.name ?? "Roof measurement",
    address: row.address,
    jobLabel: job ? jobLabel(job) : null,
    preparedOn: new Date(row.updated_at),
    imageryDate: row.solar_imagery_date,
    storiesLabel: row.stories ? STORIES[row.stories] ?? null : null,
    wastePercent: row.waste_percent === null ? null : Number(row.waste_percent),
    savedSquares: Number(row.squares),
    savedLengthsFt: savedLengths(row.lengths_ft),
    sourceLabel: measured?.success && measured.data.totalSqft !== null ? `Squares from ${measured.data.source || "a measured report"}` : "Measured in Rake",
    model: buildMeasurementReportModel(origin, drawing.data),
  };
  const pdf = await renderToBuffer(createElement(MeasurementReportDocument, props) as Parameters<typeof renderToBuffer>[0]);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="roof-measurement-${row.id.slice(0, 8)}.pdf"`,
      "cache-control": "no-store",
    },
  });
}

function savedLengths(value: unknown): Partial<Record<RoofEdgeKind, number>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Partial<Record<RoofEdgeKind, number>> = {};
  for (const kind of roofEdgeKinds) {
    const feet = (value as Record<string, unknown>)[kind];
    if (typeof feet === "number" && Number.isFinite(feet)) out[kind] = feet;
  }
  return out;
}
