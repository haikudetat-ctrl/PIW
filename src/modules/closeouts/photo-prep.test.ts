// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { JobNimbusProviderError } from "@/modules/jobnimbus/client";
import {
  choosePhotoCandidates,
  MAX_PHOTOS_PER_CLOSEOUT,
  prepareCloseoutPhotoBatch,
  resizeWithSharp,
  type JobPhotoCandidate,
  type PhotoPrepDependencies,
  type PreparedPhotoRow,
} from "./photo-prep";

const closeout = { id: "closeout-1", companyId: "company-1", jobJnid: "job-1", deliveredAt: "2026-11-17T17:00:00Z" };

function candidate(index: number, overrides: Partial<JobPhotoCandidate> = {}): JobPhotoCandidate {
  return {
    fileJnid: `file-${index}`,
    filename: `IMG_${index}.jpg`,
    contentType: "image/jpeg",
    takenAt: `2026-11-18T${String(10 + (index % 10)).padStart(2, "0")}:00:00Z`,
    uploadedAt: "2026-11-19T12:00:00Z",
    ...overrides,
  };
}

function fakeDependencies(candidates: JobPhotoCandidate[], options: { download?: PhotoPrepDependencies["download"] } = {}) {
  const recorded: PreparedPhotoRow[] = [];
  const uploads: string[] = [];
  const dependencies: PhotoPrepDependencies = {
    listCandidates: async () => candidates,
    listPreparedFileJnids: async () => new Set(recorded.map((row) => row.fileJnid)),
    download: options.download ?? (async () => new Uint8Array([1, 2, 3])),
    resize: async () => ({ thumb: new Uint8Array([1]), print: new Uint8Array([2]), width: 1400, height: 1050 }),
    upload: async (path) => {
      uploads.push(path);
    },
    recordPhoto: async (row) => {
      recorded.push(row);
    },
  };
  return { dependencies, recorded, uploads };
}

describe("prepareCloseoutPhotoBatch", () => {
  it("works through photos in bounded, repeatable batches", async () => {
    const { dependencies, recorded, uploads } = fakeDependencies(Array.from({ length: 5 }, (_, index) => candidate(index)));

    const first = await prepareCloseoutPhotoBatch(closeout, dependencies, 3);
    expect(first).toEqual({ done: false, processed: 3, ready: 3, remaining: 2 });
    const second = await prepareCloseoutPhotoBatch(closeout, dependencies, 3);
    expect(second).toEqual({ done: true, processed: 2, ready: 2, remaining: 0 });
    const again = await prepareCloseoutPhotoBatch(closeout, dependencies, 3);
    expect(again).toEqual({ done: true, processed: 0, ready: 0, remaining: 0 });

    expect(recorded).toHaveLength(5);
    expect(uploads[0]).toBe("company-1/closeout-1/photos/file-0-thumb.webp");
    expect(uploads[1]).toBe("company-1/closeout-1/photos/file-0-print.jpg");
  });

  it("lists HEIC photos without downloading them", async () => {
    let downloads = 0;
    const { dependencies, recorded } = fakeDependencies([candidate(1, { contentType: "image/heic" })], {
      download: async () => {
        downloads += 1;
        return new Uint8Array();
      },
    });

    await prepareCloseoutPhotoBatch(closeout, dependencies);
    expect(downloads).toBe(0);
    expect(recorded[0]).toMatchObject({ fileJnid: "file-1", outcome: "unsupported", thumbPath: null });
  });

  it("records a photo JobNimbus refuses, and rethrows a transient failure for retry", async () => {
    const refused = fakeDependencies([candidate(1), candidate(2)], {
      download: async (jnid) => {
        if (jnid === "file-1") throw new JobNimbusProviderError("gone", { terminal: true, status: 404, code: "http" });
        return new Uint8Array([1]);
      },
    });
    await prepareCloseoutPhotoBatch(closeout, refused.dependencies);
    expect(refused.recorded.map((row) => row.outcome)).toEqual(["failed", "ready"]);

    const flaky = fakeDependencies([candidate(1)], {
      download: async () => {
        throw new JobNimbusProviderError("rate limited", { terminal: false, status: 429, code: "http" });
      },
    });
    await expect(prepareCloseoutPhotoBatch(closeout, flaky.dependencies)).rejects.toThrow("rate limited");
    expect(flaky.recorded).toHaveLength(0);
  });

  it("caps a job's photos and keeps them in the order they were taken", () => {
    const many = Array.from({ length: MAX_PHOTOS_PER_CLOSEOUT + 30 }, (_, index) =>
      candidate(index, { takenAt: new Date(Date.UTC(2026, 10, 18, 0, MAX_PHOTOS_PER_CLOSEOUT + 30 - index)).toISOString() }),
    );
    const chosen = choosePhotoCandidates(many);
    expect(chosen).toHaveLength(MAX_PHOTOS_PER_CLOSEOUT);
    expect(chosen[0].fileJnid).toBe(`file-${MAX_PHOTOS_PER_CLOSEOUT + 29}`);
  });
});

describe("resizeWithSharp", () => {
  it("rotates upright, shrinks, and drops EXIF including location", async () => {
    // A 400×200 landscape photo the phone stored sideways (orientation 6).
    const original = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#7a8b6c" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "crew phone" }, IFD3: { GPSLatitudeRef: "N" } } })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const resized = await resizeWithSharp(new Uint8Array(original));

    const print = await sharp(resized.print).metadata();
    expect(print.exif).toBeUndefined();
    expect([print.width, print.height]).toEqual([200, 400]);
    expect([resized.width, resized.height]).toEqual([200, 400]);
    const thumb = await sharp(resized.thumb).metadata();
    expect(thumb.format).toBe("webp");
    expect(thumb.exif).toBeUndefined();
  });
});
