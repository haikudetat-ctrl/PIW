import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import type { SpendRow } from "./spend-import";

/**
 * Untyped access to the Google Ads tables (added after database.types.ts was
 * last generated). Regenerate types with `npm run db:types` once the
 * migration is applied locally, then this cast can go.
 */
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  insert(rows: unknown, options?: Record<string, unknown>): Query;
  upsert(rows: unknown, options?: Record<string, unknown>): Query;
  update(values: unknown): Query;
  single(): PromiseLike<{data: unknown; error: unknown}>;
  then: PromiseLike<{data: unknown; error: unknown}>["then"];
};
type StoreClient = {from(table: string): Query};

const settingsRowSchema = z.object({
  company_id: z.uuid(),
  customer_id: z.string().regex(/^\d{10}$/),
  login_customer_id: z.string().regex(/^\d{10}$/).nullable(),
  uploads_enabled: z.boolean(),
  spend_import_enabled: z.boolean(),
  currency_code: z.string(),
});

export type GoogleAdsCompanySettings = z.infer<typeof settingsRowSchema> & {companyName: string};

export class SupabaseGoogleAdsStore {
  constructor(private readonly client: StoreClient = createServiceClient() as unknown as StoreClient) {}

  async listCompanies(): Promise<GoogleAdsCompanySettings[]> {
    const {data, error} = await this.client
      .from("company_google_ads_settings")
      .select("company_id, customer_id, login_customer_id, uploads_enabled, spend_import_enabled, currency_code");
    if (error) throw new Error("Failed to load Google Ads settings");
    const rows = z.array(settingsRowSchema).parse(data ?? []);
    if (rows.length === 0) return [];
    const names = await this.client.from("companies").select("id, name").in("id", rows.map((row) => row.company_id));
    const byId = new Map(
      (z.array(z.object({id: z.string(), name: z.string()})).safeParse(names.data).data ?? []).map((row) => [row.id, row.name]),
    );
    return rows.map((row) => ({...row, companyName: byId.get(row.company_id) ?? "Company"}));
  }

  async startRun(input: {companyId: string; from: string; to: string}): Promise<string> {
    const {data, error} = await this.client
      .from("ad_spend_import_runs")
      .insert({company_id: input.companyId, date_from: input.from, date_to: input.to})
      .select("id")
      .single();
    if (error) throw new Error("Failed to start spend import run");
    return z.object({id: z.uuid()}).parse(data).id;
  }

  async finishRun(runId: string, input: {status: "succeeded" | "failed"; rowsUpserted: number | null; errorCategory: string | null}) {
    const {error} = await this.client
      .from("ad_spend_import_runs")
      .update({
        status: input.status,
        rows_upserted: input.rowsUpserted,
        error_category: input.errorCategory,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (error) throw new Error("Failed to finish spend import run");
  }

  async upsertSpend(rows: SpendRow[]) {
    for (let index = 0; index < rows.length; index += 500) {
      const {error} = await this.client.from("ad_spend_daily").upsert(rows.slice(index, index + 500), {
        onConflict: "company_id,platform,spend_date,grain,campaign_id,ad_group_id,criterion_id",
      });
      if (error) throw new Error("Failed to upsert spend");
    }
  }

  /** True when this alert is new for today, so it should be delivered. */
  async recordAlert(input: {companyId: string; key: string; date: string; severity: string; message: string}): Promise<boolean> {
    const {data, error} = await this.client
      .from("paid_media_alerts")
      .upsert(
        {company_id: input.companyId, alert_key: input.key, alert_date: input.date, severity: input.severity, message: input.message},
        {onConflict: "company_id,alert_key,alert_date", ignoreDuplicates: true},
      )
      .select("alert_key");
    if (error) throw new Error("Failed to record paid media alert");
    return Array.isArray(data) && data.length > 0;
  }

  async markAlertDelivered(input: {companyId: string; key: string; date: string}) {
    await this.client
      .from("paid_media_alerts")
      .update({delivered: true})
      .eq("company_id", input.companyId)
      .eq("alert_key", input.key)
      .eq("alert_date", input.date);
  }
}
