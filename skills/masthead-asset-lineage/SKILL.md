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

Narrow to one BigQuery project with `project` (an id from `list_projects`) when the user names one or a fragment returns too much. For a table, dataset or routine it means "in this project". A BI asset has no project of its own: there it means "reads tables in this project", so say it that way in your answer. URIs and service accounts are left out when `project` is set.

Looker Studio reports, Looker Studio data sources and Google Sheets have **no title** in Masthead: Masthead never reads the report itself, so their `name` is the id. Find them by URL or id. If the user only knows a report's title, ask for its URL.

### Step 2: Read the result

Each row in `values` is an asset, the same shape `get_pipeline_context` uses for sources and destinations. It always has `type`, `uuid` and `name`. Then come the fields of its kind: `project`, `dataset`, `table` and `tableType` for a table; `lookerId`, `title` and `url` for a Looker dashboard or look; `reportId` and `url` for a Looker Studio report; `docId` and `url` for a Google Sheet; `uri` for a URI. Then `lineageType`, `alertType`, `lastLineageAt`, `projectConnected`, `sourceProjects`, `deleted` and `hidden`, each only where it applies. A field with no value is left out, so treat a missing field as "none".

* **One row**: use it.
* **Several rows**: results are ordered exact match, then name starting with the query, then name containing it, then a match only in the id or URL. Take an exact match when there is one. Otherwise show the user the top rows (`type`, `name`, `alertType`) and ask which one they mean. Don't pick one silently.
* **More pages**: `extra.nextOffset` is not null. Narrow the query or `types` before paging; call again with `offset = extra.nextOffset` only when the user needs the full list.
* **No rows**: read `code` and `error`, which say why, and pass the reason on to the user:

  | `code` | Meaning | What to say or do |
  |---|---|---|
  | `NOT_FOUND` | nothing matches | a BI asset is known only after a BigQuery job labeled with its id ran in a connected project (`list_projects` shows them); a report nobody opened recently, or one that reads an unconnected project, is not known |
  | `PROJECT_NOT_CONNECTED` | the query is a table path whose project is not connected, or was disconnected | name the project; Masthead knows no tables in it |
  | `NO_METADATA` | lineage refers to the uuid, but Masthead has no metadata for it | `get_lineage` can still read its neighbours with the uuid; don't invent a name |

* **`score` and `percentile`** (tables and scored BI assets): how much the asset matters, 0 to 100 among the tenant's assets of its type. Missing means the asset has no score. Use it to say which of several matches matters most.
* **`columns` and `isAnomaly`** (tables): the column count, and whether an incident is open on the table now.
* **An error is not an empty result.** A timeout or a `503` says nothing about the asset: retry once, then report the error.
* **`sourceProjects`** (BI assets): the projects of the tables the asset reads. Compare it with `list_projects`: a project in the list that is not connected is a source Masthead can't see, so `get_lineage` will show those tables without names, or not at all. Say which projects those are.
* **`projectConnected` is false** (tables, datasets, routines): the project was disconnected from Masthead. The asset's metadata and lineage are stale; say so.
* **`deleted` or `hidden` is true**: the table existed and is gone, or is a temporary table. Say so before reading its lineage.

### Step 3: Choose the lineage window

`get_lineage` reads only the **last 7 days** unless you pass a window. `lastLineageAt` from `search_assets` tells you whether that is enough:

| `lastLineageAt` | What to do |
| --- | --- |
| within the last 7 days | call `get_lineage` with no window |
| older | pass `from`, a day before `lastLineageAt`. `from` alone reads up to now; add `to` only to cut the window short. Tell the user the asset's last activity date |
| missing | the asset has no lineage in Masthead. Don't call `get_lineage`; say that no job read or wrote it in a connected project |

To check a specific period for several assets at once, pass `from` (and `to` if needed) to `search_assets`: the same assets come back, and `lastLineageAt` is then the latest edge inside that window, missing when there is none. Leave them out for the first search, so an asset last active long ago still shows when.

No `lineageType` (datasets, Looker Studio data sources) means the asset is not a lineage node: there is nothing to trace from it. For a dataset, search its tables instead: `search_assets` with `query` = `project.dataset.` and `types = ["TABLE"]`.

### Step 4: Trace with `get_lineage`

Pass the row's `uuid` as `uuid` and its `lineageType` as `type`. `get_lineage` reads **one hop** in each direction.

