import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
// @ts-expect-error -- jsdom is supplied by the workspace test runtime.
import {JSDOM} from "jsdom";
import {describe, expect, test} from "vitest";

const runtimePath = path.join(__dirname, "posthog-runtime.js");
const runtime = existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "";

function runtimeDom() {
  return new JSDOM('<!doctype html><html><head></head><body><form id="leadForm"><input name="email"></form></body></html>', {
    url: "https://allseasonroofingquote.com/",
    runScripts: "outside-only",
  });
}

function consent(dom: JSDOM, analytics: boolean) {
  dom.window.dispatchEvent(new dom.window.CustomEvent("allseason:privacy-consent", {
    detail: {analytics},
  }));
}

describe("PostHog browser runtime", () => {
  test("captures canonical funnel and phone events only after opt-in", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);
    const emit = (name: string) => dom.window.dispatchEvent(new dom.window.CustomEvent(`allseason:${name}`, {detail: {campaign: "roofing", email: "private@example.com"}}));
    emit("campaign_form_success");
    expect((dom.window as Window & {posthog?: unknown}).posthog).toBeUndefined();
    consent(dom, true);
    emit("address_selected"); emit("campaign_form_contact_step"); emit("campaign_form_success");
    const link = dom.window.document.createElement("a"); link.href = "tel:+18888325050";
    link.addEventListener("click", (event: Event) => event.preventDefault());
    dom.window.document.body.appendChild(link); link.click();
    const queue = (dom.window as Window & {posthog: unknown[][]}).posthog;
    expect(queue).toContainEqual(["capture", "address_selected", {campaign: "roofing"}]);
    expect(queue).toContainEqual(["capture", "step2_reached", {campaign: "roofing"}]);
    expect(queue).toContainEqual(["capture", "lead_submitted", {campaign: "roofing"}]);
    expect(queue).toContainEqual(["capture", "phone_clicked", {page_path: "/", location: "page"}]);
    expect(JSON.stringify(queue)).not.toContain("private@example.com");
    const count = queue.filter((entry) => entry[0] === "capture").length;
    consent(dom, false); emit("campaign_form_success"); link.click();
    expect(queue.filter((entry) => entry[0] === "capture")).toHaveLength(count);
    consent(dom, true);
    expect(queue.some((entry) => entry[0] === "startSessionRecording")).toBe(false);
  });
  test("ships as a first-party website asset", () => {
    expect(existsSync(runtimePath)).toBe(true);
  });

  test("does not load PostHog before verified Analytics consent", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);

    expect(dom.window.document.querySelector('script[src*="posthog.com"]')).toBeNull();
    expect((dom.window as Window & {posthog?: unknown}).posthog).toBeUndefined();
  });

  test("loads analytics after consent with replay and autocapture disabled", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);
    consent(dom, true);

    const script = dom.window.document.querySelector<HTMLScriptElement>('script[src*="posthog.com"]');
    const posthog = (dom.window as Window & {posthog?: {_i?: unknown[][]}}).posthog;
    const init = posthog?._i?.[0];

    expect(script?.src).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(init?.[0]).toBe("phc_CUkgZx6k97j6SQWzoDJLee63mmpqnfwWsdnCTziUnX49");
    expect(init?.[1]).toMatchObject({
      api_host: "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: false,
      mask_all_element_attributes: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "form",
        blockSelector: "[data-posthog-block]",
        recordCrossOriginIframes: false,
      },
    });
  });

  test("captures only allowlisted, value-free form diagnostics while consented", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);
    consent(dom, true);
    const posthog = (dom.window as Window & {posthog?: unknown[][] & {capture?: (...args: unknown[]) => void}}).posthog;
    const calls: unknown[][] = [];
    if (!posthog) throw new Error("Missing PostHog stub");
    posthog.capture = (...args: unknown[]) => calls.push(args);

    dom.window.dispatchEvent(new dom.window.CustomEvent("allseason:campaign_form_error", {
      detail: {
        campaign: "roof-replacement",
        error_type: "network",
        email: "private@example.com",
        address: "123 Private Street",
        arbitrary: "drop me",
      },
    }));
    dom.window.dispatchEvent(new dom.window.CustomEvent("allseason:not_allowlisted", {
      detail: {reason: "ignore"},
    }));

    expect(calls).toEqual([["campaign_form_error", {
      campaign: "roof-replacement",
      error_type: "network",
    }]]);
  });

  test("opts out and stops replay immediately when Analytics consent is revoked", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);
    consent(dom, true);
    const calls: string[] = [];
    const posthog = (dom.window as Window & {posthog?: Record<string, () => void>}).posthog;
    if (!posthog) throw new Error("Missing PostHog stub");
    posthog.stopSessionRecording = () => calls.push("stop");
    posthog.opt_out_capturing = () => calls.push("opt-out");
    posthog.reset = () => calls.push("reset");

    consent(dom, false);

    expect(calls).toEqual(["stop", "opt-out", "reset"]);
  });

  test("reports anonymous embedded-form friction without reading field values", () => {
    const dom = runtimeDom();
    dom.window.eval(runtime);
    consent(dom, true);
    const calls: unknown[][] = [];
    const posthog = (dom.window as Window & {posthog?: unknown[][] & {capture?: (...args: unknown[]) => void}}).posthog;
    if (!posthog) throw new Error("Missing PostHog stub");
    posthog.capture = (...args: unknown[]) => calls.push(args);
    const input = dom.window.document.querySelector<HTMLInputElement>('input[name="email"]');
    const form = dom.window.document.querySelector<HTMLFormElement>("#leadForm");
    if (!input || !form) throw new Error("Missing fixture form");

    input.value = "private@example.com";
    input.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
    input.dispatchEvent(new dom.window.Event("invalid", {bubbles: true}));
    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));

    expect(calls).toEqual([
      ["embedded_form_start", {form_type: "lead"}],
      ["embedded_form_validation_error", {form_type: "lead", error_type: "invalid_field"}],
      ["embedded_form_submit", {form_type: "lead"}],
    ]);
    expect(JSON.stringify(calls)).not.toContain("private@example.com");
  });
});
