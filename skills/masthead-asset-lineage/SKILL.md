---
name: masthead-asset-lineage
description: Find any asset Masthead knows — a BigQuery table, dataset or routine, a Looker dashboard, look or explore, a Looker Studio report, a Google Sheet, a Power BI report — from a URL, part of a name or an id, then trace its upstream sources and downstream consumers, using the Masthead MCP server tools `search_assets` and `get_lineage`.
compatibility: Requires connection to the Masthead MCP server at `https://mcp.mastheadata.com/mcp`.
---

# Find an Asset and Trace Its Lineage

## Purpose

Users start from what they have: a dashboard URL, a sheet link, part of a table name. Every other Masthead tool needs a Masthead `uuid` or an exact `project.dataset.table`. This skill gets from one to the other with `search_assets`, then reads lineage with `get_lineage`: the tables a dashboard reads, the dashboards and tables that depend on a table, and the path between them.

The skill is read-only. It never changes an asset.

## Prerequisites

* Active connection to the Masthead MCP server: `https://mcp.mastheadata.com/mcp`. A `401 Unauthorized` from any tool means the server is not signed in yet: run `/mcp` in Claude Code or `codex mcp login masthead` in Codex, then retry.
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools) for the full parameter lists.

## Workflow

### Step 1: Find the asset

Call `search_assets` with what the user gave you, unchanged. Don't strip a URL down to its id or guess a full table path: the server parses the input.

| The user gives | Pass as `query` | Notes |
| --- | --- | --- |
| A dashboard, report or sheet URL | the whole URL | Searched only as its own type; matches the id exactly |
| Part of a table, dataset or dashboard name | the fragment | Case-insensitive; `%` and `_` are literal |
| `project.dataset.table` | the path | Backticks and `project:dataset.table` are accepted |
| An id (Looker Studio report id, Sheets doc id, Looker id, Power BI report id) | the id | Exact match ranks first |
| A `uuid` from another Masthead tool | the uuid | Also finds deleted and hidden tables |

Narrow a fragment search with `types` when the user names the kind of asset, for example `["TABLE"]` or `["LOOKER_DASHBOARD", "LOOKER_LOOK"]`. Values: `TABLE`, `DATASET`, `ROUTINE`, `LOOKER_DASHBOARD`, `LOOKER_LOOK`, `LOOKER_EXPLORE`, `LOOKER_STUDIO_REPORT`, `LOOKER_STUDIO_DATASOURCE`, `GOOGLE_SPREADSHEET`, `POWERBI_REPORT`, `URI`, `SERVICE_ACCOUNT`.

Looker Studio reports, Looker Studio data sources and Google Sheets have **no title** in Masthead: Masthead never reads the report itself, so their `name` is the id. Find them by URL or id. If the user only knows a report's title, ask for its URL.

### Step 2: Read the result

Each row in `values` has `uuid`, `type`, `name`, `externalId`, `url`, `tier`, `tableType`, `lineageType`, `lastLineageAt`, `deleted` and `hidden`.

* **One row**: use it.
* **Several rows**: results are ordered exact match, then name starting with the query, then name containing it, then a match only in the id or URL. Take an exact match when there is one. Otherwise show the user the top rows (`type`, `name`, `tier`) and ask which one they mean. Don't pick one silently.
* **More pages**: `extra.nextOffset` is not null. Narrow the query or `types` before paging; call again with `offset = extra.nextOffset` only when the user needs the full list.
* **No rows**: Masthead has not seen the asset. Say so, and say why that happens:
  * a BI asset is known only after a BigQuery job labeled with its id ran in a connected project (`list_projects` shows the connected projects); a report nobody opened recently, or one that reads an unconnected project, is not known;
  * a table is known only when its project is connected.
* **An error is not an empty result.** A timeout or a `503` says nothing about the asset: retry once, then report the error.
* **`deleted` or `hidden` is true**: the table existed and is gone, or is a temporary table. Say so before reading its lineage.

### Step 3: Choose the lineage window

`get_lineage` reads only the **last 7 days** unless you pass a window. `lastLineageAt` from `search_assets` tells you whether that is enough:

| `lastLineageAt` | What to do |
| --- | --- |
| within the last 7 days | call `get_lineage` with no window |
| older | pass **both** `from` and `to`: `from` a day before `lastLineageAt`, `to` = now. A lone `from` is ignored. Tell the user the asset's last activity date |
| null | the asset has no lineage in Masthead. Don't call `get_lineage`; say that no job read or wrote it in a connected project |

