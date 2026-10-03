import { describe, expect, test } from "vitest";
import { composePreviewReportEmail } from "./preview-report-email";

const base = {
  brandName: "All Season Solar",
  address: "1 Main St, Newark, NJ 07102, USA",
  resumeUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/resume/abc.sig",
  unsubscribeUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/unsubscribe/abc.sig",
};

describe("composePreviewReportEmail", () => {
  test("composes the report with the roof size, resume link and unsubscribe link, and no price", () => {
    const email = composePreviewReportEmail({...base, kind: "report", roof: {squares: 24, complexity: "moderate"}});
    expect(email.subject).toBe("Your roof report for 1 Main St, Newark, NJ 07102, USA");
    expect(email.text).toContain("About 24 roofing squares");
    expect(email.text).toContain("moderately complex");
    expect(email.text).toContain(base.resumeUrl);
    expect(email.text).toContain(base.unsubscribeUrl);
    expect(email.text).not.toMatch(/\$\d/);
  });

  test("omits a roof size that is not ready rather than inventing one", () => {
    const email = composePreviewReportEmail({...base, kind: "report", roof: null});
    expect(email.text).not.toContain("roofing squares");
    expect(email.text).toContain("A roofing specialist will confirm");
  });

  test("words the two reminders differently", () => {
    const first = composePreviewReportEmail({...base, kind: "reminder_1", roof: null});
    const second = composePreviewReportEmail({...base, kind: "reminder_2", roof: null});
    expect(first.subject).not.toBe(second.subject);
    for (const email of [first, second]) {
      expect(email.text).toContain(base.resumeUrl);
      expect(email.text).toContain(base.unsubscribeUrl);
    }
  });
});