| Question | `direction` | `nodeTypes` |
| --- | --- | --- |
| Which tables does this dashboard, report or sheet read? | `UPSTREAM` | `["TABLE"]` |
| What depends on this table? | `DOWNSTREAM` | omit |
| Which dashboards and reports read this table? | `DOWNSTREAM` | `["LOOKER", "LOOKER_STUDIO_REPORT", "POWERBI_REPORT", "GOOGLE_SPREADSHEET"]` |
| What feeds this table? | `UPSTREAM` | omit |

Reading the response:

* Neighbours are in `value.nodes`, each with `uuid`, `nodeType`, `positionType` (`UPSTREAM` or `DOWNSTREAM`) and `asset`: the node in the shape of a `search_assets` row (`type`, `name`, `lineageType`, `alertType` and the fields of its kind, such as `project`, `dataset`, `table` or `url`). A field with no value is missing. `info` holds what the Masthead app draws; prefer `asset`.
* `value.pages.upstream.total` and `value.pages.downstream.total` are the full counts; always report them. Each direction returns the 100 most recently active neighbours. When `nextOffset` is not null and the rest matters, call again with that `direction` and `offset = nextOffset`; otherwise say the list is partial.
* **No neighbours**: read `code` and `error` before concluding anything. `get_lineage` always returns the node you asked for, so an empty response alone proves nothing.

  | `code` | What it means | What to do |
  | --- | --- | --- |
  | `NOT_FOUND` | no asset has this uuid | you passed an id that is not a Masthead `uuid`: go back to Step 1 |
  | `WRONG_TYPE` | the uuid is another asset type | call again with the `type` that `error` names |
  | `NO_LINEAGE` | the asset exists, never had lineage | report that; there is nothing to trace |
  | `OUTSIDE_REQUEST` | lineage exists, none in this window or filter | `error` gives the last lineage time: pass `from`, a time before it, or drop `direction` / `nodeTypes` |
  | `NO_METADATA` | lineage refers to the uuid, Masthead has no metadata | report it as an unnamed table: project not connected, deleted, or not collected yet |

* **Pipelines between assets**: lineage shows the pipeline that connects two assets, with its uuid. To learn what it is, call `get_pipeline_context` with that uuid: who runs it, its SQL, whether it runs on schedule (`runs.total` against `runs.expected`), its last error, cost, and open incidents. Use it when the user asks why a table changed or stopped updating, not for every edge. Its `sources`, `destinations` and `consumers` are assets in the `search_assets` shape, so their `uuid` and `lineageType` go straight to `get_lineage`. When a destination table has `isAnonymous: true` the pipeline is an ad-hoc query that writes no permanent table: report it as a one-off query by its principal, not as a table's writer.
* **Walk further** by passing a neighbour's `uuid` and `nodeType` as `uuid` and `type`. Keep the same `from` (and `to`, if you set one) on every hop. Go at most as deep as the question needs, and say how many hops you read.
* **A node with `info: null`** (its `asset.type` is `OTHER` and `asset.name` is the uuid) is a table Masthead has lineage for but no metadata: its project is not connected, or it was deleted, or it is not collected yet. Call `search_assets` with its `uuid` once; if that returns nothing, report it as "unnamed table (`uuid`)" with those possible reasons. Don't invent a name.

### Step 5: Report

* Name each asset the way the user would recognise it: `project.dataset.table` for a table, `name` and `url` for a BI asset (for Looker Studio and Sheets the URL is the name).
* Give the window you read ("last 7 days", or the `from` you passed) and the totals per direction.
* State the monitoring tier (`alertType`) of the assets found when it matters to the question (`CRITICAL` and `PRIORITY` first).
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

* Read-only: this skill calls `search_assets`, `get_lineage`, `get_pipeline_context` and `list_projects` only.
* Never report "not tracked" from an empty `get_lineage` alone. Read its `code`: only `NOT_FOUND` and `NO_LINEAGE` mean that, and `OUTSIDE_REQUEST` is common for a report opened monthly.
* Never pass an id from a URL as `uuid` to `get_lineage`. The id in a Looker Studio or Sheets URL is not the Masthead `uuid`; `search_assets` returns the right one.
* To find a table's writers, run history or cost, use `get_table_pipelines`; for open incidents on the assets you found, use the `masthead-incident-triaging` skill.

## Documentation

* [MCP tools reference: `search_assets`](https://docs.mastheadata.com/developer/mcp/tools#search_assets)
* [MCP tools reference: `get_lineage`](https://docs.mastheadata.com/developer/mcp/tools#get_lineage)
