import type { ProviderCapability } from "./contracts";

type ResolvableProvider = {
  id: string;
  capability: ProviderCapability;
  priority: number;
  enabled: boolean;
};

export class ProviderUnavailableError extends Error {
  constructor(capability: ProviderCapability) {
    super(`No enabled provider available for capability "${capability}"`);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderRegistry<T extends ResolvableProvider = ResolvableProvider> {
  constructor(private readonly providers: T[]) {}

  resolve(capability: ProviderCapability): T {
    const candidates = this.providers
      .filter((provider) => provider.capability === capability && provider.enabled)
      .sort((a, b) => a.priority - b.priority);

    const [best] = candidates;
    if (!best) throw new ProviderUnavailableError(capability);
    return best;
  }
}
