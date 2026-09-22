# Sonic Charge EIC Dashboard

A private, multi-site Western Power meter dashboard, with Sonic Charge's official logo assets and turquoise `#03c0c1` colourway.

## Features

- Search sites by NMI, address or name; new NMIs are discovered from incoming files.
- Interval import/export, coincident peak demand, daily/monthly energy and load profiles.
- Original register codes, quality flags, date filters and CSV export.
- NEM13 accumulated read periods displayed separately, never invented as interval demand.
- Detailed analysis and local file upload tools retained from the original analyser.
- Mean and median import demand (kW) and daily import energy (kWh/day) in detailed analysis.
- Read-only daily email collection, deduplication and revision-aware merging.

## Privacy

This repository contains source and branding only. Customer datasets, raw attachments, email metadata and credentials are excluded from Git. The hosted website is owner-private. **Do not enable public access or deploy this dataset to GitHub Pages.**

`dist/data/` is generated locally from the ignored `.private/` store and included only in a private deployment archive. A fresh public clone intentionally has no customer readings. Keep the private store backed up within approved company storage.

## Local development

Requires Python 3.11+ and Node.js 20+. Install Python requirements, then:

```text
python scripts/build_data.py
python scripts/test_data.py
node --test scripts/test_meter.mjs scripts/test_analysis_statistics.mjs
node scripts/preview.mjs
```

Preview: http://127.0.0.1:4382. The static app requires no npm build. Chart.js is loaded from a pinned CDN version; if unavailable, numerical summaries, tables and exports remain usable.

## Daily collection and publishing

See [the operating procedure](docs/daily-update.md). The active schedule runs through the desktop task with its connected Outlook account; it is not a cloud GitHub Action. The computer must be on and Codex running at the scheduled time. The optional direct Microsoft Graph script needs a valid existing local grant; no mailbox credentials are stored in this repo.

## Reading semantics

NEM12 E-family KWH registers are import and B-family KWH registers are export. Readings are merged by NMI, meter, register, suffix, unit, interval and date. Source update time takes precedence over receipt order. Missing values remain null; demand is an interval average, not instantaneous power. Partial register coverage can understate the total site peak.

NEM13 records remain complete read periods; overlapping periods are not prorated or summed into daily charts. Site names/addresses use the latest standing-data notification. Optional private name overrides can be stored in `.private/site-names.json`, keyed by NMI.

The original detailed analyser aggregates register families for compatibility and only opens hosted data with a single interval length and no missing values. Its system-sizing suggestions are indicative, not engineering design approval.

Detailed-analysis mean and median statistics use the selected date range. Demand is calculated from finite interval readings using the channel's interval duration, including real zeros. Daily energy statistics include only complete days; the cards disclose excluded incomplete days. Empty selections display a dash, not zero.
