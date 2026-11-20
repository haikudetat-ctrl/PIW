import { describe, expect, it } from "vitest";
import {
  checklistFor,
  closeoutGaps,
  formatAddress,
  hasSolarRemoveAndReinstall,
  homeownerStatement,
  isPreSaleStatus,
  isUsableSignature,
  packageFilename,
  parseCloseoutForm,
  parsePrefill,
  signaturePath,
  signoffInputSchema,
} from "./closeouts";

describe("isPreSaleStatus", () => {
  it("flags pre-sale stages and JobNimbus's default Lead status, not custom production statuses", () => {
    expect(isPreSaleStatus("Quoted", "quoted")).toBe(true);
    expect(isPreSaleStatus("Lead", null)).toBe(true);
    expect(isPreSaleStatus("Signed Contract", "sold")).toBe(false);
    expect(isPreSaleStatus("Roof R&R", null)).toBe(false);
  });
});

describe("checklist", () => {
  it("adds the solar reinstall check only to solar remove-and-reinstall jobs", () => {
    expect(checklistFor("Roof Only").map((item) => item.key)).not.toContain("solar_reinstalled");
    expect(checklistFor("Roof & RR").map((item) => item.key)).toContain("solar_reinstalled");
    expect(hasSolarRemoveAndReinstall("Roof R&R")).toBe(true);
    expect(hasSolarRemoveAndReinstall(null)).toBe(false);
  });
});

describe("parseCloseoutForm", () => {
  function form(entries: [string, string][]) {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return data;
  }

  it("keeps known checklist answers and drops keys this job does not have", () => {
    const fields = parseCloseoutForm(
      form([
        ["install_started_on", "2026-11-17"],
        ["install_completed_on", "2026-11-18"],
        ["squares_installed", "27.5"],
        ["layers_removed", "2"],
        ["checklist.tear_off", "done"],
        ["checklist.solar_reinstalled", "done"],
        ["checklist.invented", "done"],
        ["photo", "file-1"],
        ["photo", "file-2"],
        ["crew", "  Andre's crew  "],
      ]),
      "Roof Only",
    );
    expect(fields.checklist).toEqual({ tear_off: "done" });
    expect(fields.squares_installed).toBe(27.5);
    expect(fields.layers_removed).toBe(2);
    expect(fields.decking_sheets_replaced).toBe("");
    expect(fields.selected_photo_jnids).toEqual(["file-1", "file-2"]);
    expect(fields.crew).toBe("Andre's crew");
  });

  it("rejects a finish date before the start date", () => {
    expect(() =>
      parseCloseoutForm(form([["install_started_on", "2026-11-18"], ["install_completed_on", "2026-11-17"]]), null),
    ).toThrow();
  });

  it("rejects more than twelve package photos", () => {
    const entries: [string, string][] = Array.from({ length: 13 }, (_, index) => ["photo", `file-${index}`]);
    expect(() => parseCloseoutForm(form(entries), null)).toThrow();
  });
});

describe("closeoutGaps", () => {
  const ready = {
    installStartedOn: "2026-11-17",
    installCompletedOn: "2026-11-18",
    checklist: Object.fromEntries(checklistFor("Roof Only").map((item) => [item.key, "done"])),
    homeownerSignedAt: "2026-11-18T20:00:00Z",
    homeownerUnavailableReason: null,
    selectedPhotoCount: 6,
  };

  it("is empty when everything is in", () => {
    expect(closeoutGaps(ready, "Roof Only", "2026-11-20")).toEqual([]);
  });

  it("names what is missing", () => {
    const gaps = closeoutGaps(
      { ...ready, installStartedOn: null, checklist: { tear_off: "done" }, homeownerSignedAt: null, selectedPhotoCount: 0 },
      "Roof & RR",
      "2026-11-20",
    );
    expect(gaps).toEqual([
      "Add the install start and finish dates",
      "Answer 11 checklist items",
      "Pick at least one photo for the package",
      "Get the homeowner's sign-off, or note why they couldn't sign",
    ]);
  });

  it("accepts a reason in place of a signature, and rejects a future finish date", () => {
    expect(
      closeoutGaps({ ...ready, homeownerSignedAt: null, homeownerUnavailableReason: "Out of state" }, "Roof Only", "2026-11-20"),
    ).toEqual([]);
    expect(closeoutGaps({ ...ready, installCompletedOn: "2026-11-21" }, "Roof Only", "2026-11-20")).toEqual([
      "The finish date is in the future",
    ]);
  });
});

