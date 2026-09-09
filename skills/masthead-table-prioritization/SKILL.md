---
name: masthead-table-prioritization
description: Suggest which BigQuery tables to move to PRIORITY or CRITICAL monitoring from Masthead asset scores, explain each suggestion from its score metrics, and apply the change through the Masthead MCP server on confirmation.
compatibility: Requires connection to the Masthead MCP server at `https://mcp.mastheadata.com/mcp`.
---

# Table Prioritization from Asset Scores

## Purpose

Find tables that matter to the tenant but are still on default monitoring, propose a higher alert tier for each with a reason grounded in Masthead's asset score metrics, and apply the change only when the user confirms.

## Operating Modes

* **Recommendation Mode (Default)**: reads scores, lineage and pipelines; produces the review table and the muted list. **No `update_table_priority` call is made in this mode.**
* **Action Mode**: applies confirmed tier changes with `update_table_priority`, one table at a time, then re-reads the tables to confirm. **Requires the user's explicit sign-off per table or for the whole reviewed list.**

## How the score works

`list_table_scores` returns a score between 0 and 1 per table. It is a weighted sum of six signals, each min-max normalized across the tenant, so it is **relative to the tenant**, never an absolute threshold:

| Metric key | Weight | Meaning |
| --- | --- | --- |
| `downstreamCost` | 0.30 | 30-day compute cost of everything that reads the table |
| `upstreamCost` | 0.20 | 30-day compute cost of the chain that writes it |
| `upstreamFreq` | 0.15 | seconds between writes (more frequent = higher signal) |
| `downstreamFreq` | 0.15 | seconds between downstream reads (more frequent = higher signal) |
| `biAssetsCount` | 0.12 | dashboards, looks and reports that read it |
| `saReadsCount` | 0.08 | service accounts that read it |

Use the raw `metrics` to say *why* a table ranks high: name the one or two signals that dominate.

`alertTier` is the table's current monitoring tier: `REGULAR` (default), `MUTED` (anomalies not alerted), `PRIORITY`, `CRITICAL`.

## Workflow

### Step 0: Scope

Take the scope from the user's request: a project, a dataset, and the percentile cut (default **90**). Nothing given → whole tenant, percentile 90.

### Step 1: Candidates

1. `list_table_scores` with `alertTiers = ["REGULAR"]`, `minPercentile = <p>`, `limit = 50` (plus `project` / `dataset` when scoped). Page with `page` while `total` exceeds what you fetched.
2. `list_table_scores` again with `alertTiers = ["MUTED"]` and the same percentile. Keep these rows in a separate list; they are never candidates for a suggested tier.

Note `percentiles.p90` and `percentiles.p95` from the response; report them so the user sees where the cut sits.

### Step 2: Suggested tier and reason

For each REGULAR candidate:

* `percentile` ≥ 95 → suggest **CRITICAL**; 90 ≤ `percentile` < 95 → suggest **PRIORITY** (shift both when the user chose another percentile: top half of the selected band → CRITICAL).
* Reason: one sentence from `metrics`, concrete values, dominant signals first. Example: "3 BI assets, $210 downstream compute in 30 days, read hourly, written daily".

Never suggest lowering a tier. Never suggest a tier for a MUTED table.

### Step 3: Enrichment (top 5 only)

For the five highest-scoring candidates call `get_table_lineage` (name the downstream tables and dashboards) and `get_table_pipelines` (name the writer and its technology). Add one clause to the reason. Skip enrichment for the rest to keep tool calls low.

### Step 4: Report

Table `table | current tier | suggested tier | score | percentile | why`, highest score first. Then a section **Muted tables above the threshold** with `table | score | percentile | why` and the question whether each mute is intentional — no suggested tier.

### Step 5: Apply (Action Mode only)

Only after the user confirms — per table, or "all listed" — call `update_table_priority` for each confirmed table with the suggested tier, then `list_table_scores` scoped to those tables (`dataset` filter or a follow-up page) to confirm `alertTier` changed. Report what changed and what was skipped.

## Guardrails

* Never lower a tier.
* Never change a MUTED table without a per-table yes from the user.
* Never call `update_table_priority` for a table that was not in the reviewed list.
* Percentiles are tenant-relative; do not compare scores across tenants or quote them as absolute importance.
* End with a numbered list of actionable next steps: the exact tool call or command, the expected effect on alerting, and how to verify it (re-run `list_table_scores`, check the table in the Masthead Dictionary).

## Documentation

* [Table priorities in Masthead](https://docs.mastheadata.com/)
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools)
