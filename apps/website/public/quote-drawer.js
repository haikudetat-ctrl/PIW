(function () {
  'use strict';

  var API_URL = '/api/campaign-estimate';
  var DISMISSED_KEY = 'all-season-quote-drawer-dismissed-v1';
  var DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;
  var root;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function field(id, labelText, type, autocomplete, placeholder) {
    var wrap = element('div', 'as-quote-field');
    var label = element('label', 'as-quote-label', labelText);
    label.htmlFor = id;
    var input = element('input', 'as-quote-input');
    input.id = id;
    input.name = id.replace('as-quote-', '');
    input.type = type;
    input.autocomplete = autocomplete;
    input.placeholder = placeholder;
    input.required = true;
    var error = element('span', 'as-quote-error');
    error.id = id + '-error';
    input.setAttribute('aria-describedby', error.id);
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(error);
    return {wrap: wrap, input: input, error: error};
  }

  function ensureStylesheet() {
    if (document.querySelector('link[data-all-season-quote]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/quote-drawer.css';
    link.dataset.allSeasonQuote = 'true';
    document.head.appendChild(link);
  }

  function track(name, detail) {
    var payload = Object.assign({event: name, page_path: window.location.pathname}, detail || {});
    window.dispatchEvent(new CustomEvent('allseason:' + name, {detail: payload}));
    if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
  }

  function parseCanonicalEstimateResponse(payload) {
    var parser = window.AllSeasonCanonicalEstimate;
    if (!parser || typeof parser.parse !== 'function') return null;
    return parser.parse(payload);
  }

  function trackCanonicalMetaEvent(metaEvent) {
    if (!metaEvent) return;
    var tracker = window.AllSeasonMeta;
    if (!tracker || typeof tracker.trackConversion !== 'function') return;
    try {
      tracker.trackConversion(metaEvent);
    } catch {
      // Meta is intentionally nonblocking for customer intake.
    }
  }

  function autoOpenAllowed() {
    try {
      var dismissedAt = Number(window.localStorage.getItem(DISMISSED_KEY));
      return !dismissedAt || Date.now() - dismissedAt > DISMISS_FOR_MS;
    } catch {
      return true;
    }
  }

  function build() {
    if (root || document.querySelector('.as-quote-root')) return;
    ensureStylesheet();

    var previousFocus = null;
    var submitting = false;
    var started = false;
    var autoTriggered = false;
    var submissionId = window.crypto.randomUUID();

    root = element('div', 'as-quote-root');
    root.dataset.state = 'closed';

    var launcher = element('button', 'as-quote-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open the free quote form');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'all-season-quote-drawer');
    var mark = element('img', 'as-quote-launcher-mark');
    mark.src = '/assets/all-season-sun.svg';
    mark.alt = '';
    mark.width = 72;
    mark.height = 72;
    launcher.appendChild(mark);

    var panel = element('section', 'as-quote-panel');
    panel.id = 'all-season-quote-drawer';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'all-season-quote-title');

    var header = element('header', 'as-quote-header');
    var identity = element('div', 'as-quote-identity');
    identity.appendChild(element('span', 'as-quote-kicker', 'Free roof review'));
    var title = element('h2', 'as-quote-title', 'Start with a clear plan for your roof.');
    title.id = 'all-season-quote-title';
    identity.appendChild(title);
    identity.appendChild(element('p', 'as-quote-intro', 'Share a few details. Our New Jersey team will review the roof first and coordinate solar only when it fits.'));
    var close = element('button', 'as-quote-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close quote form');
    header.appendChild(identity);
    header.appendChild(close);

    var form = element('form', 'as-quote-form');
    form.noValidate = true;
    var name = field('as-quote-name', 'Full name', 'text', 'name', 'Your name');
    var email = field('as-quote-email', 'Email', 'email', 'email', 'you@example.com');
    var phone = field('as-quote-phone', 'Mobile phone', 'tel', 'tel', '(201) 555-0123');
    var addressLine1 = field('as-quote-address_line_1', 'Home address', 'text', 'address-line1', 'Street address');
    var addressLine2 = field('as-quote-address_line_2', 'Apartment, suite, or unit (optional)', 'text', 'address-line2', 'Unit 2');
    var city = field('as-quote-city', 'City', 'text', 'address-level2', 'Newark');
    var postalCode = field('as-quote-postal_code', 'ZIP code', 'text', 'postal-code', '07102');
    addressLine2.input.required = false;
    phone.input.inputMode = 'tel';
    postalCode.input.inputMode = 'numeric';
    postalCode.input.pattern = '[0-9]{5}(-[0-9]{4})?';

    var state = element('input');
    state.type = 'hidden';
    state.name = 'state';
    state.value = 'NJ';
    var fields = [name, email, phone, addressLine1, addressLine2, city, postalCode];
    fields.forEach(function (item) { form.appendChild(item.wrap); });
    form.appendChild(state);

    var processingConsentLabel = element('label', 'as-quote-consent');
    var processingConsent = element('input');
    processingConsent.type = 'checkbox';
    processingConsent.name = 'consent_to_process_property';
    processingConsent.required = true;
    processingConsentLabel.appendChild(processingConsent);
    processingConsentLabel.appendChild(element('span', '', 'I authorize All Season to process this address through property, mapping, and imagery services to evaluate my project.'));
    form.appendChild(processingConsentLabel);

    var consentLabel = element('label', 'as-quote-consent');
    var consent = element('input');
    consent.type = 'checkbox';
    consent.name = 'consent_to_contact';
    consent.required = true;
    consentLabel.appendChild(consent);
    consentLabel.appendChild(element('span', '', 'I agree to be contacted by All Season Solar by call, text, or email about my request, including by automated means. Consent is not required to make a purchase. Message and data rates may apply.'));
    form.appendChild(consentLabel);

    var status = element('p', 'as-quote-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var submit = element('button', 'as-quote-submit', 'Request my roof plan');
    submit.type = 'submit';
    form.appendChild(status);
    form.appendChild(submit);
    form.appendChild(element('p', 'as-quote-privacy', 'Your details are used only to respond to this request.'));

    var success = element('div', 'as-quote-success');
    success.hidden = true;
    success.appendChild(element('span', 'as-quote-success-mark', 'Received'));
    success.appendChild(element('h3', '', 'Your request is with our team.'));
    success.appendChild(element('p', '', 'An All Season specialist will review your roof and project details, then contact you about the right next step.'));
    var successClose = element('button', 'as-quote-submit', 'Back to the site');
    successClose.type = 'button';
    success.appendChild(successClose);

    panel.appendChild(header);
    panel.appendChild(form);
    panel.appendChild(success);
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    function openDrawer(trigger, focusFirst) {
      if (root.dataset.state === 'open') return;
      previousFocus = document.activeElement;
      panel.hidden = false;
      root.dataset.state = 'open';
      root.dataset.trigger = trigger;
      launcher.setAttribute('aria-expanded', 'true');
      track('quote_form_view', {trigger: trigger});
      if (focusFirst) window.requestAnimationFrame(function () { name.input.focus(); });
    }

    function closeDrawer(reason) {
      if (root.dataset.state !== 'open') return;
      panel.hidden = true;
      root.dataset.state = 'closed';
      launcher.setAttribute('aria-expanded', 'false');
      track('quote_form_close', {reason: reason, trigger: root.dataset.trigger});
      if (reason === 'dismiss') {
        try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
      }
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    }

    function setError(item, message) {
      item.error.textContent = message;
      item.input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function validate() {
      var firstInvalid = null;
      fields.forEach(function (item) {
        var message = '';
        if (item.input.required && !item.input.value.trim()) message = 'This field is required.';
        else if (item.input.type === 'email' && !item.input.validity.valid) message = 'Enter a valid email address.';
        else if (item.input === phone.input && item.input.value.replace(/\D/g, '').length < 7) message = 'Enter a valid phone number.';
        else if (item.input === postalCode.input && !item.input.validity.valid) message = 'Enter a valid ZIP code.';
        setError(item, message);
        if (message && !firstInvalid) firstInvalid = item.input;
      });
      if (!processingConsent.checked || !consent.checked) {
        status.textContent = 'Confirm property processing and contact permission to continue.';
        if (!firstInvalid) firstInvalid = !processingConsent.checked ? processingConsent : consent;
      } else {
        status.textContent = '';
      }
      if (firstInvalid) firstInvalid.focus();
      return !firstInvalid;
    }

    function markStarted() {
      if (started) return;
      started = true;
      track('quote_form_start', {trigger: root.dataset.trigger});
    }

    launcher.addEventListener('click', function () { openDrawer('sun_click', true); });
    close.addEventListener('click', function () { closeDrawer('dismiss'); });
    successClose.addEventListener('click', function () { closeDrawer('success'); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer('dismiss');
    });
    form.addEventListener('input', markStarted, {once: true});
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (submitting || !validate()) return;
      submitting = true;
      submit.disabled = true;
      submit.textContent = 'Sending request';
      status.textContent = 'Securely sending your project details.';
      track('quote_form_submit', {trigger: root.dataset.trigger});
      var params = new URLSearchParams(window.location.search);
      var line1 = addressLine1.input.value.trim();
      var line2 = addressLine2.input.value.trim();
      var locality = 'NJ ' + postalCode.input.value.trim();
      var body = {
        submission_id: submissionId,
        campaign: null,
        presentation_key: 'all-season-main',
        entry_point: 'main-drawer',
        name: name.input.value.trim(),
        email: email.input.value.trim(),
        phone: phone.input.value.trim(),
        address: [line1, line2, city.input.value.trim(), locality].filter(Boolean).join(', '),
        google_place_id: null,
        address_line_1: line1,
        address_line_2: line2 || null,
        city: city.input.value.trim(),
        state: 'NJ',
        postal_code: postalCode.input.value.trim(),
        consent_to_contact: consent.checked,
        consent_to_process_property: processingConsent.checked,
      };
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid'].forEach(function (key) {
        body[key] = params.get(key);
      });
      try {
        var response = await window.fetch(API_URL, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
          credentials: 'same-origin'
        });
        var payload = await response.json().catch(function () { return {}; });
        var estimate = parseCanonicalEstimateResponse(payload);
        if (!response.ok || !estimate) throw new Error(String(response.status));
        try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
        track('quote_form_success', {trigger: root.dataset.trigger});
        trackCanonicalMetaEvent(estimate.metaEvent);
        window.location.assign(estimate.estimateUrl);
      } catch {
        status.textContent = 'We could not send this request. Call (888) 832-5050 or try again.';
        track('quote_form_error', {trigger: root.dataset.trigger});
      } finally {
        submitting = false;
        submit.disabled = false;
        submit.textContent = 'Get my free quote';
      }
    });

    var hero = document.querySelector('.home-hero');
    if (hero && autoOpenAllowed()) {
      var sentinel = element('span', 'as-quote-scroll-sentinel');
      sentinel.setAttribute('aria-hidden', 'true');
      hero.appendChild(sentinel);
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!autoTriggered && entry.isIntersecting) {
              autoTriggered = true;
              observer.disconnect();
              openDrawer('scroll_50', false);
            }
          });
        }, {rootMargin: '0px 0px -95% 0px', threshold: 0});
        observer.observe(sentinel);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, {once: true});
  else build();
})();
