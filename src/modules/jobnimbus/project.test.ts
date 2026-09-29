// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  JobNimbusProjectionDataError,
  projectJobNimbusContact,
  projectJobNimbusEstimate,
  projectJobNimbusJob,
  runJobNimbusProjection,
  type JobNimbusProjectionStore,
  type StoredRawRecord,
} from "./project";

const COMPANY = "95000000-0000-4000-8000-000000000001";
const PROJECTED_AT = "2026-09-29T12:00:00.000Z";

describe("projectJobNimbusJob", () => {
  it("projects lifecycle, rep, contact and money fields", () => {
    const row = projectJobNimbusJob({
      companyId: COMPANY,
      projectedAt: PROJECTED_AT,
      fieldMap: { cf_string_12: "shingle_line", cf_string_13: "job_type" },
      payload: {
        jnid: "job-1",
        number: "1042",
        status_name: "Signed Contract",
        date_status_change: 1_758_000_000,
        record_type_name: "Roof",
        primary: { id: "contact-1", type: "contact", name: "Jane" },
        sales_rep: "rep-1",
        sales_rep_name: "Rep One",
        cf_string_12: "Landmark",
        "Shingle Line": "Display alias must be ignored",
        cf_string_13: "Roof Only",
        last_estimate: 18_500.5,
        approved_estimate_total: "18500.505",
        is_active: true,
        is_archived: false,
        date_created: 1_757_000_000,
        date_updated: 1_758_000_100,
      },
    });

    expect(row).toMatchObject({
      company_id: COMPANY,
      jnid: "job-1",
      status_name: "Signed Contract",
      status_changed_at: "2025-09-16T05:20:00.000Z",
      primary_contact_jnid: "contact-1",
      sales_rep_jnid: "rep-1",
      sales_rep_name: "Rep One",
      shingle_line: "Landmark",
      job_type: "Roof Only",
      estimate_total: 18_500.5,
      approved_total: 18_500.51,
      is_active: true,
      is_archived: false,
      projected_at: PROJECTED_AT,
    });
  });

  it("treats a zero status-change date and a non-contact primary as unset", () => {
    const row = projectJobNimbusJob({
      companyId: COMPANY,
      projectedAt: PROJECTED_AT,
      fieldMap: {},
      payload: { jnid: "job-2", date_status_change: 0, primary: { id: "x", type: "job" } },
    });

    expect(row.status_changed_at).toBeNull();
    expect(row.primary_contact_jnid).toBeNull();
    expect(row.shingle_line).toBeNull();
  });

  it("rejects a record without a jnid", () => {
    expect(() => projectJobNimbusJob({
      companyId: COMPANY, projectedAt: PROJECTED_AT, fieldMap: {}, payload: { jnid: " " },
    })).toThrow(JobNimbusProjectionDataError);
  });
});

describe("projectJobNimbusContact", () => {
  it("normalizes email and the first usable phone the same way PIW leads are", () => {
    const row = projectJobNimbusContact({
      companyId: COMPANY,
      projectedAt: PROJECTED_AT,
      payload: {
        jnid: "contact-1",
        first_name: "Jane",
        last_name: "Doe",
        email: "  Jane.Doe@Example.COM ",
        mobile_phone: "555",
        home_phone: "(201) 555-0101",
        work_phone: "973-555-0199",
        sales_rep: "rep-1",
        source_name: "Meta70",
      },
    });

    expect(row).toMatchObject({
      email_normalized: "jane.doe@example.com",
      phone_normalized: "+12015550101",
      sales_rep_jnid: "rep-1",
      source_name: "Meta70",
    });
  });

  it("leaves unusable contact details null", () => {
    const row = projectJobNimbusContact({
      companyId: COMPANY, projectedAt: PROJECTED_AT, payload: { jnid: "c", email: "not-an-email", mobile_phone: "" },
    });

    expect(row.email_normalized).toBeNull();
    expect(row.phone_normalized).toBeNull();
  });
});

describe("projectJobNimbusEstimate", () => {
  it("links the estimate to its job and prefers the approved total", () => {
    const row = projectJobNimbusEstimate({
      companyId: COMPANY,
      projectedAt: PROJECTED_AT,
      payload: {
        jnid: "est-1",
        related: [{ id: "contact-1", type: "contact" }, { id: "job-1", type: "job" }],
        total: 12_000,
        approved_total: 11_500,
        source: "sumoquote",
      },
    });

    expect(row).toMatchObject({
      related_job_jnid: "job-1", estimate_total: 12_000, approved_total: 11_500, source: "sumoquote",
    });
  });
});

describe("runJobNimbusProjection", () => {
  function store(pages: StoredRawRecord[][]): JobNimbusProjectionStore & { writes: unknown[][] } {
    const writes: unknown[][] = [];
    let call = 0;
    return {
      writes,
      getFieldMap: vi.fn(async () => ({ cf_string_12: "shingle_line" })),
      readRawPage: vi.fn(async () => pages[call++] ?? []),
      upsertRows: vi.fn(async (_type, rows) => {
        writes.push(rows);
      }),
    };
  }

  it("pages through raw records by jnid and upserts each page", async () => {
    const projectionStore = store([
      [
        { company_id: COMPANY, jnid: "a", record_type: "job", payload: { jnid: "a" } },
        { company_id: COMPANY, jnid: "b", record_type: "job", payload: { jnid: "b" } },
      ],
      [{ company_id: COMPANY, jnid: "c", record_type: "job", payload: { jnid: "c" } }],
    ]);

    const result = await runJobNimbusProjection(
      { companyId: COMPANY, recordType: "job", pageSize: 2 },
      { store: projectionStore, now: () => new Date(PROJECTED_AT) },
    );

    expect(result.recordsProjected).toBe(3);
    expect(projectionStore.readRawPage).toHaveBeenNthCalledWith(2, {
      companyId: COMPANY, recordType: "job", afterJnid: "b", limit: 2,
    });
    expect(projectionStore.writes.map((rows) => rows.length)).toEqual([2, 1]);
  });

  it("refuses a raw row that belongs to another company", async () => {
    const projectionStore = store([
      [{ company_id: "other", jnid: "a", record_type: "contact", payload: { jnid: "a" } }],
    ]);

    await expect(runJobNimbusProjection(
      { companyId: COMPANY, recordType: "contact" },
      { store: projectionStore, now: () => new Date(PROJECTED_AT) },
    )).rejects.toBeInstanceOf(JobNimbusProjectionDataError);
    expect(projectionStore.upsertRows).not.toHaveBeenCalled();
  });

  it("only reads the field map for jobs", async () => {
    const projectionStore = store([]);

    await runJobNimbusProjection(
      { companyId: COMPANY, recordType: "estimate" },
      { store: projectionStore, now: () => new Date(PROJECTED_AT) },
    );

    expect(projectionStore.getFieldMap).not.toHaveBeenCalled();
  });
});
