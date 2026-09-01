import {describe, expect, test} from "vitest";
import {isFakePlaceDetailsTestMode} from "./fake-place-details";

const enabled = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "development",
  ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED: "true",
};

describe("fake Place Details test mode", () => {
  test.each([
    {...enabled, NODE_ENV: "production"},
    {...enabled, DEPLOYMENT_ENV: "production"},
    {...enabled, DEPLOYMENT_ENV: "preview"},
    {...enabled, DEPLOYMENT_ENV: "test"},
    {...enabled, ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED: "false"},
    {NODE_ENV: "test", DEPLOYMENT_ENV: "development"},
  ])("is disabled for %j", (environment) => {
    expect(isFakePlaceDetailsTestMode(environment)).toBe(false);
  });

  test.each(["test", "development"])("is enabled only for %s Node in an explicit development deployment", (nodeEnv) => {
    expect(isFakePlaceDetailsTestMode({...enabled, NODE_ENV: nodeEnv})).toBe(true);
  });
});
