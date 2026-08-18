(function () {
  'use strict';

  var API_URL = '/api/intake';
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
    identity.appendChild(element('span', 'as-quote-kicker', 'Free project review'));
    var title = element('h2', 'as-quote-title', 'Plan your roof or solar project.');
    title.id = 'all-season-quote-title';
    identity.appendChild(title);
    identity.appendChild(element('p', 'as-quote-intro', 'Share a few details. Our New Jersey team will review the right next step.'));
    var close = element('button', 'as-quote-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close quote form');
    header.appendChild(identity);
    header.appendChild(close);

    var form = element('form', 'as-quote-form');
    form.noValidate = true;
    var projectWrap = element('fieldset', 'as-quote-project');
    var projectLegend = element('legend', 'as-quote-label', 'What can we help with?');
    projectWrap.appendChild(projectLegend);
    [['roofing', 'Roofing'], ['solar', 'Solar'], ['both', 'Both']].forEach(function (option, index) {
      var optionLabel = element('label', 'as-quote-choice');
      var radio = element('input');
      radio.type = 'radio';
      radio.name = 'project_interest';
      radio.value = option[0];
      radio.required = true;
      if (index === 0) radio.checked = true;
      optionLabel.appendChild(radio);
      optionLabel.appendChild(element('span', '', option[1]));
      projectWrap.appendChild(optionLabel);
    });

    var name = field('as-quote-name', 'Name', 'text', 'name', 'Your name');
    var email = field('as-quote-email', 'Email', 'email', 'email', 'you@example.com');
    var phone = field('as-quote-phone', 'Phone', 'tel', 'tel', '(201) 555-0123');
    var address = field('as-quote-address', 'Project address', 'text', 'street-address', 'Street address, city, ZIP');
    phone.input.inputMode = 'tel';
    address.input.minLength = 5;

    var fields = [name, email, phone, address];
    form.appendChild(projectWrap);
    fields.forEach(function (item) { form.appendChild(item.wrap); });

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
    var submit = element('button', 'as-quote-submit', 'Get my free quote');
    submit.type = 'submit';
    form.appendChild(status);
    form.appendChild(submit);
    form.appendChild(element('p', 'as-quote-privacy', 'Your details are used only to respond to this request.'));

    var success = element('div', 'as-quote-success');
    success.hidden = true;
    success.appendChild(element('span', 'as-quote-success-mark', 'Received'));
    success.appendChild(element('h3', '', 'Your request is with our team.'));
    success.appendChild(element('p', '', 'An All Season specialist will review your project details and contact you about the next step.'));
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
        if (!item.input.value.trim()) message = 'This field is required.';
        else if (item.input.type === 'email' && !item.input.validity.valid) message = 'Enter a valid email address.';
        else if (item.input === phone.input && item.input.value.replace(/\D/g, '').length < 7) message = 'Enter a valid phone number.';
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
      var body = {
        submission_id: submissionId,
        name: name.input.value.trim(),
        email: email.input.value.trim(),
        phone: phone.input.value.trim(),
        address: address.input.value.trim(),
        project_interest: new FormData(form).get('project_interest'),
        consent_to_contact: consent.checked,
        consent_to_process_property: processingConsent.checked,
        fbclid: params.get('fbclid')
      };
      try {
        var response = await window.fetch(API_URL, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error(String(response.status));
        form.hidden = true;
        success.hidden = false;
        try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
        track('quote_form_success', {trigger: root.dataset.trigger});
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
