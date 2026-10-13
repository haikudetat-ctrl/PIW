import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { addOnAmountCents, optionTotalCents, type AddOnKind, type MeasurementSource } from "@/domain/proposals";
import type { RoofPricingTierKey } from "@/domain/roof-pricing";

// The customer-facing proposal. Everything printed comes from the proposal
// snapshot, so a re-render after the rate card changes shows what was offered.
// Layout follows the 2stack-roof-quote document it replaces.

export type ProposalDocumentProps = {
  companyName: string;
  proposalNumber: string;
  issuedOn: Date;
  validUntil: string;
  status: string;
  customerName: string;
  propertyAddress: string;
  roofSquares: number;
  measurementSource: MeasurementSource;
  pitch12: number | null;
  recommendedTier: RoofPricingTierKey;
  options: {
    tierKey: RoofPricingTierKey;
    customerName: string;
    manufacturerName: string | null;
    productLineName: string | null;
    customerDescription: string;
    warrantySummary: string;
    differentiators: string[];
    pricePerSquareCents: number;
  }[];
  addOns: {
    label: string;
    explanation: string | null;
    calculationKind: AddOnKind;
    unitValue: number;
    quantity: number;
  }[];
};

const COLORS = {
  ink: "#182019",
  muted: "#667068",
  line: "#D9DED9",
  panel: "#F3F5F2",
  tint: "#1D5FA8",
  white: "#FFFFFF",
};

const TIER_LABEL: Record<RoofPricingTierKey, string> = { good: "GOOD", better: "BETTER", best: "BEST" };

const SOURCE_LABEL: Record<MeasurementSource, string> = {
  roofr: "Roofr measurement report",
  google_solar: "Satellite roof measurement",
  manual: "Measured by your estimator",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },
  brandRule: { height: 4, backgroundColor: COLORS.tint, marginBottom: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  company: { fontFamily: "Helvetica-Bold", fontSize: 16 },
  meta: { textAlign: "right", color: COLORS.muted, fontSize: 8, lineHeight: 1.5 },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 1.3, color: COLORS.tint, marginBottom: 6 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, marginBottom: 4 },
  subtitle: { color: COLORS.muted, fontSize: 10, lineHeight: 1.5 },
  facts: {
    flexDirection: "row",
    marginTop: 16,
    marginBottom: 18,
    padding: 12,
    backgroundColor: COLORS.panel,
    borderRadius: 6,
  },
  fact: { flex: 1 },
  factLabel: { color: COLORS.muted, fontSize: 7, marginBottom: 3 },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 13, marginBottom: 8 },
  options: { flexDirection: "row", gap: 10, marginBottom: 18 },
  option: { flex: 1, padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 6 },
  optionRecommended: { borderWidth: 2, borderColor: COLORS.tint },
  optionTier: { flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: COLORS.muted, marginBottom: 6 },
  recommended: { fontFamily: "Helvetica-Bold", color: COLORS.tint },
  optionName: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  optionLine: { color: COLORS.muted, fontSize: 8, marginTop: 2 },
  optionText: { color: COLORS.muted, fontSize: 8, lineHeight: 1.45, marginTop: 6 },
  bullet: { fontSize: 8, lineHeight: 1.45, marginTop: 2 },
  price: { fontFamily: "Helvetica-Bold", fontSize: 16, marginTop: 10 },
  priceNote: { color: COLORS.muted, fontSize: 7, marginTop: 2 },
  table: { borderTopWidth: 1, borderColor: COLORS.line, marginBottom: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderColor: COLORS.line },
  rowLabel: { flex: 1, paddingRight: 12 },
  rowNote: { color: COLORS.muted, fontSize: 7, marginTop: 2 },
  rowAmount: { fontFamily: "Helvetica-Bold", width: 80, textAlign: "right" },
  terms: { color: COLORS.muted, fontSize: 7.5, lineHeight: 1.5 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    color: COLORS.muted,
    fontSize: 7,
  },
  poweredBy: { fontFamily: "Helvetica-Bold", letterSpacing: 1.2 },
});

function dollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export function ProposalDocument(props: ProposalDocumentProps) {
  const totals = props.options.map((option) => {
    const base = optionTotalCents(props.roofSquares, option.pricePerSquareCents);
    const addOns = props.addOns.reduce(
      (sum, addOn) => sum + addOnAmountCents({ ...addOn, included: true }, props.roofSquares, base),
      0,
    );
    return { tierKey: option.tierKey, base, total: base + addOns };
  });
  const recommendedBase = totals.find((total) => total.tierKey === props.recommendedTier)?.base ?? 0;

  return (
    <Document title={`Roof proposal ${props.proposalNumber}`} author={props.companyName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRule} />
        <View style={styles.header}>
          <Text style={styles.company}>{props.companyName}</Text>
          <View>
            <Text style={styles.meta}>Proposal {props.proposalNumber}</Text>
            <Text style={styles.meta}>Issued {formatDate(props.issuedOn)}</Text>
            <Text style={styles.meta}>Valid until {formatDate(new Date(`${props.validUntil}T12:00:00Z`))}</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>ROOF REPLACEMENT PROPOSAL</Text>
        <Text style={styles.title}>Prepared for {props.customerName}</Text>
        <Text style={styles.subtitle}>{props.propertyAddress}</Text>

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Roof area</Text>
            <Text style={styles.factValue}>{props.roofSquares.toFixed(1)} squares</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Pitch</Text>
            <Text style={styles.factValue}>{props.pitch12 === null ? "—" : `${props.pitch12}/12`}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Measured by</Text>
            <Text style={styles.factValue}>{SOURCE_LABEL[props.measurementSource]}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Choose your roof</Text>
        <View style={styles.options}>
          {props.options.map((option) => {
            const isRecommended = option.tierKey === props.recommendedTier;
            const total = totals.find((item) => item.tierKey === option.tierKey);
            return (
              <View key={option.tierKey} style={isRecommended ? [styles.option, styles.optionRecommended] : styles.option}>
                <View style={styles.optionTier}>
                  <Text>{TIER_LABEL[option.tierKey]}</Text>
                  {isRecommended ? <Text style={styles.recommended}>RECOMMENDED</Text> : null}
                </View>
                <Text style={styles.optionName}>{option.customerName}</Text>
                {option.manufacturerName && option.productLineName &&
                `${option.manufacturerName} ${option.productLineName}` !== option.customerName ? (
                  <Text style={styles.optionLine}>
                    {option.manufacturerName} {option.productLineName}
                  </Text>
                ) : null}
                <Text style={styles.optionText}>{option.customerDescription}</Text>
                <Text style={styles.optionText}>{option.warrantySummary}</Text>
                {option.differentiators.map((item) => (
                  <Text key={item} style={styles.bullet}>
                    • {item}
                  </Text>
                ))}
                <Text style={styles.price}>{dollars(total?.total ?? 0)}</Text>
                <Text style={styles.priceNote}>
                  {props.addOns.length > 0 ? "Includes the items below" : "Complete roof replacement"}
                </Text>
              </View>
            );
          })}
        </View>

        {props.addOns.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Included for your home</Text>
            <View style={styles.table}>
              {props.addOns.map((addOn) => (
                <View key={addOn.label} style={styles.row} wrap={false}>
                  <View style={styles.rowLabel}>
                    <Text>
                      {addOn.label}
                      {addOn.calculationKind === "per_unit" && addOn.quantity !== 1 ? ` × ${addOn.quantity}` : ""}
                    </Text>
                    {addOn.explanation ? <Text style={styles.rowNote}>{addOn.explanation}</Text> : null}
                  </View>
                  <Text style={styles.rowAmount}>
                    {addOn.calculationKind === "percentage"
                      ? `${addOn.unitValue}%`
                      : dollars(addOnAmountCents({ ...addOn, included: true }, props.roofSquares, recommendedBase))}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.terms}>
          Prices are valid until {formatDate(new Date(`${props.validUntil}T12:00:00Z`))}. Final scope and price are confirmed
          at signing after an on-site inspection.
        </Text>

        <View style={styles.footer} fixed>
          <Text>
            {props.companyName} · Proposal {props.proposalNumber}
          </Text>
          <Text style={styles.poweredBy}>POWERED BY RAKE</Text>
        </View>
      </Page>
    </Document>
  );
}
