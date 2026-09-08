import type {ConsentPreferences} from "./privacy-consent";

const KEY = "allseason-privacy-denials";
const EVENT = "allseason:privacy-denials";

export function privacyDenialSnapshot() {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return `${value?.analytics === true ? "1" : "0"}${value?.advertising === true ? "1" : "0"}`;
  } catch { return "00"; }
}

export function subscribePrivacyDenials(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(EVENT, listener); };
}

export function rememberPrivacyDenials(preferences: Pick<ConsentPreferences, "analytics" | "advertising">, confirmed = false) {
  const previous = privacyDenialSnapshot();
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      analytics: !preferences.analytics || (!confirmed && previous[0] === "1"),
      advertising: !preferences.advertising || (!confirmed && previous[1] === "1"),
    }));
  } catch { /* The in-memory preferences still enforce this decision. */ }
  window.dispatchEvent(new Event(EVENT));
}
