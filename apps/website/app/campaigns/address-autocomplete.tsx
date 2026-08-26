"use client";

import {useEffect, useRef, useState} from "react";

type Suggestion = {placeId: string; address: string};

export function AddressAutocomplete({
  onSelect,
  onUnavailable,
}: {
  onSelect(value: Suggestion): void;
  onUnavailable(): void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);
  const selectedQuery = useRef("");

  useEffect(() => {
    if (query.trim().length < 3 || query === selectedQuery.current) return;
    const currentRequest = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch("/api/address-autocomplete", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({input: query.trim()}),
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status >= 500) onUnavailable();
          return;
        }
        const payload = await response.json() as {suggestions?: Suggestion[]};
        if (currentRequest === requestId.current) {
          setSuggestions(payload.suggestions ?? []);
        }
      } catch {
        onUnavailable();
      } finally {
        if (currentRequest === requestId.current) setSearching(false);
      }
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [onUnavailable, query]);

  return (
    <label className="campaign-field campaign-address-search">
      <span>Property address</span>
      <div className="campaign-combobox">
        <input
          value={query}
          onChange={(event) => {
            selectedQuery.current = "";
            setQuery(event.target.value);
            setSuggestions([]);
            setSearching(false);
            onSelect({placeId: "", address: ""});
          }}
          placeholder="Start typing your New Jersey address"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls="campaign-address-suggestions"
        />
        {searching ? <span className="campaign-searching">Finding your address…</span> : null}
        {suggestions.length > 0 ? (
          <ul id="campaign-address-suggestions" role="listbox">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId} role="option" aria-selected="false">
                <button type="button" onClick={() => {
                  selectedQuery.current = suggestion.address;
                  setQuery(suggestion.address);
                  setSuggestions([]);
                  onSelect(suggestion);
                }}>
                  {suggestion.address}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <small>Choose your home from the list so we start with the right property.</small>
    </label>
  );
}
