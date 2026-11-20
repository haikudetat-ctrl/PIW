import "server-only";
import { closeoutWorkRequested, inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import { prepareCloseoutPhotoBatch, MAX_PHOTOS_PER_CLOSEOUT, PHOTO_BATCH_SIZE } from "@/modules/closeouts/photo-prep";
import {
  closeoutWriteFromRow,
  createCompanyJobNimbusClient,
  createPhotoPrepDependencies,
  createWritebackDependencies,
  finishPhotoPrep,
  photoCloseoutFromRow,
} from "@/modules/closeouts/runtime";
import { processCloseoutWrite } from "@/modules/closeouts/writeback";

const MAX_BATCHES = Math.ceil(MAX_PHOTOS_PER_CLOSEOUT / PHOTO_BATCH_SIZE);

// Prepares closeout photos and files submitted closeouts to JobNimbus. A
// manager's action sends an event so work starts right away; the sweep
// catches anything an event missed or a failure left queued.
export const jobCloseoutWorker = inngest.createFunction(
  {
    id: "job-closeout-worker",
    name: "Job closeout worker",
    triggers: [{ event: closeoutWorkRequested }, { cron: "TZ=America/New_York 7-59/10 * * * *" }],
    // One run at a time. With the warehouse sync that is at most two
    // JobNimbus clients, the observed safe ceiling.
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const photoWork = await step.run("claim-photo-prep", async () => {
      const { data, error } = await createServiceClient().rpc("claim_job_closeout_photo_prep", { p_limit: 3 });
      if (error) throw new Error("Closeout photo claim failed");
      return (data ?? []).map(photoCloseoutFromRow);
    });

    const photoOutcomes: Record<string, string> = {};
    for (const closeout of photoWork) {
      try {
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          const result = await step.run(`photos-${closeout.id}-${batch}`, async () => {
            const database = createServiceClient();
            const client = await createCompanyJobNimbusClient(database, closeout.companyId, process.env);
            return prepareCloseoutPhotoBatch(closeout, createPhotoPrepDependencies(database, client));
          });
          if (result.done) break;
        }
        await step.run(`photos-${closeout.id}-ready`, () => finishPhotoPrep(createServiceClient(), closeout.id, "ready"));
        photoOutcomes[closeout.id] = "ready";
      } catch (error) {
        // One job's photos must not hold up the others. The claim retries a
        // failed closeout twice more before the package goes without photos.
        await step.run(`photos-${closeout.id}-failed`, () =>
          finishPhotoPrep(
            createServiceClient(),
            closeout.id,
            "failed",
            error instanceof Error ? error.message : "Photo preparation failed",
          ));
        photoOutcomes[closeout.id] = "failed";
      }
    }

    // The status write is only claimable once its package is attached, so a
    // second pass picks it up in the same run.
    const writeOutcomes: Record<string, string> = {};
    for (const pass of [1, 2]) {
      const writes = await step.run(`claim-writes-${pass}`, async () => {
        const { data, error } = await createServiceClient().rpc("claim_job_closeout_writes", { p_limit: 5 });
        if (error) throw new Error("Closeout write claim failed");
        return (data ?? []).map(closeoutWriteFromRow);
      });
      for (const write of writes) {
        writeOutcomes[write.id] = await step.run(`write-${write.id}-${write.attempts}`, () =>
          processCloseoutWrite(write, createWritebackDependencies(createServiceClient(), process.env)));
      }
      if (!writes.some((write) => write.kind === "attach_package" && writeOutcomes[write.id] === "succeeded")) break;
    }

    return { photos: photoOutcomes, writes: writeOutcomes };
  },
);
