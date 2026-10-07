"use client";

import { useEffect, useRef, useState } from "react";

type Suggestion = {placeId: string; address: string};

const SUGGESTIONS_URL = "/api/property-preview/address-suggestions";
const DEBOUNCE_MS = 250;

function newSessionToken() {
  return globalThis.crypto.randomUUID();
}

/**
 * Google address search for the value-first address step. Suggestions come
 * from PIW's server (no browser Maps key), so a Google place ID is the
 * default path; onUnavailable lets the form fall back to manual entry.
 */
export function QuietAddressSearch({
  onSelect,
  onUnavailable,
}: {
  onSelect(value: Suggestion): void;
  onUnavailable(): void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const sessionToken = useRef<string>("");
  const selectedAddress = useRef<string | null>(null);
  const unavailableHandler = useRef(onUnavailable);

  useEffect(() => {
    unavailableHandler.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || trimmed === selectedAddress.current) return;
    if (!sessionToken.current) sessionToken.current = newSessionToken();
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      const params = new URLSearchParams({q: trimmed, session_token: sessionToken.current});
      const response = await fetch(`${SUGGESTIONS_URL}?${params}`, {signal: controller.signal, cache: "no-store"})
        .catch(() => null);
      if (controller.signal.aborted) return;
      setSearching(false);
      const payload = response?.ok
        ? await response.json().catch(() => null) as {suggestions?: Suggestion[]} | null
        : null;
      if (!payload?.suggestions) {
        unavailableHandler.current();
        return;
      }
      setSuggestions(payload.suggestions.filter((item) => item.placeId && item.address));
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  function select(suggestion: Suggestion) {
    selectedAddress.current = suggestion.address;
    setQuery(suggestion.address);
    setSuggestions([]);
    onSelect(suggestion);
    // A Google autocomplete session ends with the selection.
    sessionToken.current = "";
  }

  const open = suggestions.length > 0 && query.trim().length >= 3;
  return (
    <label className="quiet-field">
      Property address
      <div className="quiet-search">
        <input
          className="quiet-input"
          value={query}
          onChange={(event) => {
            selectedAddress.current = null;
            setQuery(event.target.value);
            if (event.target.value.trim().length < 3) setSuggestions([]);
            onSelect({placeId: "", address: ""});
          }}
          placeholder="Start typing the property address"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="quiet-address-suggestions"
        />
        {open ? (
          <ul id="quiet-address-suggestions" role="listbox" className="quiet-suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId} role="option" aria-selected="false">
                <button type="button" className="quiet-suggestion" onClick={() => select(suggestion)}>
                  {suggestion.address}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className="quiet-hint">{searching ? "Searching Google…" : "Select the exact property from Google’s suggestions."}</span>
    </label>
  );
}
