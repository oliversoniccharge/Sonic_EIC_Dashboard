# Sonic EIC Dashboard

Type: Internal Improvement — Internal Tool

Public repository: https://github.com/oliversoniccharge/Sonic_EIC_Dashboard.git

This project converts the existing Meter Data Analysis dashboard into a private multi-site website. The public repository contains code only. Never commit customer names, addresses, NMIs, meter files, email IDs, token caches, generated datasets or credentials. Private working data lives in ignored `.private/`; deployed private data lives in ignored `dist/data/`.

Read `docs/daily-update.md` for the scheduled workflow using the connected Outlook Email tools. The optional `scripts/sync_mail.py` direct-Graph path requires a valid local email-organiser grant; that grant was expired at setup, so do not rely on it or request interactive consent automatically. Use `python scripts/build_data.py` to merge validated readings and build private site assets. Never mark messages read, move/delete mail, send email, or change consent. Failed syncs must not advance the successful watermark.

Preserve `.openai/hosting.json` identity. Deploy privately using Sites. Push source to the specified GitHub repository and the Sites source remote. Build output data must never be staged in either Git repository. All customer data is delivered only inside the private deployment archive.
