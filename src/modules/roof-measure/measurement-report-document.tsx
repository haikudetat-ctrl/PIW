import {Document, G, Line, Page, Polygon, StyleSheet, Svg, Text, View} from "@react-pdf/renderer";
import {roofEdgeKindLabels, type RoofEdgeKind} from "@/domain/roof-drawing";
import {edgeKindColors} from "./edge-colors";
import {reportLengths, type MeasurementReportModel} from "./measurement-report";

// Printable roof measurement report, laid out like the Roofr reports the
// team reads today: summary, a top-down diagram with edge colours and
// lengths, then lengths, pitch, waste and plane tables.

export type MeasurementReportDocumentProps = {
  companyName: string;
  address: string;
  jobLabel: string | null;
  preparedOn: Date;
  imageryDate: string | null;
  storiesLabel: string | null;
  wastePercent: number | null;
  /** Squares the drawing was saved with (the tier staff priced on). */
  savedSquares: number;
  savedLengthsFt: Partial<Record<RoofEdgeKind, number>> | null;
  sourceLabel: string;
  model: MeasurementReportModel;
};

const COLORS = {ink: "#182019", muted: "#667068", line: "#D9DED9", panel: "#F3F5F2", tint: "#1D5FA8"};

const styles = StyleSheet.create({
  page: {paddingTop: 32, paddingBottom: 44, paddingHorizontal: 36, fontSize: 9, color: COLORS.ink, fontFamily: "Helvetica"},
  header: {flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingBottom: 8},
  company: {fontSize: 9, color: COLORS.muted},
  title: {fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 2},
  address: {fontSize: 10, marginTop: 3},
  meta: {fontSize: 8, color: COLORS.muted, textAlign: "right"},
  stats: {flexDirection: "row", marginTop: 10},
  stat: {flexGrow: 1, flexBasis: 0, backgroundColor: COLORS.panel, padding: 7, marginRight: 6},
  statLast: {flexGrow: 1, flexBasis: 0, backgroundColor: COLORS.panel, padding: 7},
  statLabel: {fontSize: 7, color: COLORS.muted},
  statValue: {fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2},
  section: {marginTop: 12},
  sectionTitle: {fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 5},
  diagram: {borderWidth: 1, borderColor: COLORS.line},
  legend: {flexDirection: "row", flexWrap: "wrap", marginTop: 5},
  legendItem: {flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 3},
  swatch: {width: 12, height: 3, marginRight: 3},
  legendText: {fontSize: 7, color: COLORS.muted},
  table: {borderTopWidth: 1, borderTopColor: COLORS.line},
  row: {flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingVertical: 3},
  headRow: {flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.ink, paddingVertical: 3},
  head: {fontFamily: "Helvetica-Bold", fontSize: 8},
  cell: {flexGrow: 1, flexBasis: 0},
  num: {flexGrow: 1, flexBasis: 0, textAlign: "right"},
  columns: {flexDirection: "row"},
  column: {flexGrow: 1, flexBasis: 0, marginRight: 14},
  columnLast: {flexGrow: 1, flexBasis: 0},
  note: {fontSize: 7.5, color: COLORS.muted, marginTop: 3, lineHeight: 1.4},
  footer: {position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: COLORS.muted, flexDirection: "row", justifyContent: "space-between"},
});

const fmt = (value: number, digits = 1) => value.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
const ft = (feet: number) => `${fmt(feet, 0)} ft`;

