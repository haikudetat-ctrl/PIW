(function () {
  "use strict";

  // Value-first address step for the static homepage and contact forms. When
  // the preview flow is enabled it replaces #leadForm (before script.js binds
  // to it) with an address-only form; contact details are collected on the
  // estimate host after the homeowner sees their roof.

  // Keep in sync with apps/website/lib/property-preview-notice.ts.
  var SUBMIT_LABEL = "See my roof";
  var NOTICE = "By clicking “See my roof,” you authorize All Season Solar to review this address using property records, maps, and imagery.";
  var TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "gbraid", "wbraid"];

  function readConfig() {
    var node = document.getElementById("all-season-quote-config");
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      return null;
    }
  }

  function element(tag, attributes, text) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function field(name, label, attributes) {
    var wrap = element("div", {class: "field"});
    var id = "preview-" + name;
    wrap.appendChild(element("label", {for: id}, label));
    var input = element("input", Object.assign({id: id, name: name, type: "text"}, attributes || {}));
    wrap.appendChild(input);
    return {wrap: wrap, input: input};
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    return new Promise(function (resolve, reject) {
      var script = element("script", {src: TURNSTILE_SRC, async: "", defer: ""});
      script.onload = function () { resolve(window.turnstile); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function track(name, detail) {
    window.dispatchEvent(new CustomEvent("allseason:" + name, {detail: Object.assign({form_type: "preview_address"}, detail || {})}));
  }

  function mount(legacyForm, config) {
    var entryPoint = legacyForm.getAttribute("data-entry-point") || "main-home";
    var form = element("form", {"data-preview-address-form": "", novalidate: ""});
    var state = {placeId: null, address: "", manual: false, token: null, widgetId: null, pending: false};

    var searchWrap = element("div", {class: "field preview-address-search"});
    searchWrap.appendChild(element("label", {for: "preview-address-search"}, "Home address"));
    var search = element("input", {id: "preview-address-search", type: "text", autocomplete: "street-address", "data-address-search": "", placeholder: "Start typing your address"});
    searchWrap.appendChild(search);
    var suggestions = element("div", {class: "preview-address-suggestions", role: "listbox"});
    searchWrap.appendChild(suggestions);

    var manualWrap = element("div", {class: "preview-address-manual", hidden: ""});
    var line1 = field("address_line_1", "Street address", {autocomplete: "address-line1", required: "", minlength: "3"});
    var city = field("city", "City", {autocomplete: "address-level2", required: "", minlength: "2"});
    var postal = field("postal_code", "ZIP code", {autocomplete: "postal-code", inputmode: "numeric", pattern: "[0-9]{5}(-[0-9]{4})?", required: ""});
    [line1, city, postal].forEach(function (item) { manualWrap.appendChild(item.wrap); });

    var toggle = element("button", {type: "button", class: "text-link", "data-manual-toggle": ""}, "Can’t find it? Enter the address manually");
    var widget = element("div", {"data-turnstile": ""});
    var notice = element("p", {class: "consent", "data-preview-notice": ""}, NOTICE);
    var error = element("p", {class: "form-error", role: "alert", hidden: ""});
    var submit = element("button", {type: "submit", class: "btn btn-primary btn-block"}, SUBMIT_LABEL);

    [searchWrap, manualWrap, toggle, widget, notice, error, submit].forEach(function (node) { form.appendChild(node); });
    legacyForm.replaceWith(form);

    function showError(message) {
      error.textContent = message;
      error.hidden = !message;
    }

    toggle.addEventListener("click", function () {
      state.manual = !state.manual;
      manualWrap.hidden = !state.manual;
      searchWrap.hidden = state.manual;
      toggle.textContent = state.manual ? "Use address search" : "Can’t find it? Enter the address manually";
      showError("");
    });

    var searchTimer;
    var requestId = 0;
    search.addEventListener("input", function () {
      state.placeId = null;
      state.address = "";
      suggestions.replaceChildren();
      var query = search.value.trim();
      window.clearTimeout(searchTimer);
      if (query.length < 3) return;
      var current = ++requestId;
      searchTimer = window.setTimeout(function () {
        window.fetch("/api/address-autocomplete", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({input: query}),
          credentials: "same-origin",
        }).then(function (response) {
          if (!response.ok) {
            if (response.status >= 500) toggle.click();
            return null;
          }
          return response.json();
        }).then(function (payload) {
          if (!payload || current !== requestId) return;
          (payload.suggestions || []).slice(0, 5).forEach(function (suggestion) {
            var option = element("button", {type: "button", role: "option", class: "preview-address-option", "data-suggestion": ""}, suggestion.address);
            option.addEventListener("click", function () {
              state.placeId = suggestion.placeId;
              state.address = suggestion.address;
              search.value = suggestion.address;
              suggestions.replaceChildren();
              showError("");
              track("address_selected");
            });
            suggestions.appendChild(option);
          });
        }).catch(function () { toggle.click(); });
      }, 260);
    });

    loadTurnstile().then(function (api) {
      if (!api || !config.turnstileSiteKey) return;
      state.widgetId = api.render(widget, {
        sitekey: config.turnstileSiteKey,
        action: "property_preview",
        appearance: "interaction-only",
        callback: function (token) { state.token = token; },
        "expired-callback": function () { state.token = null; },
        "error-callback": function () { state.token = null; },
      });
    }).catch(function () { state.token = null; });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (state.pending) return;
      var address;
      var placeId = null;
      if (state.manual) {
        var invalid = [line1, city, postal].filter(function (item) { return !item.input.checkValidity(); })[0];
        if (invalid) {
          showError("Enter the street address, city, and ZIP code.");
          invalid.input.focus();
          return;
        }
        address = line1.input.value.trim() + ", " + city.input.value.trim() + ", NJ " + postal.input.value.trim();
      } else {
        if (!state.placeId) {
          showError("Choose your home address from the list, or enter it manually.");
          search.focus();
          return;
        }
        address = state.address;
        placeId = state.placeId;
      }
      if (!state.token) {
        showError("Please complete the quick security check, then try again.");
        return;
      }

      state.pending = true;
      submit.disabled = true;
      submit.textContent = "Finding your roof…";
      showError("");
      track("address_submitted", {entry_point: entryPoint});
      var params = new URLSearchParams(window.location.search);
      var body = {
        address: address,
        google_place_id: placeId,
        campaign: null,
        entry_point: entryPoint,
        presentation_key: "all-season-main",
        turnstile_token: state.token,
      };
      ATTRIBUTION_KEYS.forEach(function (key) { body[key] = params.get(key); });

      window.fetch("/api/property-preview", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
        credentials: "same-origin",
      }).then(function (response) {
        return response.status === 201 ? response.json() : null;
      }).then(function (payload) {
        if (payload && typeof payload.previewUrl === "string" && payload.previewUrl.indexOf("https://") === 0) {
          window.location.assign(payload.previewUrl);
          return;
        }
        throw new Error("preview_failed");
      }).catch(function () {
        state.pending = false;
        state.token = null;
        submit.disabled = false;
        submit.textContent = SUBMIT_LABEL;
        if (window.turnstile && state.widgetId) window.turnstile.reset(state.widgetId);
        showError("We couldn’t look up that address just now. Please try again or call (888) 832-5050.");
        track("address_submit_error", {entry_point: entryPoint});
      });
    });
  }

  var config = readConfig();
  if (!config || !config.previewEnabled || !config.turnstileSiteKey) return;
  // The quote drawer (loaded later by script.js) mounts the same step.
  window.AllSeasonAddressEntry = {mount: function (form) { mount(form, config); }};
  var legacyForm = document.getElementById("leadForm");
  if (legacyForm) mount(legacyForm, config);
})();
