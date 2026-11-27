---
name: masthead-asset-lineage
description: Find any asset Masthead knows — a BigQuery table, dataset or routine, a Looker dashboard, look or explore, a Looker Studio report, a Google Sheet, a Power BI report — from a URL, part of a name or an id, then trace its upstream sources and downstream consumers, using the Masthead MCP server tools `search_assets`, `get_lineage` and `get_pipeline_context`.
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

**Listing instead of searching.** Leave `query` out and set filters to list assets, ordered by project, dataset and name:

| Question | Call |
| --- | --- |
| What does this tenant have? | no `query`, no filters: `values` is empty and `extra.counts` has the number of assets per type |
| Which datasets are in a project? | `types = ["DATASET"]`, `project` |
| Which tables are in a dataset? | `types = ["TABLE"]`, `project`, `dataset`; add `tableTypes`, for example `["VIEW"]` |
| Which Looker Studio reports exist? | `types = ["LOOKER_STUDIO_REPORT"]` |
| Which dashboards and reports use this table? | `sourceTable = "project.dataset.table"`, `types` set to the BI types |
| Which assets are on a tier? | `alertTypes = ["CRITICAL", "PRIORITY"]`, with `project`, or with `types` that leave out `TABLE` |

A listing whose `types` is left out or includes `TABLE` needs `project` or `sourceTable`; without one the call is rejected. Every filter also narrows a search with a `query`. Page with `extra.nextOffset` as usual, and report `extra.counts` or the page size rather than paging through thousands of rows.

Looker Studio reports, Looker Studio data sources and Google Sheets have **no title** in Masthead: Masthead never reads the report itself, so their `name` is the id. Find them by URL or id. If the user only knows a report's title, ask for its URL.

### Step 2: Read the result

Each row in `values` is an asset, the same shape `get_pipeline_context` uses for sources and destinations. It always has `type`, `uuid` and `name`. Then come the fields of its kind: `project`, `dataset`, `table` and `tableType` for a table; `lookerId`, `title` and `url` for a Looker dashboard or look; `reportId` and `url` for a Looker Studio report; `docId` and `url` for a Google Sheet; `uri` for a URI. Then `lineageType`, `alertType`, `lastLineageAt`, `projectConnected`, `sourceProjects`, `deleted` and `hidden`, each only where it applies. A field with no value is left out, so treat a missing field as "none".

* **One row**: use it.
* **Several rows**: results are ordered exact match; then the asset's own name (the table of a table, the dataset of a dataset, a title) starting with the query; then its own name containing it; then a table that matches only through its dataset or project; then a match only in the id or URL. A common word still returns many tables: narrow it with `types` or `project`. Take an exact match when there is one. Otherwise show the user the top rows (`type`, `name`, `alertType`) and ask which one they mean. Don't pick one silently.
* **More pages**: `extra.nextOffset` is not null. Narrow the query or `types` before paging; call again with `offset = extra.nextOffset` only when the user needs the full list.
* **No rows**: read `code` and `error`, which say why, and pass the reason on to the user:

  | `code` | Meaning | What to say or do |
  | --- | --- | --- |
  | `NOT_FOUND` | nothing matches | a BI asset is known only after a BigQuery job labeled with its id ran in a connected project (`list_projects` shows them); a report nobody opened recently, or one that reads an unconnected project, is not known |
  | `PROJECT_NOT_CONNECTED` | the query is a table path in a project that is not connected, or was disconnected, and Masthead knows no table of that name there, not even a placeholder | name the project; a placeholder, when one exists, comes back as a result with `placeholder: true` |
  | `NO_METADATA` | lineage refers to the uuid, but Masthead has no row and no placeholder for it | `get_lineage` can still read its neighbours with the uuid; don't invent a name |