export function MeasurementReportDocument(props: MeasurementReportDocumentProps) {
  const {model} = props;
  const {report, diagram} = model;
  const lengths = reportLengths(report, props.savedLengthsFt);
  const usedKinds = new Set(diagram.edges.map((edge) => edge.kind));
  const preparedOn = props.preparedOn.toLocaleDateString("en-US", {year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York"});
  const scaleFeet = niceScale(diagram.feetPerPoint * 80);
  const scaleWidth = scaleFeet / diagram.feetPerPoint;

  return (
    <Document title={`Roof measurement · ${props.address}`} author={props.companyName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{props.companyName}</Text>
            <Text style={styles.title}>Roof measurement report</Text>
            <Text style={styles.address}>{props.address}</Text>
          </View>
          <View>
            <Text style={styles.meta}>Prepared {preparedOn}</Text>
            {props.jobLabel ? <Text style={styles.meta}>Job {props.jobLabel}</Text> : null}
            <Text style={styles.meta}>{props.sourceLabel}</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="Total roof area" value={`${fmt(report.totalSlopedSqft, 0)} sq ft`} />
          <Stat label="Squares priced" value={fmt(props.savedSquares)} />
          <Stat label="Predominant pitch" value={report.predominantPitchRise === null ? "—" : `${report.predominantPitchRise}/12`} />
          <Stat label="Roof facets" value={String(report.planeCount)} />
          <Stat label="Stories" value={props.storiesLabel ?? "—"} last />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Diagram</Text>
          <View style={styles.diagram}>
            <Svg width={diagram.width} height={diagram.height} viewBox={`0 0 ${diagram.width} ${diagram.height}`}>
              {diagram.planes.map((plane) => (
                <Polygon key={`p${plane.label}`} points={plane.points} fill={plane.wall ? "#E5E7EB" : "#F8FAF7"} stroke="#94A3B8" strokeWidth={0.5} />
              ))}
              {diagram.edges.map((edge, index) => (
                <Line key={`e${index}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={edgeKindColors[edge.kind]} strokeWidth={1.6} />
              ))}
              {diagram.edges.filter((edge) => edge.lengthFt >= 4).map((edge, index) => (
                <Text key={`l${index}`} x={edge.labelAt.x} y={edge.labelAt.y - 2} fill={COLORS.ink} style={{fontSize: 6}} textAnchor="middle">
                  {fmt(edge.lengthFt, 0)}
                </Text>
              ))}
              {diagram.planes.map((plane) => (
                <G key={`t${plane.label}`}>
                  <Text x={plane.labelAt.x} y={plane.labelAt.y} fill={COLORS.tint} style={{fontSize: 8, fontFamily: "Helvetica-Bold"}} textAnchor="middle">
                    {plane.label}
                  </Text>
                  <Text x={plane.labelAt.x} y={plane.labelAt.y + 8} fill={COLORS.muted} style={{fontSize: 6}} textAnchor="middle">
                    {plane.wall ? "wall" : `${plane.pitchRise}/12`}
                  </Text>
                </G>
              ))}
              <Line x1={8} y1={10} x2={8 + scaleWidth} y2={10} stroke={COLORS.ink} strokeWidth={1} />
              <Text x={8 + scaleWidth + 3} y={12} fill={COLORS.muted} style={{fontSize: 6}}>{`${scaleFeet} ft`}</Text>
              <Text x={diagram.width - 14} y={16} fill={COLORS.muted} style={{fontSize: 8, fontFamily: "Helvetica-Bold"}} textAnchor="middle">N</Text>
              <Line x1={diagram.width - 14} y1={20} x2={diagram.width - 14} y2={32} stroke={COLORS.muted} strokeWidth={1} />
            </Svg>
          </View>
          <View style={styles.legend}>
            {lengths.filter((row) => usedKinds.has(row.kind)).map((row) => (
              <View key={row.kind} style={styles.legendItem}>
                <View style={[styles.swatch, {backgroundColor: edgeKindColors[row.kind]}]} />
                <Text style={styles.legendText}>{roofEdgeKindLabels[row.kind]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>Lengths on the diagram are true lengths along the roof, in feet. Facet numbers match the facet table.</Text>
        </View>

        <View style={[styles.section, styles.columns]}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Lengths</Text>
            <View style={styles.table}>
              {lengths.map((row) => (
                <View key={row.kind} style={styles.row}>
                  <Text style={styles.cell}>{roofEdgeKindLabels[row.kind]}</Text>
                  <Text style={styles.num}>{ft(row.feet)}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.columnLast}>
            <Text style={styles.sectionTitle}>Pitch</Text>
            <View style={styles.table}>
              <View style={styles.headRow}>
                <Text style={[styles.cell, styles.head]}>Pitch</Text>
                <Text style={[styles.num, styles.head]}>Area</Text>
                <Text style={[styles.num, styles.head]}>Share</Text>
              </View>
              {report.pitchBreakdown.map((row) => (
                <View key={row.pitchRise} style={styles.row}>
                  <Text style={styles.cell}>{`${row.pitchRise}/12`}</Text>
                  <Text style={styles.num}>{`${fmt(row.sqft, 0)} sq ft`}</Text>
                  <Text style={styles.num}>{`${fmt(row.share * 100, 0)}%`}</Text>
                </View>
              ))}
            </View>
            {report.steepSqft > 0 ? <Text style={styles.note}>{`${fmt(report.steepSqft, 0)} sq ft is steeper than 10/12.`}</Text> : null}
          </View>
        </View>
        <Footer {...props} />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{props.companyName}</Text>
            <Text style={styles.title}>Waste and facets</Text>
            <Text style={styles.address}>{props.address}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Waste</Text>
          <View style={styles.table}>
            <View style={styles.headRow}>
              <Text style={[styles.cell, styles.head]}>Waste</Text>
              <Text style={[styles.num, styles.head]}>Squares</Text>
              <Text style={[styles.num, styles.head]}>Bundles</Text>
            </View>
            {report.wasteTable.map((row) => (
              <View key={row.percent} style={styles.row}>
                <Text style={[styles.cell, row.percent === (props.wastePercent ?? report.suggestedWastePercent) ? styles.head : {}]}>
                  {`${row.percent}%${row.percent === (props.wastePercent ?? report.suggestedWastePercent) ? " (chosen)" : ""}`}
                </Text>
                <Text style={styles.num}>{fmt(row.squares)}</Text>
                <Text style={styles.num}>{String(row.bundles)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>Squares here come from the drawing. Bundles assume three per square.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Facets</Text>
          <View style={styles.table}>
            <View style={styles.headRow}>
              <Text style={[styles.cell, styles.head]}>Facet</Text>
              <Text style={[styles.num, styles.head]}>Pitch</Text>
              <Text style={[styles.num, styles.head]}>Faces</Text>
              <Text style={[styles.num, styles.head]}>Area</Text>
              <Text style={[styles.num, styles.head]}>Source</Text>
            </View>
            {report.planes.map((plane) => (
              <View key={plane.id} style={styles.row}>
                <Text style={styles.cell}>{`${model.planeLabels[plane.id] ?? "?"}${plane.surface === "wall" ? " (wall, not counted)" : ""}`}</Text>
                <Text style={styles.num}>{`${plane.pitchRise}/12`}</Text>
                <Text style={styles.num}>{compass(plane.azimuthDegrees)}</Text>
                <Text style={styles.num}>{`${fmt(plane.slopedSqft, 0)} sq ft`}</Text>
                <Text style={styles.num}>{sourceName(plane.source)}</Text>
              </View>
            ))}
          </View>
          {report.wallPlaneCount > 0 ? (
            <Text style={styles.note}>{`${report.wallPlaneCount} face${report.wallPlaneCount === 1 ? "" : "s"} (${fmt(report.wallSqft, 0)} sq ft) marked as wall and left out of every total.`}</Text>
          ) : null}
          <Text style={styles.note}>
            {`Facet outlines start from Google Solar roof segments${props.imageryDate ? ` (imagery dated ${props.imageryDate})` : ""} and were checked and adjusted by staff over the NJGIN 2020 aerial. Field-verify before ordering.`}
          </Text>
        </View>
        <Footer {...props} />
      </Page>
    </Document>
  );
}

function Stat({label, value, last = false}: {label: string; value: string; last?: boolean}) {
  return (
    <View style={last ? styles.statLast : styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Footer({companyName, address}: MeasurementReportDocumentProps) {
  return (
    <View style={styles.footer} fixed>
      <Text>{`${companyName} · ${address}`}</Text>
      <Text render={({pageNumber, totalPages}) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function compass(azimuth: number) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}

function sourceName(source: string) {
  return source === "solar" ? "Solar" : source === "adjusted" ? "Adjusted" : "Drawn";
}

function niceScale(feet: number) {
  const steps = [5, 10, 20, 25, 50, 100];
  return steps.find((step) => step >= feet * 0.6) ?? 100;
}
