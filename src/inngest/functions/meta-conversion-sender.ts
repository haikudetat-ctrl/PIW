import "server-only";
import {inngest, metaDeliveryRequested} from "@/inngest/client";
import {parseServerEnv} from "@/lib/env/server";
import {MetaConversionClient, type MetaDeliveryResult} from "@/modules/marketing/meta-conversions";
import {SupabaseMetaRepository} from "@/modules/marketing/meta-repository";
import type {MetaDeliverySource} from "@/modules/marketing/meta-events";

export interface MetaConversionDeliveryRepository {
  claim(deliveryId: string): Promise<MetaDeliverySource | null>;
  complete(deliveryId: string, result: MetaDeliveryResult): Promise<void>;
}

export interface MetaConversionDeliveryClient {
  send(source: MetaDeliverySource): Promise<MetaDeliveryResult>;
}

export type MetaConversionDeliveryDependencies = {
  repository: MetaConversionDeliveryRepository;
  client: MetaConversionDeliveryClient;
};

export class MetaConversionRetryableError extends Error {
  constructor(deliveryId: string) {
    super(`Meta conversion delivery requires retry: ${deliveryId}`);
    this.name = "MetaConversionRetryableError";
  }
}

export async function sendMetaConversionDelivery(
  input: {deliveryId: string},
  dependencies: MetaConversionDeliveryDependencies,
) {
  const source = await dependencies.repository.claim(input.deliveryId);
  if (!source) return {outcome: "noop" as const, deliveryId: input.deliveryId};

  const result = await dependencies.client.send(source);
  await dependencies.repository.complete(source.deliveryId, result);

  if (result.outcome === "retryable_failed") {
    throw new MetaConversionRetryableError(source.deliveryId);
  }

  return {outcome: result.outcome, deliveryId: source.deliveryId};
}

type InngestLike = Pick<typeof inngest, "createFunction">;
type RuntimeFactory = () => MetaConversionDeliveryDependencies | null;

function productionRuntime(): MetaConversionDeliveryDependencies | null {
  const environment = parseServerEnv(process.env);
  if (!environment.META_TRACKING_ENABLED) return null;

  return {
    repository: new SupabaseMetaRepository(),
    client: new MetaConversionClient({
      pixelId: environment.META_PIXEL_ID ?? "",
      accessToken: environment.META_CAPI_ACCESS_TOKEN ?? "",
      graphApiVersion: environment.META_GRAPH_API_VERSION ?? "",
      testEventCode: environment.META_TEST_EVENT_CODE,
    }),
  };
}

export function createMetaConversionSender(
  client: InngestLike,
  getRuntime: RuntimeFactory = productionRuntime,
) {
  return client.createFunction(
    {
      id: "meta-conversion-sender",
      name: "Meta conversion sender",
      retries: 3,
      triggers: {event: metaDeliveryRequested},
    },
    async ({event, step}) => step.run("send-meta-conversion", async () => {
      const runtime = getRuntime();
      const deliveryId = event.data.deliveryId;
      if (!runtime) return {outcome: "disabled" as const, deliveryId};
      return sendMetaConversionDelivery({deliveryId}, runtime);
    }),
  );
}

export const metaConversionSender = createMetaConversionSender(inngest);
