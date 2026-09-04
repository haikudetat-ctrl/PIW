(function () {
  "use strict";

  function isUuid(value) {
    return typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function isIsoTimestamp(value) {
    return typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value));
  }

  function isAllowedEstimateUrl(value) {
    if (typeof value !== "string" || !value) return false;
    try {
      var url = new URL(value, window.location.origin);
      if (url.protocol === "https:") return true;
      return url.protocol === "http:"
        && ["localhost", "127.0.0.1", "::1"].indexOf(url.hostname) !== -1;
    } catch {
      return false;
    }
  }

  function parseMetaEvent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys.join(",") !== "eventId,issuedAt,name") return null;
    if (value.name !== "QualifiedLead" || !isUuid(value.eventId) || !isIsoTimestamp(value.issuedAt)) return null;
    return value;
  }

  function parseCanonicalEstimateResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys.join(",") !== "accepted,estimateUrl,metaEvent") return null;
    if (value.accepted !== true || !isAllowedEstimateUrl(value.estimateUrl)) return null;
    if (value.metaEvent !== null) {
      var metaEvent = parseMetaEvent(value.metaEvent);
      if (!metaEvent) return null;
      return {estimateUrl: value.estimateUrl, metaEvent: metaEvent};
    }
    return {estimateUrl: value.estimateUrl, metaEvent: null};
  }

  async function trackCanonicalMetaEvent(metaEvent) {
    if (!metaEvent) return;
    var tracker = window.AllSeasonMeta;
    if (!tracker) return;
    try {
      if (typeof tracker.trackConversionBeforeNavigation === "function") {
        await tracker.trackConversionBeforeNavigation(metaEvent);
      } else if (typeof tracker.trackConversion === "function") {
        tracker.trackConversion(metaEvent);
      }
    } catch {
      // Meta is intentionally nonblocking for customer intake.
    }
  }

  window.AllSeasonCanonicalEstimate = {parse: parseCanonicalEstimateResponse};

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector(".nav-toggle");
    var mainNav = document.querySelector(".main-nav");
    if (toggle && mainNav) {
      toggle.addEventListener("click", function () {
        var open = mainNav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
      mainNav.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
          mainNav.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
        });
      });
    }

    document.querySelectorAll(".faq-item").forEach(function (item) {
      var button = item.querySelector(".faq-q");
      if (!button) return;
      button.addEventListener("click", function () {
        var open = item.classList.toggle("open");
        button.setAttribute("aria-expanded", String(open));
      });
    });

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var reveals = document.querySelectorAll(".reveal");
    if (reduced || !("IntersectionObserver" in window)) {
      reveals.forEach(function (element) { element.classList.add("is-visible"); });
    } else {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      }, {threshold: 0.12});
      reveals.forEach(function (element) { observer.observe(element); });
    }

    var form = document.getElementById("leadForm");
    if (form) {
      var submissionId = window.crypto.randomUUID();
      var intentSignaled = false;
      form.addEventListener("change", function () {
        var propertyConsent = form.elements.namedItem("consent_to_process_property");
        var contactConsent = form.elements.namedItem("consent_to_contact");
        if (intentSignaled || !propertyConsent || !contactConsent || !propertyConsent.checked || !contactConsent.checked) return;
        intentSignaled = true;
        var tracker = window.AllSeasonMeta;
        if (tracker && typeof tracker.trackConversion === "function") {
          tracker.trackConversion({name: "Lead", eventId: submissionId, issuedAt: new Date().toISOString()});
        }
      });
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        var submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        var data = new FormData(form);
        var params = new URLSearchParams(window.location.search);
        var line1 = String(data.get("address_line_1") || "").trim();
        var line2 = String(data.get("address_line_2") || "").trim();
        var city = String(data.get("city") || "").trim();
        var state = String(data.get("state") || "NJ").trim();
        var postalCode = String(data.get("postal_code") || "").trim();
        var attribution = {};
        ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"]
          .forEach(function (key) { attribution[key] = params.get(key); });
        var body = Object.assign({
          submission_id: submissionId,
          campaign: null,
          presentation_key: String(form.dataset.presentationKey || ""),
          entry_point: String(form.dataset.entryPoint || ""),
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim(),
          phone: String(data.get("phone") || "").trim(),
          address: [line1, line2, city, state + " " + postalCode].filter(Boolean).join(", "),
          google_place_id: null,
          address_line_1: line1,
          address_line_2: line2 || null,
          city: city,
          state: state,
          postal_code: postalCode,
          consent_to_contact: data.get("consent_to_contact") === "on",
          consent_to_process_property: data.get("consent_to_process_property") === "on",
        }, attribution);

        try {
          var response = await window.fetch("/api/campaign-estimate", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(body),
            credentials: "same-origin",
          });
          var payload = await response.json().catch(function () { return {}; });
          var estimate = parseCanonicalEstimateResponse(payload);
          if (!response.ok || !estimate) throw new Error(String(response.status));
          await trackCanonicalMetaEvent(estimate.metaEvent);
          window.location.assign(estimate.estimateUrl);
        } catch {
          var message = form.querySelector("[data-submit-error]");
          if (!message) {
            message = document.createElement("p");
            message.dataset.submitError = "true";
            message.setAttribute("role", "alert");
            form.appendChild(message);
          }
          message.textContent = "We could not start your estimate. Call (888) 832-5050 or try again.";
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }

    var checklist = document.querySelector("[data-readiness-checklist]");
    if (checklist) {
      var boxes = Array.from(checklist.querySelectorAll('input[type="checkbox"]'));
      var result = document.querySelector("[data-checklist-result]");
      function updateChecklist() {
        var count = boxes.filter(function (box) { return box.checked; }).length;
        if (result) {
          result.textContent = count === 7
            ? "You have reviewed all seven areas. Bring your notes to a contractor conversation."
            : count + " of 7 areas reviewed. Keep going at your own pace.";
        }
        try {
          localStorage.setItem("as-readiness", JSON.stringify(boxes.map(function (box) {
            return box.checked;
          })));
        } catch {}
      }
      try {
        var saved = JSON.parse(localStorage.getItem("as-readiness"));
        if (Array.isArray(saved)) {
          boxes.forEach(function (box, index) { box.checked = Boolean(saved[index]); });
        }
      } catch {}
      boxes.forEach(function (box) { box.addEventListener("change", updateChecklist); });
      updateChecklist();
      var reset = document.querySelector("[data-checklist-reset]");
      if (reset) reset.addEventListener("click", function () {
        boxes.forEach(function (box) { box.checked = false; });
        updateChecklist();
      });
      var print = document.querySelector("[data-checklist-print]");
      if (print) print.addEventListener("click", function () { window.print(); });
    }

    var reviewsSection = document.querySelector("[data-google-reviews]");
    if (reviewsSection) {
      var reviewsTrack = reviewsSection.querySelector("[data-google-reviews-track]");
      var reviewsViewport = reviewsSection.querySelector("[data-google-reviews-viewport]");
      var reviewsFallback = reviewsSection.querySelector("[data-google-reviews-fallback]");
      var reviewsLink = reviewsSection.querySelector("[data-google-reviews-link]");
      var ratingLabel = reviewsSection.querySelector("[data-google-rating]");
      var reviewsAttributions = reviewsSection.querySelector("[data-google-attributions]");
      function safeReviewUrl(value, fallback) {
        try {
          var url = new URL(value);
          return url.protocol === "https:" ? url.href : fallback;
        } catch {
          return fallback;
        }
      }
      function renderAttributions(attributions) {
        if (!reviewsAttributions) return;
        reviewsAttributions.textContent = "";
        if (!Array.isArray(attributions)) return;
        attributions.forEach(function (attribution) {
          var label = String(attribution.provider || "").trim();
          if (!label) return;
          var href = safeReviewUrl(attribution.providerUri, "");
          var node = href ? document.createElement("a") : document.createElement("span");
          if (href) {
            node.href = href;
            node.target = "_blank";
            node.rel = "noopener";
          }
          node.textContent = label;
          reviewsAttributions.appendChild(node);
        });
      }
      function makeReviewCard(review, fallbackUrl) {
        var card = document.createElement("article");
        card.className = "google-review-card";
        var avatar = document.createElement("span");
        avatar.className = "review-avatar";
        if (review.photoUri) {
          var photo = document.createElement("img");
          photo.src = safeReviewUrl(review.photoUri, "");
          photo.alt = "";
          photo.loading = "lazy";
          photo.referrerPolicy = "no-referrer";
          avatar.appendChild(photo);
        } else {
          avatar.textContent = String(review.author || "G").slice(0, 1).toUpperCase();
        }
        var body = document.createElement("div");
        body.className = "review-body";
        var meta = document.createElement("div");
        meta.className = "review-meta";
        var authorLink = document.createElement("a");
        authorLink.href = safeReviewUrl(review.authorUri, fallbackUrl);
        authorLink.target = "_blank";
        authorLink.rel = "noopener";
        authorLink.setAttribute("aria-label", "View " + review.author + "’s Google profile");
        var author = document.createElement("strong");
        author.textContent = review.author;
        authorLink.appendChild(author);
        var when = document.createElement("span");
        when.textContent = review.relativeTime || "";
        var score = Math.max(0, Math.min(5, Number(review.rating) || 0));
        var stars = document.createElement("span");
        stars.className = "review-card-stars";
        stars.setAttribute("aria-label", score + " out of 5 stars");
        stars.textContent = "★".repeat(score) + "☆".repeat(5 - score);
        var quote = document.createElement("p");
        quote.textContent = review.text;
        var sourceLink = document.createElement("a");
        sourceLink.className = "text-link";
        sourceLink.href = safeReviewUrl(review.reviewUri, fallbackUrl);
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener";
        sourceLink.textContent = "Read this review on Google Maps →";
        meta.append(authorLink, when);
        body.append(meta, stars, quote, sourceLink);
        card.append(avatar, body);
        return card;
      }
      fetch("/api/google-reviews", {headers: {accept: "application/json"}})
        .then(function (response) {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        })
        .then(function (data) {
          var googleUrl = safeReviewUrl(data.googleMapsUri, reviewsLink ? reviewsLink.href : window.location.href);
          if (reviewsLink) reviewsLink.href = googleUrl;
          if (ratingLabel && data.rating) {
            ratingLabel.textContent = Number(data.rating).toFixed(1)
              + " from " + Number(data.reviewCount || 0).toLocaleString() + " Google reviews";
          }
          renderAttributions(data.attributions);
          if (!reviewsTrack || !reviewsViewport || !Array.isArray(data.reviews) || !data.reviews.length) return;
          var cards = data.reviews.map(function (review) { return makeReviewCard(review, googleUrl); });
          var duplicates = reduced ? [] : data.reviews.map(function (review) {
            var duplicate = makeReviewCard(review, googleUrl);
            duplicate.setAttribute("aria-hidden", "true");
            duplicate.querySelectorAll("a").forEach(function (link) { link.tabIndex = -1; });
            return duplicate;
          });
          cards.concat(duplicates).forEach(function (card) { reviewsTrack.appendChild(card); });
          reviewsViewport.hidden = false;
          if (reviewsFallback) reviewsFallback.hidden = true;
        })
        .catch(function () {
          if (reviewsFallback) reviewsFallback.hidden = false;
        });
    }

    if (!document.querySelector("script[data-all-season-quote]")) {
      var quoteScript = document.createElement("script");
      quoteScript.src = "/quote-drawer.js";
      quoteScript.defer = true;
      quoteScript.dataset.allSeasonQuote = "true";
      document.body.appendChild(quoteScript);
    }
  });
})();