* **`score` and `percentile`** (tables and scored BI assets): `score` is how much the asset matters, and `percentile` is its rank from 0 to 100 among the tenant's assets of its type. Missing means the asset has no score. Use it to say which of several matches matters most.
* **`sourceTables`** (BI assets): the number of tables the asset read in the window, or in the last 30 days when you pass none. Zero or missing with an old `lastLineageAt` means the asset has not been used lately.
* **`columns` and `isAnomaly`** (tables): the column count, and whether an incident is open on the table now.
* **An error is not an empty result.** A timeout or a `503` says nothing about the asset: retry once, then report the error.
* **`sourceProjects`** (BI assets): the projects of the tables the asset reads. Compare it with `list_projects`: a project in the list that is not connected is a source Masthead can't see, so `get_lineage` shows those tables as named placeholders with a `reason`. Say which projects those are.
* **`projectConnected` is false** (tables, datasets, routines): the project was disconnected from Masthead. The asset's metadata and lineage are stale; say so.
* **`placeholder` is true** (tables, datasets): Masthead knows only the name, because the project isn't connected to Masthead, the table is a BigQuery system view, or the table was deleted. `placeholderCode` (`PROJECT_NOT_CONNECTED`, `PROJECT_DISCONNECTED`, `SYSTEM_VIEW`, `NO_TABLES_KNOWN` for a dataset in a connected project that Masthead knows only by name, with no table metadata, or `TABLE_DELETED` for a deleted table that something still reads, kept by name while a view reads it or a job read it in the last 90 days) and `reason` say which. The asset has no columns, score, or tier, and no `tableType` except `SYSTEM_VIEW`. A `TABLE_DELETED` table, like any deleted table, is found in search only by uuid or exact name. Pass `reason` on to the user and don't invent details about the table.
* **`deleted` or `hidden` is true**: the table existed and is gone, or is a temporary table. Say so before reading its lineage.

### Step 3: Choose the lineage window

`get_lineage` reads only the **last 7 days** unless you pass a window. `lastLineageAt` from `search_assets` tells you whether that is enough:

| `lastLineageAt` | What to do |
| --- | --- |
| within the last 7 days | call `get_lineage` with no window |
| older | pass `from`, a day before `lastLineageAt`. `from` alone reads up to now; add `to` only to cut the window short. Tell the user the asset's last activity date |
| missing | the asset has no lineage in Masthead. Don't call `get_lineage`; say that no job read or wrote it in a connected project |

To check a specific period for several assets at once, pass `from` (and `to` if needed) to `search_assets`: the same assets come back, and `lastLineageAt` is then the latest edge inside that window, missing when there is none. Leave them out for the first search, so an asset last active long ago still shows when.

No `lineageType` (datasets, Looker Studio data sources) means the asset is not a lineage node: there is nothing to trace from it. For a dataset, list its tables instead: `search_assets` with `types = ["TABLE"]`, `project` and `dataset`.

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
* `value.pages.upstream.total` and `value.pages.downstream.total` are the full counts of neighbours (a table read through several pipelines counts once); always report them. Each direction returns the 100 most recently active neighbours. When `nextOffset` is not null and the rest matters, call again with that `direction` and `offset = nextOffset`; otherwise say the list is partial.
* **No neighbours**: read `code` and `error` before concluding anything. `get_lineage` always returns the node you asked for, so an empty response alone proves nothing.

  | `code` | What it means | What to do |
  | --- | --- | --- |
  | `NOT_FOUND` | no asset has this uuid | you passed an id that is not a Masthead `uuid`: go back to Step 1 |
  | `WRONG_TYPE` | the uuid is another asset type | call again with the `type` that `error` names. This one code can also come with neighbours: the node you asked for is then unnamed, so still call again |
  | `NO_LINEAGE` | the asset exists, never had lineage | report that; there is nothing to trace |
  | `OUTSIDE_REQUEST` | lineage exists, none in this window or filter | `error` gives the last lineage time: pass `from`, a time before it, or drop `direction` / `nodeTypes` |
  | `NO_METADATA` | lineage refers to the uuid, Masthead has no row and no placeholder for it | lineage exists but none matched this call: pass `from`, a time before the one in `error`, or drop `direction` / `nodeTypes`. The node itself has no name: report it as an unnamed table (deleted, or not collected yet in a connected project) |

