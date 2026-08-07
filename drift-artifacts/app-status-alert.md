App status drift detected (http://localhost:8080/api/public/app-status/health): 2 changed

*App status drift detected (http://localhost:8080/api/public/app-status/health): 2 changed*

Changed:
• `apps/youtube_optimizer` badgeLabel: "Beta" → "Pilot"
• `ecosystem/career_compass` badgeLabel: "Beta" → "Pilot"

If this change is intentional, promote the baseline with `bun run baseline:app-status` and commit `baselines/app-status.json`.
