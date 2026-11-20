import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { SIGNATURE_BOX } from "@/domain/closeouts";

// The closeout package filed on the JobNimbus job: what was installed and
// when, the checklist, open items, the homeowner's sign-off and the photos.
// No prices, so the office can forward it to a lender or the homeowner.

export type CloseoutPackageProps = {
  companyName: string;
  closeoutRef: string;
  jobNumber: string | null;
  customerName: string | null;
  address: string;
  jobType: string | null;
  shingleLine: string | null;
  salesRep: string | null;
  deliveredOn: string | null;
  deliveryDocuments: string[];
  installStartedOn: string;
  installCompletedOn: string;
  crew: string | null;
  squaresInstalled: number | null;
  layersRemoved: number | null;
  deckingSheetsReplaced: number | null;
  checklist: { label: string; answer: "done" | "na" | null }[];
  punchItems: string | null;
  productionNotes: string | null;
  homeowner:
    | {
        name: string;
        signedAt: string;
        statement: string;
        photoRelease: "granted" | "declined";
        photoReleaseText: string;
        reviewRequestOk: boolean;
        reviewRequestText: string;
        signaturePath: string;
        termsVersion: string;
      }
    | null;
  homeownerUnavailableReason: string | null;
  submittedBy: string | null;
  submittedAt: string;
  photos: { data: Buffer; takenAt: string | null }[];
};

const COLORS = {
  ink: "#182019",
  muted: "#667068",
  line: "#D9DED9",
  panel: "#F3F5F2",
  tint: "#1D5FA8",
  done: "#2F7D4A",
  white: "#FFFFFF",
};

// Line heights are in points: this renderer version doubles unitless ones.
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
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  company: { fontFamily: "Helvetica-Bold", fontSize: 16 },
  meta: { textAlign: "right", color: COLORS.muted, fontSize: 8, lineHeight: "11pt" },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 1.3, color: COLORS.tint, marginBottom: 6 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, marginBottom: 3 },
  subtitle: { color: COLORS.muted, fontSize: 10, lineHeight: "13pt" },
  facts: { flexDirection: "row", marginTop: 14, marginBottom: 16, padding: 12, backgroundColor: COLORS.panel, borderRadius: 6 },
  fact: { flex: 1, paddingRight: 8 },
  factLabel: { color: COLORS.muted, fontSize: 7, marginBottom: 3 },
  factValue: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  columns: { flexDirection: "row", gap: 18 },
  column: { flex: 1 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 11.5, marginBottom: 6, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderColor: COLORS.line },
  rowLabel: { color: COLORS.muted, paddingRight: 8 },
  rowValue: { fontFamily: "Helvetica-Bold", textAlign: "right", maxWidth: "62%" },
  check: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderColor: COLORS.line },
  checkMark: { width: 34, fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  checkLabel: { flex: 1, lineHeight: "11.5pt" },
  paragraph: { lineHeight: "12pt", marginBottom: 4 },
  muted: { color: COLORS.muted },
  signoff: { marginTop: 14, padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 6 },
  statement: { lineHeight: "12.5pt", marginBottom: 8 },
  consent: { flexDirection: "row", marginBottom: 4 },
  consentAnswer: { width: 34, fontFamily: "Helvetica-Bold", fontSize: 8 },
  consentText: { flex: 1, color: COLORS.muted, lineHeight: "11.5pt" },
  signatureRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 8, gap: 16 },
  signatureBox: { borderBottomWidth: 1, borderColor: COLORS.ink, width: 240, height: 80 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoCell: { width: "48.5%", marginBottom: 4 },
  photo: { width: "100%", height: 190, objectFit: "cover", borderRadius: 4 },
  caption: { color: COLORS.muted, fontSize: 7, marginTop: 3 },
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

function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

// "Nov 18, 2026", "Nov 18 to 19, 2026" or "Nov 30 to Dec 2, 2026".
export function installRange(startIso: string, endIso: string): string {
  const parts = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return { year, month: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), day };
  };
  const start = parts(startIso);
  const end = parts(endIso);
  if (startIso === endIso) return `${end.month} ${end.day}, ${end.year}`;
  if (start.year !== end.year) return `${start.month} ${start.day}, ${start.year} to ${end.month} ${end.day}, ${end.year}`;
  if (start.month === end.month) return `${start.month} ${start.day} to ${end.day}, ${end.year}`;
  return `${start.month} ${start.day} to ${end.month} ${end.day}, ${end.year}`;
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value === null || value === "" ? "Not recorded" : String(value)}</Text>
    </View>
  );
}

function Footer({ companyName, closeoutRef }: { companyName: string; closeoutRef: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {companyName} · Closeout {closeoutRef}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      <Text style={styles.poweredBy}>PREPARED WITH RAKE</Text>
    </View>
  );
}

