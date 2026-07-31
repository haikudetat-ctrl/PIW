"use client";

import { useEffect, useRef, useState } from "react";

type Prediction = {
  placeId: string;
  text: { toString(): string } | string;
};

type AutocompleteElement = HTMLElement & {
  includedRegionCodes: string[];
  locationBias: { center: { lat: number; lng: number }; radius: number };
  placeholder: string;
};

type GoogleMapsWindow = Window & {
  google?: { maps: { importLibrary(name: string): Promise<{ PlaceAutocompleteElement: new () => AutocompleteElement }> } };
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
  const container = useRef<HTMLDivElement>(null);
  const selectHandler = useRef(onSelect);
  const errorHandler = useRef(onLoadError);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    selectHandler.current = onSelect;
    errorHandler.current = onLoadError;
  }, [onLoadError, onSelect]);

  useEffect(() => {
    let active = true;
    let element: AutocompleteElement | undefined;
    async function mount() {
      try {
        await loadGoogleMaps(apiKey);
        const browser = window as GoogleMapsWindow;
        const library = await browser.google!.maps.importLibrary("places");
        if (!active || !container.current) return;
        element = new library.PlaceAutocompleteElement();
        element.placeholder = "Start typing the property address";
        element.includedRegionCodes = ["us"];
        element.locationBias = { center: { lat: 40.0583, lng: -74.4057 }, radius: 160_000 };
        element.className = "block min-h-12 w-full rounded-lg border border-border bg-surface text-ink";
        element.addEventListener("gmp-select", ((event: Event & { placePrediction?: Prediction }) => {
          const prediction = event.placePrediction;
          if (!prediction?.placeId) return;
          selectHandler.current({ placeId: prediction.placeId, address: String(prediction.text) });
        }) as EventListener);
        container.current.replaceChildren(element);
        setLoading(false);
      } catch {
        if (active) errorHandler.current();
      }
    }
    void mount();
    return () => {
      active = false;
      element?.remove();
    };
  }, [apiKey]);

  return (
    <label className={labelClasses}>
      Property address
      <div ref={container} className="min-h-12">
        {loading ? <div className="min-h-12 animate-pulse rounded-lg border border-border bg-surface-muted" aria-label="Loading Google address search" /> : null}
      </div>
      <span className="font-normal text-ink-subtle">Select the exact property from Google’s suggestions.</span>
    </label>
  );
}

const labelClasses = "grid gap-2 text-sm font-medium text-ink";
