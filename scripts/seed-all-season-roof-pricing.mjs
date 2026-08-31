import {createClient} from "@supabase/supabase-js";

const companyId = process.env.ALL_SEASON_INTAKE_COMPANY_ID;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!companyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
  throw new Error("ALL_SEASON_INTAKE_COMPANY_ID must be the exact configured company UUID");
}
if (!supabaseUrl || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: {persistSession: false, autoRefreshToken: false},
});

const {data: company, error: companyError} = await client
  .from("companies")
  .select("id")
  .eq("id", companyId)
  .maybeSingle();
if (companyError || !company) throw new Error("Configured All Season company does not exist");

const version = "all-season-nj-2026-v1";
const {data: rateCard, error: cardError} = await client
  .from("roof_pricing_rate_cards")
  .upsert({
    company_id: companyId,
    version,
    name: "All Season New Jersey 2026",
    market: "New Jersey",
    currency_code: "USD",
    effective_from: "2026-08-31T00:00:00.000Z",
    status: "draft",
    updated_at: new Date().toISOString(),
  }, {onConflict: "company_id,version"})
  .select("id")
  .single();
if (cardError || !rateCard) throw new Error(`Failed to upsert All Season rate card: ${cardError?.message ?? "missing row"}`);

const tiers = [
  {tier_key:"good",display_order:1,internal_scope_code:"complete_system_v1",customer_name:"Complete System",customer_description:"A dependable complete roofing system.",warranty_summary:"Enhanced manufacturer protection.",differentiators:["Architectural finish","Complete-system installation","Enhanced protection"],low_cents_per_square:80_000,high_cents_per_square:97_500},
  {tier_key:"better",display_order:2,internal_scope_code:"recommended_system_v1",customer_name:"Recommended",customer_description:"Upgraded protection, appearance, and workmanship coverage.",warranty_summary:"Extended non-prorated material and workmanship coverage.",differentiators:["Upgraded material weight","Enhanced dimensional appearance","Extended workmanship coverage"],low_cents_per_square:95_000,high_cents_per_square:120_000},
  {tier_key:"best",display_order:3,internal_scope_code:"signature_system_v1",customer_name:"Signature System",customer_description:"Premium dimensional finish and maximum protection.",warranty_summary:"Extended workmanship coverage with premium detailing.",differentiators:["Highest material weight","Impact protection","Premium metal detailing"],low_cents_per_square:125_000,high_cents_per_square:165_000},
].map((tier) => ({...tier, company_id: companyId, rate_card_id: rateCard.id}));

const {error: tierError} = await client
  .from("roof_pricing_tiers")
  .upsert(tiers, {onConflict: "company_id,rate_card_id,tier_key"});
if (tierError) throw new Error(`Failed to seed pricing tiers: ${tierError.message}`);

const adjustments = [
  {adjustment_code:"decking_sheet",display_order:1,customer_label:"Decking replacement",customer_explanation:"Damaged roof decking is replaced only where field inspection confirms it is needed.",calculation_kind:"per_unit",low_value:95,high_value:150},
  {adjustment_code:"second_layer_tearoff",display_order:2,customer_label:"Second-layer tear-off",customer_explanation:"Additional removal applies when inspection confirms a second roofing layer.",calculation_kind:"per_square",low_value:75,high_value:125},
  {adjustment_code:"pitch_8_10",display_order:3,customer_label:"8/12–10/12 roof pitch",customer_explanation:"Steeper roof access may add labor and safety requirements.",calculation_kind:"percentage",low_value:15,high_value:15},
  {adjustment_code:"steep_or_third_story",display_order:4,customer_label:"Above 10/12 pitch or third-story access",customer_explanation:"Very steep or elevated work may add labor, access, and safety requirements.",calculation_kind:"percentage",low_value:25,high_value:35},
  {adjustment_code:"chimney_flashing",display_order:5,customer_label:"Chimney flashing rebuild",customer_explanation:"Chimney flashing scope is confirmed during inspection.",calculation_kind:"flat",low_value:600,high_value:1500},
  {adjustment_code:"premium_metal_chimney",display_order:6,customer_label:"Premium metal chimney detailing",customer_explanation:"Premium chimney metalwork is priced after field verification.",calculation_kind:"flat",low_value:1500,high_value:3500},
  {adjustment_code:"skylight",display_order:7,customer_label:"Skylight replacement",customer_explanation:"Skylight condition and replacement scope are confirmed during inspection.",calculation_kind:"per_unit",low_value:1200,high_value:2500},
].map((adjustment) => ({
  ...adjustment,
  company_id: companyId,
  rate_card_id: rateCard.id,
  active: true,
}));

const {error: adjustmentError} = await client
  .from("roof_pricing_adjustments")
  .upsert(adjustments, {onConflict: "company_id,rate_card_id,adjustment_code"});
if (adjustmentError) throw new Error(`Failed to seed pricing adjustments: ${adjustmentError.message}`);

const {error: activationError} = await client.rpc("activate_roof_pricing_rate_card", {
  p_company_id: companyId,
  p_rate_card_id: rateCard.id,
});
if (activationError) throw new Error(`Failed to activate All Season rate card: ${activationError.message}`);

console.log(JSON.stringify({companyId, rateCardId: rateCard.id, version, tiers: 3, adjustments: 7}));