* **Pipelines between assets**: lineage shows the pipeline that connects two assets, with its uuid. To learn what it is, call `get_pipeline_context` with `pipelineUuid` = that uuid: who runs it, its SQL, whether it runs on schedule (`runs.total` against `runs.expected`), its last error, cost, and open incidents. Use it when the user asks why a table changed or stopped updating, not for every edge. It reads the last 7 days by default, like `get_lineage`: pass the same `from` (and `to`, if you set one) you used there, or `runs.total`, `cost` and `consumers` cover the wrong period. A section that is missing means nothing was found, unless `errors` names it: that part could not be read. Then say so instead of reporting "none" (for example "open incidents could not be read"), and retry `runs`, `tags`, `cost`, `consumers` or `incidents` alone with `sections`. Its `sources`, `destinations` and `consumers` are assets in the `search_assets` shape, so their `uuid` and `lineageType` go straight to `get_lineage`. When a destination table has `isAnonymous: true` the pipeline is an ad-hoc query that writes no permanent table: report it as a one-off query by its principal, not as a table's writer.
* **Open incidents on the way**: a table or pipeline node whose `asset.isAnomaly` is true has an open incident. Name those nodes first when the question is about impact or a root cause; `list_incidents` has the incidents themselves.
* **Who queries a BI asset**: call `get_lineage` on the dashboard, report or sheet with `direction = "UPSTREAM"`. Next to the source tables, the response has `PIPELINE` nodes: the BigQuery jobs that ran for the asset. Each one's `asset` has `sourceProject` (the project the jobs run and are billed in), `principalEmail` (the service account or user that ran them) and `pipelineType`. List the distinct projects and principals. `nodeTypes = ["TABLE"]` keeps these pipeline nodes, since it filters the tables, not the pipelines between. This is different from `sourceProjects` in `search_assets`, which names the projects of the tables the asset reads.
* **Walk further** by passing a neighbour's `uuid` and `nodeType` as `uuid` and `type`. Keep the same `from` (and `to`, if you set one) on every hop. Go at most as deep as the question needs, and say how many hops you read.
* **A node with `info: null`** (its `asset.type` is `OTHER` and `asset.name` is the uuid) is a table Masthead has lineage for but no row at all: it was deleted, or it is not collected yet. A table in a project that is not connected comes with `placeholder: true` and a `reason` instead. Call `search_assets` with its `uuid` once; if that returns nothing, report it as "unnamed table (`uuid`)" with those possible reasons. Don't invent a name.
* **A Looker Studio node whose `asset.type` is `LOOKER_STUDIO_DATASOURCE`** is a data source queried outside a report, in the data source editor or the explorer. Report it as the data source, with its `url`, not as a report.

### Step 5: Report

* Name each asset the way the user would recognise it: `project.dataset.table` for a table, `name` and `url` for a BI asset (for Looker Studio and Sheets the URL is the name).
* Give the window you read ("last 7 days", or the `from` you passed) and the totals per direction.
* State the monitoring tier (`alertType`) of the assets found when it matters to the question (`CRITICAL` and `PRIORITY` first).
* State only what the tools returned. Masthead lineage is built from observed jobs: no upstream in the window means no job wrote the table in that window, not that the table has no sources.

## Examples

**"Which tables feed this dashboard? `https://lookerstudio.google.com/reporting/<id>/page/abc`"**

1. `search_assets(query = "<the URL>")` → one `LOOKER_STUDIO_REPORT` row; note `uuid`, `lineageType`, `lastLineageAt`.
2. `lastLineageAt` is a month old → `get_lineage(uuid, type = "LOOKER_STUDIO_REPORT", direction = "UPSTREAM", nodeTypes = ["TABLE"], from = <a day before lastLineageAt>)`.
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
* [MCP tools reference: `get_pipeline_context`](https://docs.mastheadata.com/developer/mcp/tools#get_pipeline_context)
