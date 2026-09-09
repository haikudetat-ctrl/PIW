(function () {
  "use strict";

  var META_SCRIPT_SELECTOR = 'script[data-all-season-meta-pixel="true"]';
  var MAX_EVENT_AGE_MS = 10 * 60 * 1000;
  var MAX_FUTURE_SKEW_MS = 30 * 1000;
  var CONSENT_READY_TIMEOUT_MS = 500;
  var resolveConsentReady;
  var consentReady = new Promise(function (resolve) {
    resolveConsentReady = resolve;
  });
  var consentState = {
    consent: null,
    resolved: false,
    pageViewTracked: false,
    conversionIds: new Set(),
    saving: false,
    error: "",
    dialog: null,
    previousFocus: null,
  };
  var authorityEpoch = 0;
  var analyticsDefaultOn = false;
  var DENIAL_KEY = "allseason-privacy-denials";
  function denials() {
    try { return JSON.parse(window.localStorage.getItem(DENIAL_KEY)) || {}; } catch { return {}; }
  }
  function rememberDenials(preferences, confirmed) {
    var previous = denials();
    try { window.localStorage.setItem(DENIAL_KEY, JSON.stringify({
      analytics: !preferences.analytics || (!confirmed && previous.analytics === true),
      advertising: !preferences.advertising || (!confirmed && previous.advertising === true),
    })); } catch { /* In-memory state still suppresses tracking. */ }
  }

  function config() {
    var node = document.getElementById("all-season-meta-config");
    if (!node) return {enabled: false, pixelId: null};
    try {
      var parsed = JSON.parse(node.textContent || "");
      analyticsDefaultOn = Boolean(parsed && parsed.analyticsDefaultOn === true);
      if (
        !parsed
        || typeof parsed !== "object"
        || parsed.enabled !== true
        || typeof parsed.pixelId !== "string"
        || !/^\d{6,32}$/.test(parsed.pixelId)
      ) return {enabled: false, pixelId: null};
      return {enabled: true, pixelId: parsed.pixelId};
    } catch {
      return {enabled: false, pixelId: null};
    }
  }

  var metaConfig = config();

  function isUuid(value) {
    return typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function isIsoTimestamp(value) {
    return typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value));
  }

  function isVerifiedConsent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var preferences = value.preferences;
    return value.policyVersion === "piw-privacy-v1"
      && isUuid(value.consentId)
      && isIsoTimestamp(value.updatedAt)
      && typeof value.gpcDetected === "boolean"
      && preferences
      && preferences.necessary === true
      && typeof preferences.analytics === "boolean"
      && typeof preferences.advertising === "boolean"
      && !(value.gpcDetected && preferences.advertising);
  }

  function isCurrentEnvelope(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (["Lead", "QualifiedLead"].indexOf(value.name) === -1 || !isUuid(value.eventId) || !isIsoTimestamp(value.issuedAt)) return false;
    var issuedAt = Date.parse(value.issuedAt);
    var age = Date.now() - issuedAt;
    return age >= -MAX_FUTURE_SKEW_MS && age <= MAX_EVENT_AGE_MS;
  }

  function browserGpcIsEnabled() {
    return Boolean(
      window.navigator
      && window.navigator.globalPrivacyControl === true,
    );
  }

  function advertisingAllowed() {
    return !consentState.saving && denials().advertising !== true && consentState.resolved
      && consentState.consent
      && !browserGpcIsEnabled()
      && consentState.consent.preferences.advertising === true;
  }

  function publishAnalyticsConsent() {
    if (window.fbq && !advertisingAllowed()) window.fbq("consent", "revoke");
    window.dispatchEvent(new CustomEvent("allseason:privacy-consent", {
      detail: {
        analytics: Boolean(
          denials().analytics !== true && consentState.resolved
          && (consentState.consent ? consentState.consent.preferences.analytics === true : analyticsDefaultOn)
        ),
      },
    }));
  }

  function ensurePixel() {
    var existing = window.fbq;
    var fbq = existing || function () {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
        return;
      }
      fbq.queue = fbq.queue || [];
      fbq.queue.push(arguments);
    };
    if (!existing) {
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
      window._fbq = fbq;
      window.fbq = fbq;
    }

    if (!document.querySelector(META_SCRIPT_SELECTOR)) {
      var script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.dataset.allSeasonMetaPixel = "true";
      document.head.appendChild(script);
    }
    fbq("consent", "grant");
    return fbq;
  }

  function trackPageView() {
    if (!metaConfig.enabled || !metaConfig.pixelId || !advertisingAllowed() || consentState.pageViewTracked) return;
    var fbq = ensurePixel();
    fbq("init", metaConfig.pixelId);
    fbq("track", "PageView");
    consentState.pageViewTracked = true;
  }

  function emitConversion(envelope) {
    if (!metaConfig.enabled || !metaConfig.pixelId || !advertisingAllowed() || !isCurrentEnvelope(envelope)) return;
    if (consentState.conversionIds.has(envelope.eventId)) return;
    var fbq = ensurePixel();
    fbq("track", envelope.name, {}, {eventID: envelope.eventId});
    consentState.conversionIds.add(envelope.eventId);
  }

  function trackConversion(envelope) {
    if (!isCurrentEnvelope(envelope)) return;
    void authorizeAdvertising().then(function (allowed) {
      if (allowed) emitConversion(envelope);
    });
  }

  function waitForConsentReady() {
    if (consentState.resolved) return Promise.resolve();
    return Promise.race([
      consentReady,
      new Promise(function (resolve) {
        window.setTimeout(resolve, CONSENT_READY_TIMEOUT_MS);
      }),
    ]);
  }

  function trackConversionBeforeNavigation(envelope) {
    if (!metaConfig.enabled || !metaConfig.pixelId || !isCurrentEnvelope(envelope)) {
      return Promise.resolve();
    }
    return waitForConsentReady().then(function () {
      return authorizeAdvertising().then(function (allowed) {
        if (allowed) emitConversion(envelope);
      });
    }).catch(function () {
      try {
        consentState.consent = null;
      } catch {
        // Meta is intentionally nonblocking for customer intake.
      }
    });
  }

  window.AllSeasonMeta = {
    trackConversion: trackConversion,
    trackConversionBeforeNavigation: trackConversionBeforeNavigation,
  };

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, className) {
    var node = element("button", className || "all-season-privacy-button", label);
    node.type = "button";
    node.disabled = consentState.saving;
    node.addEventListener("click", action);
    return node;
  }

  function clearConsentSurface() {
    document.querySelectorAll("[data-all-season-privacy-gate], [data-all-season-privacy-banner], [data-all-season-privacy-reopen]")
      .forEach(function (node) { node.remove(); });
  }

  function errorMessage() {
    if (!consentState.error) return null;
    var node = element("p", "all-season-privacy-error", consentState.error);
    node.setAttribute("role", "alert");
    return node;
  }

  function showBanner() {
    var gate = element("div", "all-season-privacy-gate");
    gate.dataset.allSeasonPrivacyGate = "true";
    var banner = element("section", "all-season-privacy-banner");
    banner.dataset.allSeasonPrivacyBanner = "true";
    banner.setAttribute("aria-label", "Privacy choices");
    banner.setAttribute("role", "region");

    var copy = element("div", "all-season-privacy-copy");
    copy.appendChild(element("p", "all-season-privacy-kicker", "Privacy choices"));
    copy.appendChild(element("h2", "all-season-privacy-title", "Your privacy choices."));
    copy.appendChild(element(
      "p",
      "all-season-privacy-body",
      "With your permission, we use analytics to understand how our service is used and improve its performance, and advertising tools to measure and personalize ads. Allow both, reject all, or customize each choice. You can change your choices anytime in Privacy Choices.",
    ));
    var policy = element("a", "all-season-privacy-link", "Read our privacy policy");
    policy.href = "/privacy.html";
    copy.appendChild(policy);
    var message = errorMessage();
    if (message) copy.appendChild(message);

    var actions = element("div", "all-season-privacy-actions");
    var acceptAll = button("Allow analytics & advertising", function () { savePreferences({analytics: true, advertising: true}); }, "all-season-privacy-button all-season-privacy-secondary");
    actions.appendChild(acceptAll);
    actions.appendChild(button("Reject all", function () { savePreferences({analytics: false, advertising: false}); }, "all-season-privacy-button all-season-privacy-secondary"));
    actions.appendChild(button("Customize", openDialog, "all-season-privacy-button all-season-privacy-quiet"));
    banner.append(copy, actions);
    gate.appendChild(banner);
    document.body.prepend(gate);
    return banner;
  }

  function showReopenButton() {
    var node = button("Privacy choices", openDialog, "all-season-privacy-reopen");
    node.dataset.allSeasonPrivacyReopen = "true";
    node.setAttribute("aria-label", "Open privacy choices");
    document.body.appendChild(node);
    return node;
  }

  function renderConsentSurface() {
    clearConsentSurface();
    if (!consentState.resolved) return null;
    if (consentState.consent) return showReopenButton();
    return showBanner();
  }

  function focusPrivacyChoices() {
    var control = document.querySelector("[data-all-season-privacy-reopen]");
    if (
      control
      && document.documentElement.contains(control)
      && typeof control.focus === "function"
    ) control.focus();
  }

  function focusableIn(dialog) {
    return Array.from(dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter(function (node) { return !node.hidden; });
  }

  function closeDialog(options) {
    if (!consentState.dialog) return null;
    var restoreFocus = !options || options.restoreFocus !== false;
    var dialogState = consentState.dialog;
    var previousFocus = consentState.previousFocus;
    consentState.dialog = null;
    document.removeEventListener("keydown", dialogState.onKeydown);
    document.documentElement.classList.remove("all-season-privacy-modal-open");
    dialogState.backdrop.remove();
    consentState.previousFocus = null;
    if (
      restoreFocus
      && previousFocus
      && document.documentElement.contains(previousFocus)
      && typeof previousFocus.focus === "function"
    ) {
      previousFocus.focus();
    }
    return previousFocus;
  }

  function openDialog(preserveError, previousFocus) {
    if (consentState.dialog) return;
    if (!preserveError) consentState.error = "";
    consentState.previousFocus = previousFocus || document.activeElement;

    var backdrop = element("div", "all-season-privacy-modal");
    backdrop.dataset.allSeasonPrivacyModal = "true";
    var dialog = element("section", "all-season-privacy-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "all-season-privacy-dialog-title");
    dialog.setAttribute("aria-describedby", "all-season-privacy-dialog-description");
    dialog.tabIndex = -1;

    var heading = element("h2", "all-season-privacy-dialog-title", "Privacy choices");
    heading.id = "all-season-privacy-dialog-title";
    dialog.appendChild(heading);
    var description = element("p", "all-season-privacy-dialog-copy", "Choose the optional technologies you want to allow. Necessary technology always stays on so the site can work.");
    description.id = "all-season-privacy-dialog-description";
    dialog.appendChild(description);

    function choice(label, key, checked, disabled) {
      var labelNode = element("label", "all-season-privacy-choice");
      var input = element("input");
      input.type = "checkbox";
      input.name = key;
      input.checked = checked;
      input.disabled = disabled || consentState.saving;
      if (key === "necessary") input.setAttribute("aria-label", "Necessary");
      else input.setAttribute("aria-label", label);
      var text = element("span", "", label);
      labelNode.append(input, text);
      return {label: labelNode, input: input};
    }

    var gpcDetected = browserGpcIsEnabled();
    var preferences = consentState.consent ? consentState.consent.preferences : {analytics: false, advertising: false};
    var necessary = choice("Necessary", "necessary", true, true);
    var analytics = choice("Analytics", "analytics", preferences.analytics === true, false);
    var advertising = choice("Advertising", "advertising", preferences.advertising === true && !gpcDetected, gpcDetected);
    dialog.append(necessary.label, analytics.label, advertising.label);
    if (gpcDetected) {
      dialog.appendChild(element(
        "p",
        "all-season-privacy-gpc",
        "Global Privacy Control is active, so Advertising remains off.",
      ));
    }

    var dialogError = errorMessage();
    if (dialogError) dialog.appendChild(dialogError);
    var actions = element("div", "all-season-privacy-dialog-actions");
    actions.appendChild(button("Save preferences", function () {
      savePreferences({analytics: analytics.input.checked, advertising: advertising.input.checked});
    }, "all-season-privacy-button all-season-privacy-primary"));
    actions.appendChild(button("Cancel", closeDialog, "all-season-privacy-button all-season-privacy-secondary"));
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("mousedown", function (event) {
      if (event.target === backdrop) closeDialog();
    });

    var onKeydown = function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = focusableIn(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    consentState.dialog = {backdrop: backdrop, onKeydown: onKeydown};
    document.addEventListener("keydown", onKeydown);
    document.documentElement.classList.add("all-season-privacy-modal-open");
    document.body.appendChild(backdrop);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () { analytics.input.focus(); });
    } else {
      window.setTimeout(function () { analytics.input.focus(); }, 0);
    }
  }

  function setSaving(value) {
    consentState.saving = value;
  }

  async function savePreferences(preferences) {
    if (consentState.saving) return;
    setSaving(true);
    var saveEpoch = ++authorityEpoch;
    consentState.error = "";
    var gpcDetected = browserGpcIsEnabled();
    var requested = gpcDetected
      ? {analytics: preferences.analytics, advertising: false, gpcDetected: true}
      : preferences;
    rememberDenials(requested, false);
    if (consentState.consent) {
      consentState.consent.preferences.analytics = consentState.consent.preferences.analytics && requested.analytics;
      consentState.consent.preferences.advertising = consentState.consent.preferences.advertising && requested.advertising;
    }
    publishAnalyticsConsent();
    try {
      var response = await window.fetch("/api/privacy/consent", {
        method: "POST",
        headers: {"content-type": "application/json", accept: "application/json"},
        body: JSON.stringify(requested),
        credentials: "same-origin",
        cache: "no-store",
      });
      var payload = await response.json().catch(function () { return null; });
      if (!response.ok || !payload || !isVerifiedConsent(payload.consent)) throw new Error("Unable to save");
      if (saveEpoch !== authorityEpoch) return;
      rememberDenials(payload.consent.preferences, true);
      consentState.consent = payload.consent;
      consentState.resolved = true;
      setSaving(false);
      closeDialog({restoreFocus: false});
      renderConsentSurface();
      focusPrivacyChoices();
      publishAnalyticsConsent();
      trackPageView();
    } catch {
      setSaving(false);
      consentState.error = "We could not save your privacy choices. Please try again.";
      if (consentState.dialog) {
        var previousFocus = closeDialog({restoreFocus: false});
        openDialog(true, previousFocus);
      } else {
        renderConsentSurface();
      }
    } finally {
      setSaving(false);
    }
  }

  async function revalidateConsent() {
    var requestEpoch = ++authorityEpoch;
    try {
      var response = await window.fetch("/api/privacy/consent", {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(browserGpcIsEnabled() ? {"x-all-season-gpc": "1"} : {}),
        },
        credentials: "same-origin",
        cache: "no-store",
      });
      var payload = await response.json().catch(function () { return null; });
      if (requestEpoch !== authorityEpoch) return false;
      consentState.consent = response.ok && payload && isVerifiedConsent(payload.consent)
        ? payload.consent
        : null;
    } catch {
      if (requestEpoch !== authorityEpoch) return false;
      consentState.consent = null;
    }
    consentState.resolved = true;
    publishAnalyticsConsent();
    return advertisingAllowed();
  }

  function authorizeAdvertising() {
    if (consentState.saving || denials().advertising === true) return Promise.resolve(false);
    var requestEpoch = authorityEpoch + 1;
    return Promise.race([
      revalidateConsent(),
      new Promise(function (resolve) {
        window.setTimeout(function () {
          if (authorityEpoch === requestEpoch) {
            authorityEpoch += 1;
            consentState.consent = null;
          }
          resolve(false);
        }, CONSENT_READY_TIMEOUT_MS);
      }),
    ]);
  }

  async function loadVerifiedConsent() {
    await revalidateConsent();
    resolveConsentReady();
    renderConsentSurface();
    trackPageView();
  }

  function boot() {
    void loadVerifiedConsent();
    window.addEventListener("focus", function () {
      if (!consentState.saving) void revalidateConsent();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !consentState.saving) void revalidateConsent();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once: true});
  } else {
    boot();
  }
})();
