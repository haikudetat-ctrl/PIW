export type ProviderCapability =
  | "address.validate"
  | "parcel.lookup"
  | "permits.search"
  | "imagery.retrieve"
  | "elevation.retrieve"
  | "roof.measurement";

export type ProviderRequestContext = {
  companyId: string;
  pipelineRunId: string;
  correlationId: string;
  requestKey: string;
  deploymentEnvironment: "development" | "test" | "preview" | "production";
};

export type ProviderResult<T> = {
  value: T;
  provider: string;
  sourceIdentifier: string;
  retrievedAt: string;
  estimatedCostMicros: number;
  actualCostMicros?: number;
  rawArtifactId?: string;
};

export interface ProviderAdapter<I, O> {
  id: string;
  capability: ProviderCapability;
  priority: number;
  paid: boolean;
  enabled: boolean;
  execute(input: I, context: ProviderRequestContext): Promise<ProviderResult<O>>;
}