describe("homeowner wording", () => {
  it("states completion, with or without open items", () => {
    const input = {
      companyName: "AllSeason Solar",
      workDescription: "roof replacement",
      address: "14 Linden Ave, Linwood, NJ 08221",
      completedOn: "2026-11-18",
    };
    expect(homeownerStatement({ ...input, outcome: "complete" })).toBe(
      "I walked the finished work with AllSeason Solar and confirm the roof replacement at 14 Linden Ave, Linwood, NJ 08221, finished on November 18, 2026, is complete.",
    );
    expect(homeownerStatement({ ...input, outcome: "complete_with_items", openItems: "Touch up paint on\n the front drip edge. " })).toBe(
      "I walked the finished work with AllSeason Solar and confirm the roof replacement at 14 Linden Ave, Linwood, NJ 08221, finished on November 18, 2026, is complete, except for these open items: Touch up paint on the front drip edge.",
    );
  });
});

describe("signature", () => {
  const stroke = Array.from({ length: 12 }, (_, index) => ({ x: 20 + index * 15.04, y: 100 + (index % 3) * 9 }));

  it("encodes strokes as move and line commands inside the box", () => {
    const path = signaturePath([[{ x: -5, y: 250 }, { x: 10.26, y: 20 }], []]);
    expect(path).toBe("M 0 200 L 10.3 20");
  });

  it("accepts a drawn signature and rejects taps or markup", () => {
    expect(isUsableSignature(signaturePath([stroke]))).toBe(true);
    expect(isUsableSignature("M 10 10 L 11 11 L 12 12 L 12 13 L 13 13")).toBe(false);
    expect(isUsableSignature('<path d="M 0 0"/>')).toBe(false);
  });

  it("parses the homeowner's answers", () => {
    const parsed = signoffInputSchema.parse({
      homeownerName: " Pat Owner ",
      outcome: "complete",
      photoRelease: "granted",
      reviewRequestOk: "no",
      signaturePath: signaturePath([stroke]),
    });
    expect(parsed.homeownerName).toBe("Pat Owner");
    expect(parsed.reviewRequestOk).toBe(false);
    expect(signoffInputSchema.safeParse({ ...parsed, photoRelease: undefined }).success).toBe(false);
  });
});

describe("prefill", () => {
  it("reads what the database captured and survives missing parts", () => {
    const prefill = parsePrefill({
      job: { jnid: "j1", number: "4512", city: "Linwood", state: "NJ", zip: "08221", address_line1: "14 Linden Ave" },
      delivered_at: "2026-11-17T17:21:47+00:00",
      delivery_documents: [{ jnid: "f1", filename: "SRS Distribution Proof of Delivery.pdf", created_at: null }],
      install_photo_days: { first: "2026-11-18", last: "2026-11-18", photos: 48 },
      roofr: null,
    });
    expect(formatAddress(prefill.job)).toBe("14 Linden Ave, Linwood, NJ 08221");
    expect(prefill.install_photo_days?.photos).toBe(48);
    expect(parsePrefill("garbage").delivery_documents).toEqual([]);
  });

  it("names the package after the job", () => {
    expect(packageFilename("4512", "7648b78d-0000")).toBe("Closeout package - Job 4512.pdf");
    expect(packageFilename(null, "7648b78d-0000")).toBe("Closeout package - Closeout 7648b78d.pdf");
  });
});
