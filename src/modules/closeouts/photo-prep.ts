import { JobNimbusProviderError } from "@/modules/jobnimbus/client";

// Crew photos live in JobNimbus at full size with their EXIF, location
// included. A closeout copies the install-window photos once, through the
// same single paced JobNimbus client the sync uses, and stores two resized
// copies: a thumbnail for the form and a print copy for the package.
// Re-encoding drops every bit of metadata.

export const CLOSEOUT_BUCKET = "job-closeouts";
export const PHOTO_BATCH_SIZE = 12;
export const MAX_PHOTOS_PER_CLOSEOUT = 120;

// HEIC needs a decoder the runtime doesn't ship; those photos stay
// in JobNimbus and are listed as not previewable.
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export type PhotoCloseout = {
  id: string;
  companyId: string;
  jobJnid: string;
  deliveredAt: string | null;
};

export type JobPhotoCandidate = {
  fileJnid: string;
  filename: string | null;
  contentType: string | null;
  takenAt: string | null;
  uploadedAt: string | null;
};

export type PreparedPhotoRow = {
  companyId: string;
  closeoutId: string;
  fileJnid: string;
  filename: string | null;
  takenAt: string | null;
  uploadedAt: string | null;
  outcome: "ready" | "unsupported" | "failed";
  thumbPath: string | null;
  printPath: string | null;
  width: number | null;
  height: number | null;
};

export type ResizedPhoto = {
  thumb: Uint8Array;
  print: Uint8Array;
  width: number;
  height: number;
};

export type PhotoPrepDependencies = {
  listCandidates(closeout: PhotoCloseout): Promise<JobPhotoCandidate[]>;
  listPreparedFileJnids(closeoutId: string): Promise<Set<string>>;
  download(fileJnid: string): Promise<Uint8Array>;
  resize(bytes: Uint8Array): Promise<ResizedPhoto>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  recordPhoto(row: PreparedPhotoRow): Promise<void>;
};

export function photoPaths(closeout: Pick<PhotoCloseout, "companyId" | "id">, fileJnid: string) {
  const safe = fileJnid.replace(/[^A-Za-z0-9_-]/g, "_");
  const base = `${closeout.companyId}/${closeout.id}/photos/${safe}`;
  return { thumb: `${base}-thumb.webp`, print: `${base}-print.jpg` };
}

// Photos from the install window, oldest first, capped. The window opens a
// couple of days before delivery so tear-off photos taken that morning count.
export function choosePhotoCandidates(candidates: JobPhotoCandidate[]): JobPhotoCandidate[] {
  return [...candidates]
    .sort((a, b) => (a.takenAt ?? a.uploadedAt ?? "").localeCompare(b.takenAt ?? b.uploadedAt ?? ""))
    .slice(0, MAX_PHOTOS_PER_CLOSEOUT);
}

export type PhotoBatchResult = { done: boolean; processed: number; ready: number; remaining: number };

// One bounded batch, safe to repeat: photos already recorded are skipped.
// A transient JobNimbus or storage failure throws so the caller retries the
// batch; a photo JobNimbus refuses outright is recorded as failed.
export async function prepareCloseoutPhotoBatch(
  closeout: PhotoCloseout,
  dependencies: PhotoPrepDependencies,
  batchSize = PHOTO_BATCH_SIZE,
): Promise<PhotoBatchResult> {
  const candidates = choosePhotoCandidates(await dependencies.listCandidates(closeout));
  const prepared = await dependencies.listPreparedFileJnids(closeout.id);
  const pending = candidates.filter((candidate) => !prepared.has(candidate.fileJnid));
  const batch = pending.slice(0, batchSize);
  let ready = 0;

  for (const candidate of batch) {
    const base = {
      companyId: closeout.companyId,
      closeoutId: closeout.id,
      fileJnid: candidate.fileJnid,
      filename: candidate.filename,
      takenAt: candidate.takenAt,
      uploadedAt: candidate.uploadedAt,
    };
    if (!SUPPORTED_TYPES.has((candidate.contentType ?? "").toLowerCase())) {
      await dependencies.recordPhoto({ ...base, outcome: "unsupported", thumbPath: null, printPath: null, width: null, height: null });
      continue;
    }

    let resized: ResizedPhoto;
    try {
      resized = await dependencies.resize(await dependencies.download(candidate.fileJnid));
    } catch (error) {
      if (error instanceof JobNimbusProviderError && !error.terminal) throw error;
      // A terminal refusal or an image that won't decode: record it and move on.
      await dependencies.recordPhoto({ ...base, outcome: "failed", thumbPath: null, printPath: null, width: null, height: null });
      continue;
    }

    const paths = photoPaths(closeout, candidate.fileJnid);
    await dependencies.upload(paths.thumb, resized.thumb, "image/webp");
    await dependencies.upload(paths.print, resized.print, "image/jpeg");
    await dependencies.recordPhoto({
      ...base,
      outcome: "ready",
      thumbPath: paths.thumb,
      printPath: paths.print,
      width: resized.width,
      height: resized.height,
    });
    ready += 1;
  }

  const remaining = pending.length - batch.length;
  return { done: remaining === 0, processed: batch.length, ready, remaining };
}

// Resizing with sharp: orientation is applied from EXIF before the EXIF is
// dropped, so sideways phone photos come out upright.
export async function resizeWithSharp(bytes: Uint8Array): Promise<ResizedPhoto> {
  const { default: sharp } = await import("sharp");
  const source = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
  const [thumb, print] = await Promise.all([
    source
      .clone()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer({ resolveWithObject: true }),
    source
      .clone()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer({ resolveWithObject: true }),
  ]);
  return {
    thumb: new Uint8Array(thumb.data),
    print: new Uint8Array(print.data),
    width: print.info.width,
    height: print.info.height,
  };
}
