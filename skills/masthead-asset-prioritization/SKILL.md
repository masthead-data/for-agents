---
name: masthead-asset-prioritization
description: Review monitoring tiers for BigQuery tables and BI assets against Masthead asset scores — propose PRIORITY or CRITICAL for assets that matter and REGULAR for prioritized assets that no longer do — explain each suggestion from the score metrics, and apply changes through the Masthead MCP server only on per-asset confirmation.
compatibility: Requires connection to the Masthead MCP server at `https://mcp.mastheadata.com/mcp`.
---

# Asset Prioritization from Asset Scores

## Purpose

Keep monitoring tiers aligned with how much each asset actually matters to the tenant: propose a higher tier for important assets still on default monitoring, propose a lower tier for prioritized assets that carry no signal any more, give a reason grounded in Masthead's asset score metrics for every suggestion, and apply a change only when the user confirms it. Downstream asset priorities (dashboards, reports) drive pipeline anomaly alerting, so BI assets are reviewed alongside tables.

## Operating Modes

* **Recommendation Mode (Default)**: reads scores, lineage and pipelines; produces the review blocks. **No `update_table_priority` or `update_bi_asset_priority` call is made in this mode.**
* **Action Mode**: applies confirmed tier changes with `update_table_priority` (tables) or `update_bi_asset_priority` (BI assets), one asset at a time, then re-reads to confirm. **Requires the user's explicit sign-off per asset or for a whole listed group.**

## How the score works

