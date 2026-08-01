"use client";

import { useEffect, useRef, useState } from "react";
import { inputClasses } from "@/components/ui/form";

type PlacePrediction = {
  placeId: string;
  text: { toString(): string } | string;
};

type AutocompleteSuggestion = { placePrediction?: PlacePrediction };

type PlacesLibrary = {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(input: {
      input: string;
      includedRegionCodes: string[];
      locationBias: { center: { lat: number; lng: number }; radius: number };
      language: string;
      region: string;
      sessionToken: object;
    }): Promise<{ suggestions: AutocompleteSuggestion[] }>;
  };
};

type GoogleMapsWindow = Window & {
  google?: { maps: { importLibrary(name: string): Promise<PlacesLibrary> } };
  __piwGoogleMapsPromise?: Promise<void>;
};

function loadGoogleMaps(apiKey: string) {
  const browser = window as GoogleMapsWindow;
  if (browser.google?.maps) return Promise.resolve();
  if (browser.__piwGoogleMapsPromise) return browser.__piwGoogleMapsPromise;
  browser.__piwGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&v=weekly&region=US&auth_referrer_policy=origin`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return browser.__piwGoogleMapsPromise;
}

export function GoogleAddressAutocomplete({
  apiKey,
  onSelect,
  onLoadError,
}: {
  apiKey: string;
  onSelect(value: { placeId: string; address: string }): void;
  onLoadError(): void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const library = useRef<PlacesLibrary | null>(null);
  const sessionToken = useRef<object | null>(null);
  const selectHandler = useRef(onSelect);
  const errorHandler = useRef(onLoadError);

  useEffect(() => {
    selectHandler.current = onSelect;
    errorHandler.current = onLoadError;
  }, [onLoadError, onSelect]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await loadGoogleMaps(apiKey);
        const browser = window as GoogleMapsWindow;
        const places = await browser.google!.maps.importLibrary("places");
        if (!active) return;
        library.current = places;
        sessionToken.current = new places.AutocompleteSessionToken();
        setLoading(false);
      } catch {
        if (active) errorHandler.current();
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [apiKey]);

  useEffect(() => {
    if (loading || query.trim().length < 3 || !library.current || !sessionToken.current) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { suggestions: matches } =
          await library.current!.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query.trim(),
            includedRegionCodes: ["us"],
            locationBias: {
              center: { lat: 40.0583, lng: -74.4057 },
              radius: 160_000,
            },
            language: "en-US",
            region: "us",
            sessionToken: sessionToken.current!,
          });
        if (!active) return;
        setSuggestions(
          matches
            .map((match) => match.placePrediction)
            .filter((match): match is PlacePrediction => Boolean(match?.placeId)),
        );
      } catch {
        if (active) errorHandler.current();
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [loading, query]);

  function select(prediction: PlacePrediction) {
    const address = String(prediction.text);
    setQuery(address);
    setSuggestions([]);
    selectHandler.current({ placeId: prediction.placeId, address });
    if (library.current) {
      sessionToken.current = new library.current.AutocompleteSessionToken();
    }
  }

  return (
    <label className={labelClasses}>
      Property address
      {loading ? (
        <div className="min-h-12 animate-pulse rounded-lg border border-border bg-surface-muted" aria-label="Loading Google address search" />
      ) : (
        <div className="relative">
          <input
            className={inputClasses}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              selectHandler.current({ placeId: "", address: "" });
            }}
            placeholder="Start typing the property address"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls="google-address-suggestions"
          />
          {searching ? <span className="mt-2 block text-xs text-ink-subtle">Searching Google…</span> : null}
          {suggestions.length > 0 ? (
            <ul id="google-address-suggestions" role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {suggestions.map((prediction) => {
                const address = String(prediction.text);
                return (
                  <li key={prediction.placeId} role="option" aria-selected="false">
                    <button type="button" className="w-full px-4 py-3 text-left text-sm text-ink hover:bg-surface-muted focus:bg-surface-muted" onClick={() => select(prediction)}>
                      {address}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
      <span className="font-normal text-ink-subtle">Select the exact property from Google’s suggestions.</span>
    </label>
  );
}

const labelClasses = "grid gap-2 text-sm font-medium text-ink";
