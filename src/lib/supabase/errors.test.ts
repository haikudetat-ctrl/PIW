import { describe, expect, test } from "vitest";
import { describeSupabaseError, supabaseError } from "./errors";

describe("supabase error diagnostics", () => {
  test("keeps every field PostgREST returns", () => {
    expect(
      describeSupabaseError("Failed to find reusable roof estimate", {
        code: "PGRST200",
        message: "Could not find a relationship between tables",
        details: "Searched for a foreign key relationship",
        hint: "Verify that the schema cache is current",
      }),
    ).toBe(
      "Failed to find reusable roof estimate: code=PGRST200; " +
        "message=Could not find a relationship between tables; " +
        "details=Searched for a foreign key relationship; " +
        "hint=Verify that the schema cache is current",
    );
  });

  test("omits fields PostgREST left empty", () => {
    expect(
      describeSupabaseError("Failed to claim canonical address", {
        code: "23503",
        message: "insert violates foreign key constraint",
      }),
    ).toBe(
      "Failed to claim canonical address: code=23503; " +
        "message=insert violates foreign key constraint",
    );
  });

  test("distinguishes a rejected query from one that matched nothing", () => {
    expect(describeSupabaseError("Failed to reserve Google Solar usage", null)).toBe(
      "Failed to reserve Google Solar usage: query succeeded but returned no matching row",
    );
    expect(
      describeSupabaseError("Failed to load attempt", undefined, "no attempt row"),
    ).toBe("Failed to load attempt: no attempt row");
  });

  test("supabaseError returns a throwable carrying the diagnosis", () => {
    const thrown = supabaseError("Failed to finalize roof estimate", {
      code: "PGRST204",
      message: "column not found",
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe(
      "Failed to finalize roof estimate: code=PGRST204; message=column not found",
    );
  });
});