`list_asset_scores` returns a score between 0 and 1 per asset, **relative to the tenant and asset type** (each signal is normalized across the tenant's assets of that type, then combined), never an absolute threshold. It covers five asset types: `TABLE`, `LOOKER_DASHBOARD`, `LOOKER_LOOK`, `LOOKER_STUDIO_REPORT`, `GOOGLE_SPREADSHEET` — the last four are "BI assets" throughout this skill. The signals, roughly in order of influence:

| Metric key | Meaning |
| --- | --- |
| `downstreamCost` | 30-day compute cost of everything that reads the asset |
| `upstreamCost` | 30-day compute cost of the chain that writes it |
| `upstreamFreq` | seconds between writes (more frequent = higher signal) |
| `downstreamFreq` | seconds between downstream reads (more frequent = higher signal) |
| `biAssetsCount` | dashboards, looks and reports that read it |
| `saReadsCount` | service accounts that read it |

Use the raw `metrics` to say *why* an asset ranks where it does: name the one or two signals that dominate, or say "no observed signal" when they are all 0.

Assets with a score of 0 have no observed signal and are not ranked at all (they never appear in `values` and do not count toward percentiles); on large tenants they are the vast majority.

`alertType` is the asset's current monitoring tier: `REGULAR` (default), `MUTED` (anomalies not alerted), `PRIORITY`, `CRITICAL`.

A `TABLE` row identifies itself with `project`/`dataset`/`table`; a BI-asset row carries `title`/`url` instead — there is no project or dataset for a dashboard, look, report or spreadsheet.

## Workflow

### Step 0: Scope

Take the scope from the user's request: an asset-type scope, a project, a dataset, and the percentile cut (default **90**). Asset-type scope defaults to all five types; "tables" in the prompt narrows it to `[TABLE]`, "dashboards" (or "BI assets") narrows it to the four non-table types. `project` / `dataset` only ever apply to `TABLE` — pass them for the `TABLE` calls and omit them for BI-asset calls. Nothing given → whole tenant, all asset types, percentile 90.

### Step 1: Candidates

Run every call below **once per in-scope asset type**, with `assetTypes = [<type>]` — percentiles and the 2-page cap apply within that type, because the response's `percentile` is already a rank within the asset's own type.

1. **Raise**: `list_asset_scores` with `assetTypes = [<type>]`, `alertTiers = ["REGULAR"]`, `minPercentile = <p>`, `limit = 200` (plus `project` / `dataset` when scoped, `TABLE` only). Fetch at most the first 2 pages (400 assets per type) — the report is a ranked shortlist, not the whole scope. Rows come back in `values`; note `pagination.total` and tell the user how many more assets of that type sit above the cut.
2. **Lower**: `list_asset_scores` with `assetTypes = [<type>]`, `alertTiers = ["PRIORITY", "CRITICAL"]`, no `minPercentile`, `limit = 200`, at most 2 pages. Keep the rows whose `percentile` is below 50 — prioritized assets that rank in the bottom half of their type.
3. **Muted**: `list_asset_scores` with `assetTypes = [<type>]`, `alertTiers = ["MUTED"]`, `minPercentile = <p>`, `limit = 200`, one page only. Keep these rows in a separate list; they never get a suggested tier.

`extra` is a map from asset type to that type's `{p50, p90, p95}` score **values** (points on the 0–1 score scale, not ranks), covering the asset types present on the page. Each item's own `percentile` is that asset's **rank within its own type** (0–100). Note each in-scope type's `extra.p90` and `extra.p95`; report them so the user sees where the cut sits, per type.

### Step 2: Suggested tier and reason

For each **raise** candidate:

* `percentile` ≥ 95 → suggest **CRITICAL**; 90 ≤ `percentile` < 95 → suggest **PRIORITY** (shift both when the user chose another percentile `p`: top half of the selected band → CRITICAL, i.e. CRITICAL cut = `(p + 100) / 2`; example: `p` = 80 → PRIORITY for 80–90, CRITICAL for ≥ 90).
* Reason: one sentence from `metrics`, concrete values, dominant signals first. Example: "3 BI assets, $210 downstream compute in 30 days, read hourly, written daily". If a metric is 0 or missing, say "not observed" instead of quoting the number.

For each **lower** candidate: suggest **REGULAR**, reason from `metrics` in the same form ("no BI assets, no service-account readers, read weekly downstream, $0.4 downstream compute"). A CRITICAL asset is a lowering candidate only when it ranks below the 25th percentile of its type; PRIORITY below the 50th.

Never suggest a tier for a MUTED asset.

### Step 3: Enrichment (top 5 only, `TABLE` rows only)

For the five highest-scoring raise candidates and the five lowest-scoring lower candidates **among `TABLE` rows**, call `get_table_lineage` (name the downstream tables and dashboards) and `get_table_pipelines` (name the writer and its technology). Add one clause to the reason. These tools take a table identity and have no BI-asset equivalent — skip enrichment for BI-asset rows entirely, and skip it beyond the top 5 per side to keep tool calls low.

### Step 4: Report

One block per in-scope asset type, each with the same three sections, in this order:

1. **Raise** — `asset | current tier | suggested tier | score | percentile | why`, highest score first.
2. **Consider lowering** — `asset | current tier | suggested tier | score | percentile | why`, lowest score first. Say plainly that lowering reduces alerting on an asset someone once marked important, so each row needs its own yes.
3. **Muted assets above the threshold** — `asset | score | percentile | why`, no suggested tier, with the question whether each mute is intentional.

Identify each asset as `project.dataset.table` for a `TABLE` row, or `title (url)` for a BI-asset row — fall back to `url` alone when `title` is missing, then to `uuid` when neither is present.

### Step 5: Apply (Action Mode only)

Only after the user confirms — per asset, or a whole group such as "all raises" — apply the confirmed tier: `update_table_priority(project, dataset, table, priorityTier)` for `TABLE` rows, `update_bi_asset_priority(assetType, uuid, priorityTier)` for BI-asset rows. Then re-read with `list_asset_scores` using the **same `assetTypes = [<type>]` scope as Step 1** (plus `project`/`dataset` for `TABLE`) and `alertTiers` set to the *new* tiers to confirm `alertType` changed — the Step 1 filters would otherwise drop the just-changed asset out of the result — and match the returned rows by `uuid` (present on every row, tables included) to the asset just changed: several assets can already sit at the new tier, so a row coming back proves nothing on its own, and a missing `uuid` match means the change is not confirmed and must be reported as such.

## Guardrails

* Never lower a tier, and never change a MUTED asset, without a per-asset yes from the user; "all raises" is a valid group confirmation, "all lowerings" is not.
* Never call `update_table_priority` or `update_bi_asset_priority` for an asset that was not in the reviewed lists.
* Assets with a score of 0 are outside the tool's scope, so a prioritized asset with no signal at all is not surfaced as a lowering candidate; mention this when the user asks for a full re-tiering pass.
* End with a numbered list of actionable next steps: the exact tool call or command, the expected effect on alerting, and how to verify it (re-run `list_asset_scores`, check the asset in the Masthead Dictionary).

## Documentation

* [About asset priorities in Masthead](https://docs.mastheadata.com/observability/data-dictionary#asset-priorities)
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools)
