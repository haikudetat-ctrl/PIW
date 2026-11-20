// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { checklistFor, homeownerStatement, photoReleaseText, reviewRequestText, signaturePath } from "@/domain/closeouts";
import { CloseoutPackageDocument, installRange, type CloseoutPackageProps } from "./package-document";

async function photo(color: string) {
  return sharp({ create: { width: 1400, height: 1050, channels: 3, background: color } }).jpeg().toBuffer();
}

const signature = signaturePath([
  Array.from({ length: 30 }, (_, index) => ({ x: 40 + index * 16, y: 110 + Math.sin(index / 2) * 40 })),
  Array.from({ length: 10 }, (_, index) => ({ x: 300 + index * 8, y: 60 + index * 9 })),
]);

async function props(overrides: Partial<CloseoutPackageProps> = {}): Promise<CloseoutPackageProps> {
  return {
    companyName: "AllSeason Solar",
    closeoutRef: "7648B78D",
    jobNumber: "4512",
    customerName: "Dana Whitfield",
    address: "14 Linden Ave, Linwood, NJ 08221",
    jobType: "Roof & RR",
    shingleLine: "Landmark",
    salesRep: "Pete Thomas",
    deliveredOn: "2026-11-17T17:21:47Z",
    deliveryDocuments: ["SRS Distribution Proof of Delivery.pdf", "SRS Distribution Invoice.pdf"],
    installStartedOn: "2026-11-18",
    installCompletedOn: "2026-11-19",
    crew: "American Prime crew 2",
    squaresInstalled: 27.5,
    layersRemoved: 2,
    deckingSheetsReplaced: 4,
    checklist: checklistFor("Roof & RR").map((item, index) => ({ label: item.label, answer: index === 3 ? "na" : "done" })),
    punchItems: "Touch up paint on the front drip edge.",
    productionNotes: "Two layers off the rear slope.",
    homeowner: {
      name: "Dana Whitfield",
      signedAt: "2026-11-19T20:14:00Z",
      statement: homeownerStatement({
        companyName: "AllSeason Solar",
        workDescription: "roof replacement",
        address: "14 Linden Ave, Linwood, NJ 08221",
        completedOn: "2026-11-19",
        outcome: "complete_with_items",
        openItems: "Touch up paint on the front drip edge.",
      }),
      photoRelease: "granted",
      photoReleaseText: photoReleaseText("AllSeason Solar"),
      reviewRequestOk: true,
      reviewRequestText: reviewRequestText("AllSeason Solar"),
      signaturePath: signature,
      termsVersion: "2026-11-20",
    },
    homeownerUnavailableReason: null,
    submittedBy: "Micah",
    submittedAt: "2026-11-20T14:00:00Z",
    photos: await Promise.all(["#5b6b4f", "#8a8f94", "#6f5546", "#45607a"].map(async (color, index) => ({
      data: await photo(color),
      takenAt: `2026-11-18T1${index}:30:00Z`,
    }))),
    ...overrides,
  };
}

async function text(pdf: Buffer) {
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const { text: merged, totalPages } = await extractText(document, { mergePages: true });
  return { text: merged, totalPages };
}

describe("installRange", () => {
  it("prints install days compactly", () => {
    expect(installRange("2026-11-18", "2026-11-18")).toBe("Nov 18, 2026");
    expect(installRange("2026-11-30", "2026-12-02")).toBe("Nov 30 to Dec 2, 2026");
    expect(installRange("2026-12-31", "2027-01-02")).toBe("Dec 31, 2026 to Jan 2, 2027");
  });
});

describe("CloseoutPackageDocument", () => {
  it("prints the install, checklist, sign-off and a photo page", async () => {
    const pdf = await renderToBuffer(<CloseoutPackageDocument {...await props()} />);
    if (process.env.CLOSEOUT_PDF_OUT) writeFileSync(process.env.CLOSEOUT_PDF_OUT, pdf);
    const { text: printed, totalPages } = await text(pdf);

    expect(totalPages).toBe(2);
    expect(printed).toContain("Dana Whitfield");
    expect(printed).toContain("Nov 18 to 19, 2026");
    expect(printed).toContain("Solar panels reinstalled and producing");
    expect(printed).toContain("Touch up paint on the front drip edge.");
    expect(printed).toContain("except for these open items: Touch up paint on the front drip edge.");
    expect(printed).toContain("SRS Distribution Invoice.pdf");
    expect(printed).not.toMatch(/\$\d/);
    expect(printed.replace(/\s+/g, "")).toContain("PREPAREDWITHRAKE");
  }, 30_000);

  it("records why the homeowner didn't sign, and drops the photo page when there are none", async () => {
    const pdf = await renderToBuffer(
      <CloseoutPackageDocument {...await props({ homeowner: null, homeownerUnavailableReason: "Homeowner out of state; walked it by video", photos: [] })} />,
    );
    const { text: printed, totalPages } = await text(pdf);
    expect(totalPages).toBe(1);
    expect(printed).toContain("The homeowner did not sign at closeout.");
    expect(printed).toContain("walked it by video");
  }, 30_000);
});
