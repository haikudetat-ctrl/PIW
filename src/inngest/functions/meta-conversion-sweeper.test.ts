import {describe, expect, test, vi} from "vitest";
import {
  sweepMetaConversionDeliveries,
  type MetaConversionSweepRepository,
} from "./meta-conversion-sweeper";

describe("Meta conversion sweeper", () => {
  test("republishes pending delivery IDs only", async () => {
    const repository: MetaConversionSweepRepository = {
      listPending: vi.fn(async () => [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]),
    };
    const send = vi.fn(async () => ({ids: ["event-1", "event-2"]}));

    await expect(sweepMetaConversionDeliveries({repository, send})).resolves.toEqual({
      republished: 2,
    });

    expect(repository.listPending).toHaveBeenCalledWith(50);
    expect(send).toHaveBeenCalledWith([
      {
        name: "marketing/meta.delivery.requested",
        data: {deliveryId: "11111111-1111-4111-8111-111111111111"},
      },
      {
        name: "marketing/meta.delivery.requested",
        data: {deliveryId: "22222222-2222-4222-8222-222222222222"},
      },
    ]);
  });

  test("does not publish when the recovery ledger is empty", async () => {
    const repository: MetaConversionSweepRepository = {listPending: vi.fn(async () => [])};
    const send = vi.fn(async () => ({ids: []}));

    await expect(sweepMetaConversionDeliveries({repository, send})).resolves.toEqual({
      republished: 0,
    });

    expect(send).not.toHaveBeenCalled();
  });
});