`lineageType` null (datasets, Looker Studio data sources) means the asset is not a lineage node: there is nothing to trace from it. For a dataset, search its tables instead: `search_assets` with `query` = `project.dataset.` and `types = ["TABLE"]`.

### Step 4: Trace with `get_lineage`

Pass the row's `uuid` as `uuid` and its `lineageType` as `type`. `get_lineage` reads **one hop** in each direction.

| Question | `direction` | `nodeTypes` |
| --- | --- | --- |
| Which tables does this dashboard, report or sheet read? | `UPSTREAM` | `["TABLE"]` |
| What depends on this table? | `DOWNSTREAM` | omit |
| Which dashboards and reports read this table? | `DOWNSTREAM` | `["LOOKER", "LOOKER_STUDIO_REPORT", "POWERBI_REPORT", "GOOGLE_SPREADSHEET"]` |
| What feeds this table? | `UPSTREAM` | omit |

Reading the response:

* Neighbours are in `value.nodes`, each with `uuid`, `nodeType`, `positionType` (`UPSTREAM` or `DOWNSTREAM`) and `info` (name, tier).
* `value.pages.upstream.total` and `value.pages.downstream.total` are the full counts; always report them. Each direction returns the 100 most recently active neighbours. When `nextOffset` is not null and the rest matters, call again with that `direction` and `offset = nextOffset`; otherwise say the list is partial.
* **Walk further** by passing a neighbour's `uuid` and `nodeType` as `uuid` and `type`. Keep the same `from` and `to` on every hop. Go at most as deep as the question needs, and say how many hops you read.
* **A node with `info: null`** is a table Masthead has lineage for but no metadata: its project is not connected, or it was deleted, or it is not collected yet. Call `search_assets` with its `uuid` once; if that returns nothing, report it as "unnamed table (`uuid`)" with those possible reasons. Don't invent a name.

### Step 5: Report

* Name each asset the way the user would recognise it: `project.dataset.table` for a table, `name` and `url` for a BI asset (for Looker Studio and Sheets the URL is the name).
* Give the window you read ("last 7 days", or the `from` and `to` you passed) and the totals per direction.
* State the monitoring `tier` of the assets found when it matters to the question (`CRITICAL` and `PRIORITY` first).
* State only what the tools returned. Masthead lineage is built from observed jobs: no upstream in the window means no job wrote the table in that window, not that the table has no sources.

## Examples

**"Which tables feed this dashboard? `https://lookerstudio.google.com/reporting/<id>/page/abc`"**

1. `search_assets(query = "<the URL>")` → one `LOOKER_STUDIO_REPORT` row; note `uuid`, `lineageType`, `lastLineageAt`.
2. `lastLineageAt` is a month old → `get_lineage(uuid, type = "LOOKER_STUDIO_REPORT", direction = "UPSTREAM", nodeTypes = ["TABLE"], from = <a day before lastLineageAt>, to = <now>)`.
3. Report the source tables, `value.pages.upstream.total`, and that the report was last active a month ago.

**"What breaks if `orders_daily` is late?"**

1. `search_assets(query = "orders_daily", types = ["TABLE"])` → three rows; ask which one, or take the exact match.
2. `get_lineage(uuid, type = "TABLE", direction = "DOWNSTREAM")` → downstream tables and BI assets, with the total.
3. For each downstream table that matters, one more hop with its `uuid` and `nodeType`.

## Guardrails

* Read-only: this skill calls `search_assets`, `get_lineage` and `list_projects` only.
* Never report "not tracked" from an empty `get_lineage` alone. Check `lastLineageAt` first: an empty result inside a 7-day window is common for a report opened monthly.
* Never pass an id from a URL as `uuid` to `get_lineage`. The id in a Looker Studio or Sheets URL is not the Masthead `uuid`; `search_assets` returns the right one.
* To find a table's writers, run history or cost, use `get_table_pipelines`; for open incidents on the assets you found, use the `masthead-incident-triaging` skill.

## Documentation

* [MCP tools reference: `search_assets`](https://docs.mastheadata.com/developer/mcp/tools#search_assets)
* [MCP tools reference: `get_lineage`](https://docs.mastheadata.com/developer/mcp/tools#get_lineage)
