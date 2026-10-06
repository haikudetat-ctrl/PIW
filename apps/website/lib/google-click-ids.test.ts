import {describe, expect, test} from "vitest";
import {presentGoogleClickIds} from "./google-click-ids";

describe("presentGoogleClickIds", () => {
  test("keeps only trimmed, non-empty Google click IDs", () => {
    expect(presentGoogleClickIds({gclid: " abc ", gbraid: "", wbraid: null})).toEqual({gclid: "abc"});
    expect(presentGoogleClickIds({wbraid: "w-1"})).toEqual({wbraid: "w-1"});
  });

  test("returns an empty object when no click ID is present", () => {
    expect(presentGoogleClickIds({})).toEqual({});
    expect(presentGoogleClickIds({gclid: "   "})).toEqual({});
  });
});