export function CloseoutPackageDocument(props: CloseoutPackageProps) {
  const installDays = installRange(props.installStartedOn, props.installCompletedOn);

  return (
    <Document title={`Closeout package ${props.jobNumber ? `job ${props.jobNumber}` : props.closeoutRef}`} author={props.companyName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRule} fixed />
        <View style={styles.header}>
          <Text style={styles.company}>{props.companyName}</Text>
          <Text style={styles.meta}>
            {props.jobNumber ? `Job #${props.jobNumber}\n` : ""}
            Closed out {shortDate(props.submittedAt)}
            {props.submittedBy ? `\nby ${props.submittedBy}` : ""}
          </Text>
        </View>

        <Text style={styles.eyebrow}>JOB CLOSEOUT</Text>
        <Text style={styles.title}>{props.customerName ?? "Homeowner"}</Text>
        <Text style={styles.subtitle}>{props.address}</Text>

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Work</Text>
            <Text style={styles.factValue}>{props.jobType ?? "Roof replacement"}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Installed</Text>
            <Text style={styles.factValue}>{installDays}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Shingle line</Text>
            <Text style={styles.factValue}>{props.shingleLine ?? "Not recorded"}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Sales rep</Text>
            <Text style={styles.factValue}>{props.salesRep ?? "Not recorded"}</Text>
          </View>
        </View>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Installation</Text>
            <Row label="Crew" value={props.crew} />
            <Row label="Squares installed" value={props.squaresInstalled === null ? null : props.squaresInstalled.toFixed(1)} />
            <Row label="Layers removed" value={props.layersRemoved} />
            <Row label="Decking sheets replaced" value={props.deckingSheetsReplaced} />
            <Row label="Materials delivered" value={props.deliveredOn ? shortDate(props.deliveredOn) : null} />

            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Supplier paperwork in JobNimbus</Text>
            {props.deliveryDocuments.length > 0 ? (
              props.deliveryDocuments.map((name) => (
                <Text key={name} style={styles.paragraph}>
                  {name}
                </Text>
              ))
            ) : (
              <Text style={[styles.paragraph, styles.muted]}>None found on the job.</Text>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Open items</Text>
            <Text style={[styles.paragraph, props.punchItems ? {} : styles.muted]}>{props.punchItems ?? "None."}</Text>

            {props.productionNotes ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Production notes</Text>
                <Text style={styles.paragraph}>{props.productionNotes}</Text>
              </>
            ) : null}
          </View>

          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Quality checklist</Text>
            {props.checklist.map((item) => (
              <View key={item.label} style={styles.check} wrap={false}>
                <Text style={[styles.checkMark, { color: item.answer === "done" ? COLORS.done : COLORS.muted }]}>
                  {item.answer === "done" ? "DONE" : item.answer === "na" ? "N/A" : "OPEN"}
                </Text>
                <Text style={styles.checkLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.signoff} wrap={false}>
          <Text style={styles.sectionTitle}>Homeowner sign-off</Text>
          {props.homeowner ? (
            <>
              <Text style={styles.statement}>{props.homeowner.statement}</Text>
              <View style={styles.consent}>
                <Text style={styles.consentAnswer}>{props.homeowner.photoRelease === "granted" ? "YES" : "NO"}</Text>
                <Text style={styles.consentText}>{props.homeowner.photoReleaseText}</Text>
              </View>
              <View style={styles.consent}>
                <Text style={styles.consentAnswer}>{props.homeowner.reviewRequestOk ? "YES" : "NO"}</Text>
                <Text style={styles.consentText}>{props.homeowner.reviewRequestText}</Text>
              </View>
              <View style={styles.signatureRow}>
                <View style={styles.signatureBox}>
                  <Svg viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`} style={{ width: 240, height: 80 }}>
                    <Path
                      d={props.homeowner.signaturePath}
                      stroke={COLORS.ink}
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </Svg>
                </View>
                <View>
                  <Text style={styles.factValue}>{props.homeowner.name}</Text>
                  <Text style={styles.caption}>Signed {dateTime(props.homeowner.signedAt)}</Text>
                  <Text style={styles.caption}>Wording version {props.homeowner.termsVersion}</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={[styles.paragraph, styles.muted]}>
              The homeowner did not sign at closeout. Reason given: {props.homeownerUnavailableReason ?? "none"}
            </Text>
          )}
        </View>

        <Footer companyName={props.companyName} closeoutRef={props.closeoutRef} />
      </Page>

      {props.photos.length > 0 ? (
        <Page size="LETTER" style={styles.page}>
          <View style={styles.brandRule} fixed />
          <Text style={styles.sectionTitle}>Job photos</Text>
          <View style={styles.photoGrid}>
            {props.photos.map((photo, index) => (
              <View key={index} style={styles.photoCell} wrap={false}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                <Image src={photo.data} style={styles.photo} />
                <Text style={styles.caption}>{photo.takenAt ? `Taken ${dateTime(photo.takenAt)}` : "Date not recorded"}</Text>
              </View>
            ))}
          </View>
          <Footer companyName={props.companyName} closeoutRef={props.closeoutRef} />
        </Page>
      ) : null}
    </Document>
  );
}
