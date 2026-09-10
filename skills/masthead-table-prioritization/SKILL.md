---
name: masthead-table-prioritization
description: Review BigQuery table monitoring tiers against Masthead asset scores — propose PRIORITY or CRITICAL for tables that matter and REGULAR for prioritized tables that no longer do — explain each suggestion from the score metrics, and apply changes through the Masthead MCP server only on per-table confirmation.
compatibility: Requires connection to the Masthead MCP server at `https://mcp.mastheadata.com/mcp`.
---

# Table Prioritization from Asset Scores

## Purpose

Keep monitoring tiers aligned with how much each table actually matters to the tenant: propose a higher tier for important tables still on default monitoring, propose a lower tier for prioritized tables that carry no signal any more, give a reason grounded in Masthead's asset score metrics for every suggestion, and apply a change only when the user confirms it.

## Operating Modes

* **Recommendation Mode (Default)**: reads scores, lineage and pipelines; produces the review tables. **No `update_table_priority` call is made in this mode.**
* **Action Mode**: applies confirmed tier changes with `update_table_priority`, one table at a time, then re-reads the tables to confirm. **Requires the user's explicit sign-off per table or for a whole listed group.**

## How the score works

`list_table_scores` returns a score between 0 and 1 per table, **relative to the tenant** (each signal is normalized across the tenant's tables, then combined), never an absolute threshold. The signals, roughly in order of influence:

| Metric key | Meaning |
| --- | --- |
| `downstreamCost` | 30-day compute cost of everything that reads the table |
| `upstreamCost` | 30-day compute cost of the chain that writes it |
| `upstreamFreq` | seconds between writes (more frequent = higher signal) |
| `downstreamFreq` | seconds between downstream reads (more frequent = higher signal) |
| `biAssetsCount` | dashboards, looks and reports that read it |
| `saReadsCount` | service accounts that read it |

Use the raw `metrics` to say *why* a table ranks where it does: name the one or two signals that dominate, or say "no observed signal" when they are all 0.

Tables with a score of 0 have no observed signal and are not ranked at all (they never appear in `values` and do not count toward percentiles); on large tenants they are the vast majority.

`alertType` is the table's current monitoring tier: `REGULAR` (default), `MUTED` (anomalies not alerted), `PRIORITY`, `CRITICAL`.

## Workflow

### Step 0: Scope

Take the scope from the user's request: a project, a dataset, and the percentile cut (default **90**). Nothing given → whole tenant, percentile 90.

### Step 1: Candidates

1. **Raise**: `list_table_scores` with `alertTiers = ["REGULAR"]`, `minPercentile = <p>`, `limit = 200` (plus `project` / `dataset` when scoped). Fetch at most the first 2 pages (400 tables) — the report is a ranked shortlist, not the whole scope. Rows come back in `values`; note `pagination.total` and tell the user how many more tables sit above the cut.
2. **Lower**: `list_table_scores` with `alertTiers = ["PRIORITY", "CRITICAL"]`, no `minPercentile`, `limit = 200`, at most 2 pages. Keep the rows whose `percentile` is below 50 — prioritized tables that rank in the bottom half of scored tables.
3. **Muted**: `list_table_scores` with `alertTiers = ["MUTED"]`, `minPercentile = <p>`, `limit = 200`, one page only. Keep these rows in a separate list; they never get a suggested tier.

`extra.p50`/`p90`/`p95` are the tenant's score **values** at those percentiles (points on the 0–1 score scale), not ranks. Each item's own `percentile` is that table's **rank** within the tenant scope (0–100). Note `extra.p90` and `extra.p95` from the response; report them so the user sees where the cut sits.

### Step 2: Suggested tier and reason

For each **raise** candidate:

* `percentile` ≥ 95 → suggest **CRITICAL**; 90 ≤ `percentile` < 95 → suggest **PRIORITY** (shift both when the user chose another percentile `p`: top half of the selected band → CRITICAL, i.e. CRITICAL cut = `(p + 100) / 2`; example: `p` = 80 → PRIORITY for 80–90, CRITICAL for ≥ 90).
* Reason: one sentence from `metrics`, concrete values, dominant signals first. Example: "3 BI assets, $210 downstream compute in 30 days, read hourly, written daily". If a metric is 0 or missing, say "not observed" instead of quoting the number.

For each **lower** candidate: suggest **REGULAR**, reason from `metrics` in the same form ("no BI assets, no service-account readers, read weekly downstream, $0.4 downstream compute"). A CRITICAL table is a lowering candidate only when it ranks below the 25th percentile; PRIORITY below the 50th.

Never suggest a tier for a MUTED table.

### Step 3: Enrichment (top 5 only)

For the five highest-scoring raise candidates and the five lowest-scoring lower candidates call `get_table_lineage` (name the downstream tables and dashboards) and `get_table_pipelines` (name the writer and its technology). Add one clause to the reason. Skip enrichment for the rest to keep tool calls low.

### Step 4: Report

Three sections, in this order:

1. **Raise** — `table | current tier | suggested tier | score | percentile | why`, highest score first.
2. **Consider lowering** — `table | current tier | suggested tier | score | percentile | why`, lowest score first. Say plainly that lowering reduces alerting on a table someone once marked important, so each row needs its own yes.
3. **Muted tables above the threshold** — `table | score | percentile | why`, no suggested tier, with the question whether each mute is intentional.

### Step 5: Apply (Action Mode only)

Only after the user confirms — per table, or a whole group such as "all raises" — call `update_table_priority` for each confirmed table with the suggested tier, then re-read with `list_table_scores` using the **same `project`/`dataset` scope as Step 0** and `alertTiers` set to the *new* tiers to confirm `alertType` changed — the Step 1 filters would otherwise drop the just-changed table out of the result.

## Guardrails

* Never lower a tier, and never change a MUTED table, without a per-table yes from the user; "all raises" is a valid group confirmation, "all lowerings" is not.
* Never call `update_table_priority` for a table that was not in the reviewed lists.
* Tables with a score of 0 are outside the tool's scope, so a prioritized table with no signal at all is not surfaced as a lowering candidate; mention this when the user asks for a full re-tiering pass.
* End with a numbered list of actionable next steps: the exact tool call or command, the expected effect on alerting, and how to verify it (re-run `list_table_scores`, check the table in the Masthead Dictionary).

## Documentation

* [About asset priorities in Masthead](https://docs.mastheadata.com/observability/data-dictionary#asset-priorities)
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools)
