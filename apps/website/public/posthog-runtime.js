(function () {
  "use strict";

  var PROJECT_KEY = "phc_CUkgZx6k97j6SQWzoDJLee63mmpqnfwWsdnCTziUnX49";
  var API_HOST = "https://us.i.posthog.com";
  var ASSET_URL = "https://us-assets.i.posthog.com/static/array.js";
  var SCRIPT_SELECTOR = 'script[data-all-season-posthog="true"]';
  var ALLOWED_EVENTS = [
    "form_view", "address_selected", "step2_reached", "lead_submitted", "phone_clicked",
    "campaign_form_contact_step",
    "campaign_form_lead_intent",
    "campaign_form_submit",
    "campaign_form_success",
    "campaign_form_error",
    "quote_form_view",
    "quote_form_close",
    "quote_form_start",
    "quote_form_submit",
    "quote_form_success",
    "quote_form_error",
    "embedded_form_start",
    "embedded_form_validation_error",
    "embedded_form_submit",
    "embedded_form_success",
    "embedded_form_error",
  ];
  var ALLOWED_PROPERTIES = ["campaign", "page_path", "trigger", "reason", "form_type", "error_type", "location", "address_mode"];
  var analyticsAllowed = false;
  var initialized = false;
  var embeddedFormStarted = false;

  function installStub() {
    if (window.posthog) return window.posthog;
    var posthog = [];
    posthog._i = [];
    posthog.__SV = 1;
    posthog.init = function (key, config, name) {
      var instance = posthog;
      var instanceName = name || "posthog";
      if (name) instance = posthog[name] = [];
      var methods = "capture identify reset opt_in_capturing opt_out_capturing startSessionRecording stopSessionRecording".split(" ");
      methods.forEach(function (method) {
        instance[method] = function () {
          instance.push([method].concat(Array.prototype.slice.call(arguments)));
        };
      });
      posthog._i.push([key, config, instanceName]);
      return instance;
    };
    window.posthog = posthog;
    return posthog;
  }

  function safeProperties(detail) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
    return ALLOWED_PROPERTIES.reduce(function (properties, key) {
      if (typeof detail[key] === "string" && detail[key].length <= 100) {
        properties[key] = detail[key];
      }
      return properties;
    }, {});
  }

  function capture(name, detail) {
    if (!analyticsAllowed || ALLOWED_EVENTS.indexOf(name) === -1) return;
    if (!window.posthog || typeof window.posthog.capture !== "function") return;
    window.posthog.capture(name, safeProperties(detail));
  }

  function initialize() {
    if (initialized) {
      if (typeof window.posthog.opt_in_capturing === "function") window.posthog.opt_in_capturing();
      return;
    }
    var posthog = installStub();
    posthog.init(PROJECT_KEY, {
      api_host: API_HOST,
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "form",
        blockSelector: "[data-posthog-block]",
        recordCrossOriginIframes: false,
      },
      mask_all_text: false,
      mask_all_element_attributes: false,
      capture_performance: false,
    });
    if (!document.querySelector(SCRIPT_SELECTOR)) {
      var script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = ASSET_URL;
      script.dataset.allSeasonPosthog = "true";
      document.head.appendChild(script);
    }
    initialized = true;
  }

  function revoke() {
    if (!initialized || !window.posthog) return;
    if (typeof window.posthog.stopSessionRecording === "function") window.posthog.stopSessionRecording();
    if (typeof window.posthog.opt_out_capturing === "function") window.posthog.opt_out_capturing();
    if (typeof window.posthog.reset === "function") window.posthog.reset();
  }

  window.addEventListener("allseason:privacy-consent", function (event) {
    var previouslyAllowed = analyticsAllowed;
    analyticsAllowed = Boolean(event.detail && event.detail.analytics === true);
    if (analyticsAllowed) { if (!previouslyAllowed) { initialize(); observeForms(); } }
    else revoke();
  });

  ALLOWED_EVENTS.forEach(function (name) {
    window.addEventListener("allseason:" + name, function (event) {
      capture(name, event.detail);
      var canonical = {campaign_form_contact_step: "step2_reached", campaign_form_success: "lead_submitted", quote_form_view: "form_view", quote_form_success: "lead_submitted", embedded_form_success: "lead_submitted"}[name];
      if (canonical) capture(canonical, event.detail);
    });
  });

  var observedForms = new WeakSet();
  var viewedForms = new WeakSet();
  var visibleForms = new Set();
  var formObserver = typeof window.IntersectionObserver === "function" ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) visibleForms.add(entry.target);
      else visibleForms.delete(entry.target);
    });
    captureVisibleForms();
  }) : null;
  function captureVisibleForms() {
    if (!analyticsAllowed) return;
    visibleForms.forEach(function (form) {
      if (viewedForms.has(form)) return;
      viewedForms.add(form);
      capture("form_view", {form_type: form.id === "leadForm" ? "embedded" : "campaign", page_path: window.location.pathname});
    });
  }
  function observeForms() {
    document.querySelectorAll("form.campaign-form, form#leadForm").forEach(function (form) {
      if (!formObserver || observedForms.has(form)) return;
      observedForms.add(form); formObserver.observe(form);
    });
    captureVisibleForms();
  }
  new MutationObserver(observeForms).observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href^="tel:"]');
    if (link) capture("phone_clicked", {page_path: window.location.pathname, location: link.closest("footer") ? "footer" : "page"});
  });

  document.addEventListener("input", function (event) {
    if (embeddedFormStarted || !event.target || !event.target.closest) return;
    if (!event.target.closest("form#leadForm")) return;
    embeddedFormStarted = true;
    capture("embedded_form_start", {form_type: "lead"});
  });
  document.addEventListener("invalid", function (event) {
    if (!event.target || !event.target.closest || !event.target.closest("form#leadForm")) return;
    capture("embedded_form_validation_error", {form_type: "lead", error_type: "invalid_field"});
  }, true);
  document.addEventListener("submit", function (event) {
    if (!event.target || !event.target.matches || !event.target.matches("form#leadForm")) return;
    capture("embedded_form_submit", {form_type: "lead"});
  }, true);
})();
