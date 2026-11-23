# Garden Path Advertising Study: web data collection

Live study: https://mcanbolat.github.io/gardenpath/

Participants view three t-shirt advertisements, one per page. Each ad pairs one of three slogans with one of three shirt colors.
They move freely between the ads, choose the most effective one, write down the slogans they remember, rate each ad, and answer a few final questions.
Data go to the Supabase project `newsvendor-game` in tables prefixed `gp_`.

## Links

| Purpose | URL |
|---|---|
| Online / subject pool | `https://mcanbolat.github.io/gardenpath/?pid=PARTICIPANT_ID` |
| Lab with eye tracker (full screen, flagged `eye_tracker`) | `https://mcanbolat.github.io/gardenpath/?pid=ID&et=1&station=LAB1` |
| Testing (excluded from counterbalancing and analysis) | `https://mcanbolat.github.io/gardenpath/?test=1` |

`PROLIFIC_PID` and `id` are also accepted in place of `pid`. Without an ID in the link, the consent page asks for one.

## Design

- Slogans (all 52 characters, single line):
  - **GP**: The cotton clothing is made of grows in Mississippi.
  - **CA**: Clothing crafted from soft Mississippi-grown cotton.
  - **CB**: Classic clothing from cotton sourced in Mississippi.
- Colors: red `#D63A2C`, blue `#2547BF`, green `#2F6B43`.
- 36 layouts: 6 slogan-to-color assignments × 6 page orders. `gp_start_session` assigns the least-used layout. It counts completed sessions plus sessions started in the last hour, and ignores test sessions.
- Ads are drawn in a fixed 900×520 px area: shirt 300×300 px, slogan centered below it. On each ad page entry, the app logs the AOI pixel rectangles.

## Data

| Table | One row per | Key fields |
|---|---|---|
| `gp_sessions` | participant | `layout_id`, `color_map`, `page_order`, choice, `recall_text`, `answers` (JSON: comprehension, seen_before, demographics) |
| `gp_ad_measures` | participant × ad | `dwell_ms`, `visits`, `first_visit_ms`, `text_hover_ms`, `rating_effective` (1–10), `rating_clarity` (1–7), `error_judgment`, `color_liking` (1–7) |
| `gp_events` | logged event | `client_epoch_ms` (Unix ms, for syncing with the eye tracker), `perf_ms`, page, event, detail |
| `gp_analysis` (view) | participant × ad | completed, non-test sessions, ready for analysis |

Dwell time counts only the time the ad page is on screen *and* the window is visible and focused.

Export for analysis: in the Supabase dashboard, open the SQL editor and run `select * from gp_analysis;`, then download the result as CSV.
Raw events: `select * from gp_events order by session_id, seq;`.

## Security

The browser uses the publishable key. Row-level security is on and the tables have no policies, so a browser cannot read or change any table directly. It can only call three functions: `gp_start_session`, `gp_log_events` and `gp_finish_session`. Once a session is completed, these functions reject further writes to it. The schema is in `sql/schema.sql`.

## Before launch

- Add the IRB approval number and contact details to the consent text in `app.js` (search for `[IRB`).
- Delete any pilot rows: `delete from gp_sessions where is_test;` (events and measures are deleted with them).
