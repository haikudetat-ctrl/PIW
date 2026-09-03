import "server-only";
import {inngest, metaDeliveryRequested} from "@/inngest/client";
import {SupabaseMetaRepository} from "@/modules/marketing/meta-repository";

const META_DELIVERY_BATCH_SIZE = 50;

export type MetaDeliveryRequestedEvent = {
  name: "marketing/meta.delivery.requested";
  data: {deliveryId: string};
};

export interface MetaConversionSweepRepository {
  listPending(limit: number): Promise<string[]>;
}

export type MetaConversionSweepSender = (
  events: MetaDeliveryRequestedEvent[],
) => Promise<unknown>;

export async function sweepMetaConversionDeliveries({
  repository,
  send,
}: {
  repository: MetaConversionSweepRepository;
  send: MetaConversionSweepSender;
}) {
  const deliveryIds = await repository.listPending(META_DELIVERY_BATCH_SIZE);
  if (!deliveryIds.length) return {republished: 0};

  await send(deliveryIds.map((deliveryId) => ({
    name: "marketing/meta.delivery.requested" as const,
    data: {deliveryId},
  })));
  return {republished: deliveryIds.length};
}

type InngestLike = Pick<typeof inngest, "createFunction" | "send">;

export function createMetaConversionSweeper(
  client: InngestLike,
  repository?: MetaConversionSweepRepository,
) {
  return client.createFunction(
    {
      id: "meta-conversion-sweeper",
      name: "Meta conversion recovery sweep",
      triggers: {cron: "*/5 * * * *"},
    },
    async ({step}) => step.run("republish-pending-meta-conversions", () =>
      sweepMetaConversionDeliveries({
        repository: repository ?? new SupabaseMetaRepository(),
        send: (events) => client.send(events),
      }),
    ),
  );
}

export const metaConversionSweeper = createMetaConversionSweeper(inngest);
