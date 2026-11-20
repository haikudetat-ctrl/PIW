# Job closeouts

Operator guide for the production closeout package: what the production
manager sees, how PIW fills it in, what the homeowner signs, and how the
package gets back to JobNimbus.

Filing to JobNimbus ships switched off. Closeouts, photos, the homeowner
sign-off and the PDF all work without it; writes to JobNimbus wait until the
per-company setting below is turned on.

## How it fits together

```
JobNimbus (hourly warehouse sync → jn_jobs, jn_files, jobnimbus_records)
  │  supplier delivery receipt on the job ("SRS Distribution Proof of Delivery")
  ▼
/closeouts queue: jobs delivered in the last 60 days, open closeouts, recent submissions
  │  Start closeout → start_job_closeout()
  │   • prefill: job fields, delivery date, supplier paperwork, Roofr report
  │   • install days: days with 5+ crew photos taken on or after delivery
  ▼
job-closeout-worker (Inngest, event + every 10 min)
  │  copies install-window photos from JobNimbus, one paced client
  │  sharp: upright, 480px WebP thumbnail + 1400px JPEG print copy, EXIF dropped
  │  → private storage bucket job-closeouts
  ▼
/closeouts/[jnid]: dates, crew, squares, checklist, up to 12 photos, open items
  │  "Save and hand to homeowner" → /signoff/[closeoutId] (no app navigation)
  │   homeowner confirms completion, photo release yes/no, review link yes/no, signs
  ▼
Submit → submit_job_closeout() queues two writes
  │  attach_package: render PDF → keep a copy in storage → JobNimbus presigned upload
  │  set_completed_status: only after the package is attached
  ▼
JobNimbus job: closeout PDF attached, status moved to the completed status
```

## Who can use it

Managers and above (the same access as the pipeline). The production
manager needs a manager login in Rake. The homeowner signs on the manager's
signed-in phone; the sign-off page shows no prices, notes or other jobs.

## Turning on JobNimbus filing

1. Confirm the company's JobNimbus API key can edit jobs and upload files.
   The warehouse sync only reads, so a read-only key works for the sync and
   fails here with a 401 or 403 the closeout page explains.
2. Add the settings row:

   ```sql
   insert into public.job_closeout_settings (company_id, jobnimbus_writeback_enabled)
   values ('<company id>', true)
   on conflict (company_id) do update set jobnimbus_writeback_enabled = true, updated_at = now();
   ```

3. Closeouts submitted while filing was off go out on the next sweep.

Other settings on the same row:

| Column | Default | Meaning |
|---|---|---|
| `completed_status_name` | `Job Completed` | JobNimbus status a closed job moves to |
| `delivery_receipt_pattern` | `proof of delivery` | File names (regex, case-insensitive) that mark materials delivered |
| `package_document_pattern` | `proof of delivery\|distribution invoice\|material order` | Supplier paperwork listed in the package |

The worker runs only where `INTEGRATIONS_JOBNIMBUS_SYNC_ENABLED=true`.

## Safety rules built in

- **Package before status.** The status write is claimable only after the
  package write succeeded, so a completed job always carries its package.
- **No double uploads.** Creating a JobNimbus upload is not retried except on
  a 429. If an attempt recorded an upload ticket, the next attempt first
  checks whether the hourly sync has seen that file and stops if so. A crash
  between the ticket and the upload can still leave an empty placeholder
  file in JobNimbus; it would show in the job's files.
- **No status regressions.** A job JobNimbus already treats as completed
  (for example "Pending Payments") is left alone. A job marked lost is not
  moved; the write fails with an explanation and can be retried after the
  job is checked.
- **Signed means locked.** Once the homeowner signs, the finish date and open
  items can't change until the manager clears the sign-off. The open items
  are part of the sentence the homeowner signs.
- **Wording is versioned.** `HOMEOWNER_TERMS_VERSION` in
  `src/domain/closeouts.ts` is stored with each signature. Change it whenever
  the homeowner-facing wording changes.

## When something goes wrong

| Symptom | Where to look |
|---|---|
| Job missing from the queue | Its delivery receipt name doesn't match `delivery_receipt_pattern`, or the hourly sync hasn't run. Any sold job can still be closed from its job page ("Close out job"). |
| Photos stuck on "Copying" | `job_closeouts.photos_status`, `photos_error`. Failed preparation is retried twice, ten minutes apart; after that the package goes without photos. |
| iPhone photos not shown | HEIC can't be decoded here. They stay in JobNimbus and are counted under the photo grid. |
| "Filing failed" | The write's `outcome_detail` on the closeout page. Retry from there once the cause is fixed. |
| Install days look wrong | They come from photo timestamps (`date_file_created`). The manager's dates win once saved. |

Retries back off 2, 4, 8, 16 minutes and give up after five attempts.
