# Meta signal review reports

Dated output from the `meta-signal-review` skill
(`.claude/skills/meta-signal-review/`).

Each report audits whether the Meta ads measurement loop is trustworthy for a
stated window, grades every signal source, and records three headline numbers:
the click-to-arrival gap, conversion coverage, and cost per real lead.

File naming: `YYYY-MM-DD-meta-signal-review.md`, dated by the run, not the
window.

Reports are meant to be diffed against each other. Section order is fixed for
that reason — do not reorder sections when editing a report by hand.

Reports contain aggregates only: no contact details, no secrets, no raw Meta
payloads. Manual Ads Manager CSV exports are never committed here.
