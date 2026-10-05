---
name: masthead-data-scans
description: Set up a data quality scan end to end — define a metric with the user, materialize it as a BigQuery table in a `masthead_dq` dataset with a scheduled query that keeps it current, give Masthead read access to that dataset only, then validate and create the scan through the Masthead MCP server. Also lists, pauses, updates, and deletes existing scans. Every BigQuery change and every scan change runs only on explicit confirmation.
compatibility: Requires the Masthead MCP server at `https://mcp.mastheadata.com/mcp` (US region) and the `bq` CLI signed in to the customer's Google Cloud project, with permission to create datasets, tables, and scheduled queries (BigQuery Data Transfer API).
---

# Data Scans

## Purpose

Add a data quality scan to Masthead end to end. The user describes a metric; the skill turns it into a query that follows Masthead's contract, materializes the results in a table in a dedicated `masthead_dq` dataset in the user's project, schedules a query that adds each closed period to that table, gives Masthead read access to that dataset only, and creates the scan through the Masthead MCP server. Masthead then reads the table on a schedule, learns the expected range of every metric, and raises a data quality incident when a value falls outside it. Masthead never reads the source tables. The skill also lists, pauses, updates, and deletes existing scans.

## Operating Modes

* **Recommendation Mode (Default)**: read-only. Writes the metric SQL, runs the local checks with the user's credentials, and shows the setup plan. Calls only `list_projects` and `list_data_scans` (and `create_data_scan` with `dryRun=true` for a scan table that already exists). No DDL, no `bq` write, no scan change.
* **Action Mode**: runs each customer-side step (dataset, table, scheduled refresh, grant), the real scan creation, and every update or delete — **each only after the user's explicit yes for that step**. A yes for one step never covers the next.

## How Masthead runs a data scan

* Masthead runs `SELECT * FROM <scan table> WHERE timestamp >= <window start>` as `masthead-quality-checks@masthead-prod.iam.gserviceaccount.com`, in Masthead's project and at Masthead's cost. The scheduled refresh runs in the user's project.
* Every run adds its own time filter, so the table keeps its history; nothing deletes old periods.
* Each `(table_reference, rule_name)` pair is one series. Masthead resamples it to the scan frequency, learns its expected range, and flags values outside it as well as periods with no row at all.
* The first run starts as soon as the scan is created, backfills the last 14 days, and sends no notifications. Its results appear within a few minutes on the scan's page and the monitored table's page in Masthead. Later anomalies raise data quality incidents, which follow the tenant's alert settings.
* Masthead only reads closed periods — the in-progress period (today, for a `DAILY` scan) is never fetched; a period is read on a run after it has closed. `processDelayHours` adds extra wait after that close. **The scheduled refresh must finish within that delay**, or Masthead finds no row for the period and flags it as missing.
* Data scans are available in the US region only.

## Scan table contract

The scan table has these columns; extra columns are ignored. Examples and the refresh template: [references/table-contract.md](references/table-contract.md).

| Column | Type | Rule |
| --- | --- | --- |
| `table_reference` | `STRING` | `project.dataset.table` of the monitored table the metric describes; incidents attach to it |
| `rule_name` | `STRING` | Stable metric name; it becomes the incident's metric and cannot be renamed later |
| `timestamp` | `TIMESTAMP` | Start of the period: `TIMESTAMP_TRUNC(<column>, DAY)` or `TIMESTAMP(<date column>)` |
| `value` | `INT64`, `FLOAT64`, `NUMERIC`, `BIGNUMERIC` | The metric. Ratios as percents (0–100), because the learned range is very wide for values under 25 |

* One row per `table_reference`, `rule_name`, and period; no NULLs.
* **A row for every series in every period**, including zero values. A series that stops getting rows is flagged as missing every period. Never decide which series to keep with a rolling-window filter (for example "spend over the last 30 days ≥ $1"): a series that drops under it vanishes and alerts daily. Filter on something stable, or keep low-value series.
* At least 14 days of history when the scan is created.
* Aggregated metrics only — never store raw rows.
* All source tables in one BigQuery location, the same as the `masthead_dq` dataset.
* At most 1,000 series per scan.
* Partition the table by `timestamp` (day) and cluster by `table_reference, rule_name`, so Masthead's reads stay cheap.

## Workflow

### Step 0: Preconditions

1. If the `create_data_scan` tool is not available, stop: "Data scans are available in the US region only." Don't look for workarounds.
2. `list_projects`: the project that will hold the scan table must be listed. If it isn't, stop and tell the user to connect that project to Masthead first.
3. `bq ls --project_id=<project>` must succeed. If it doesn't, ask the user to run `gcloud auth login` and retry.
4. `bq ls --transfer_config --transfer_location=<location> --project_id=<project>` must succeed. If it fails because the BigQuery Data Transfer API is off, ask the user to enable it (`gcloud services enable bigquerydatatransfer.googleapis.com --project=<project>`) — an Action Mode step that needs its own yes. If the user already schedules SQL with dbt, Dataform, or Airflow, offer to add the refresh there instead and skip the scheduled query.
5. `list_data_scans`: show the existing scans, so a new name doesn't clash and an existing scan isn't recreated.

### Step 1: Define the metric

Agree with the user on: the monitored table or tables, the metric or metrics, the frequency (`HOURLY`, `EVERY_6_HOURS`, `EVERY_12_HOURS`, `DAILY`), the scan name, and the scan table name (snake_case, for example `orders_daily_volume`). Write the **metric SQL** to the contract above, with one placeholder window on the source's time column: `<time column> >= <from> AND <time column> < <to>`. Read the source by its partition column where possible, so each refresh stays cheap. From it, derive:

* **History SQL**: the window is the last 30 closed periods, for the initial table.
* **Refresh SQL**: a `MERGE` of the last 3 closed periods into the table, from the template in [references/table-contract.md](references/table-contract.md). Recomputing 3 periods every run fills in late source data and recovers from a missed run.

### Step 2: Local checks (read-only)

Run with the user's credentials and fix every failure before any DDL:

1. Dry runs of the history SQL and the refresh SQL's `USING` query, and report the bytes each would process:

   ```bash
   bq query --use_legacy_sql=false --dry_run '<history SQL>'
   ```

2. Contract check over the history SQL:

   ```sql
   SELECT
     COUNT(*) AS row_count,
     COUNT(DISTINCT CONCAT(table_reference, '|', rule_name)) AS series,
     COUNT(DISTINCT `timestamp`) AS periods,
     MIN(`timestamp`) AS min_timestamp,
     MAX(`timestamp`) AS max_timestamp,
     COUNTIF(NOT REGEXP_CONTAINS(table_reference, r'^[^.]+\.[^.]+\.[^.]+$')) AS malformed_table_references,
     COUNTIF(table_reference IS NULL OR rule_name IS NULL OR `timestamp` IS NULL OR value IS NULL) AS null_rows,
     COUNTIF(`timestamp` > CURRENT_TIMESTAMP()) AS future_rows
   FROM (<history SQL>)
   ```

   `row_count` must be above 0, `malformed_table_references` and `null_rows` must be 0, `series` at most 1,000, and `min_timestamp` should reach back at least 14 days. `row_count` should equal `series × periods`; if it is lower, some series miss periods — zero-fill them (see the reference) or agree with the user that those gaps are real. Raise `future_rows` above 0 with the user.

3. Read the location of every source dataset with `bq show --format=prettyjson <project>:<dataset>` (the `location` field). They must all match.

### Step 3: Setup plan, then apply on confirmation

Show the whole plan first, then apply one step at a time after the user's yes. Offer native SQL DDL first, then Terraform, then `bq` commands. If the user manages BigQuery in Terraform, give only the Terraform version so their state doesn't drift.

1. Dataset:

   ```sql
   CREATE SCHEMA IF NOT EXISTS `<project>.masthead_dq`
   OPTIONS (location = '<location>', description = 'Tables read by Masthead data scans');
   ```

2. Scan table with its history. If a table with that name already exists, stop and ask — never replace a table the skill didn't create in this session.

   ```sql
   CREATE TABLE `<project>.masthead_dq.<table_name>`
   PARTITION BY TIMESTAMP_TRUNC(`timestamp`, DAY)
   CLUSTER BY table_reference, rule_name
   AS
   <history SQL>;
   ```

3. Scheduled refresh. Start from the schedule for the frequency below: each run starts shortly after a period closes, so it finishes well inside the default `processDelayHours` (Step 5). Schedules are in UTC, like the periods. **Then check when the source tables update** (`lastModifiedTime` in `bq show --format=prettyjson <project>:<dataset>.<table>`, or the latest jobs that write them). If a source is rebuilt later than the schedule, move the refresh after that rebuild — still inside the processing delay — or the refresh reads an incomplete period:

   | Frequency | Schedule | Default delay |
   | --- | --- | --- |
   | `DAILY` | `every day 01:00` | 12 h |
   | `EVERY_12_HOURS` | `every 12 hours from 00:30 to 23:59` | 6 h |
   | `EVERY_6_HOURS` | `every 6 hours from 00:30 to 23:59` | 3 h |
   | `HOURLY` | `every 1 hours from 00:15 to 23:59` | 1 h |

   ```bash
   bq mk --transfer_config \
     --project_id=<project> \
     --location=<location> \
     --data_source=scheduled_query \
     --display_name='masthead_dq <table_name> refresh' \
     --schedule='every day 01:00' \
     --params='{"query":"<refresh SQL, as one JSON string>"}'
   ```

   Terraform: a `google_bigquery_data_transfer_config` with `data_source_id = "scheduled_query"` and `params = { query = <refresh SQL> }`. The scheduled query runs as the user who creates it; recommend `--service_account_name=<service account>` (with BigQuery Data Editor on `masthead_dq`, Data Viewer on the sources, and Job User on the project), so the refresh doesn't stop when that user's access changes. Before creating it, check `bq ls --transfer_config` for one with the same display name.

   The first scheduled query a user creates with `bq mk --transfer_config` needs a one-time browser consent for BigQuery Data Transfer, which an agent's shell can't complete (`bq` stops with "Got EOF"). Say so before this step, and offer two ways: the user runs that one command themselves (in Claude Code, type it after `!`) and opens the consent link it prints, or the query runs as a service account (`--service_account_name`), which needs no consent. Then confirm the result with `bq ls --transfer_config`.

4. Read access for Masthead on that dataset only:

   ```sql
   GRANT `roles/bigquery.dataViewer` ON SCHEMA `<project>.masthead_dq`
   TO "serviceAccount:masthead-quality-checks@masthead-prod.iam.gserviceaccount.com";
   ```

   Masthead reads only the scan table, so the source datasets need no change.

### Step 4: Masthead-side dry run

Call `create_data_scan` with `table` (`<project>.masthead_dq.<table_name>`), `name`, `frequency`, optional `processDelayHours`, and `dryRun=true`. Show the summary: rows, tables, metrics, series, time range, bytes processed, warnings. Map an error to its fix:

| The error says | Fix |
| --- | --- |
| Masthead cannot read the table | The Step 3.4 grant is missing |
| missing column or wrong type | Fix the history SQL and the refresh SQL to the contract, and recreate the table |
| no rows, NULLs, or a malformed `table_reference` | Fix the SQL and rerun Step 2 |
| the project is not connected to Masthead | Use a project from `list_projects` |
| a scan with that name already exists | Pick another name, or manage the existing scan |

### Step 5: Create (Action Mode)

After the user's yes, call `create_data_scan` with the same arguments and `dryRun=false`. Keep the default `processDelayHours` unless the refresh query takes longer than that to run; then set it above the refresh's run time. Report the scan `id` with its Masthead link, `https://app.mastheadata.com/data-quality/data-scans/<id>`, that the first run starts right away and backfills 14 days without notifications, and that anomalies arrive as data quality incidents in Masthead. Right after creation, `nextProcessingDatetime` is a placeholder one hour ahead, not the first run: that run is already in progress, its results appear on the scan's page within a few minutes, and `nextProcessingDatetime` then moves to the next period.

### Step 6: Manage existing scans

* List: `list_data_scans`. Only scans with `source` `API` can be changed; `MANUAL` scans were set up by Masthead.
* `update_data_scan` and `delete_data_scan` take the scan's `scanId` — the `id` from `list_data_scans`.
* Pause or resume: `update_data_scan` with `active` set to `false` or `true`. A paused scan doesn't stop the scheduled refresh.
* Processing delay: `update_data_scan` with `processDelayHours`.
* Metric logic: change the refresh SQL of the scheduled query (`bq update --transfer_config --params='{"query":"…"}' <transfer config name>`). The scan keeps its stored history, so old and new values mix in one series; to avoid that, create a new scan table and point the scan at it.
* Table or frequency: `update_data_scan` with `table` or `frequency` **deletes the scan's history and incidents** and analyzes it again from scratch; warn first. A new frequency also needs a new refresh schedule.
* Delete: `delete_data_scan`, one scan per confirmation. It removes the scan's results and open incidents; the scan table and the scheduled query stay. Offer to remove them too (`bq rm --transfer_config <transfer config name>`, then `DROP TABLE`), each with its own yes.
* Scan names can't be changed.

## Guardrails

* Masthead's service account gets access to the `masthead_dq` dataset only — never grant it anything on source datasets or projects.
* Scan tables hold aggregated metrics, never raw rows.
* Never write to a source table, and never drop or replace a dataset, table, or scheduled query the skill didn't create in this session. Only the scheduled refresh writes to the scan table.
* Never call `create_data_scan` with `dryRun=false` before a successful dry run of the same arguments.
* Every DDL statement, `bq mk`, `bq update`, `bq rm`, scan creation, update, and deletion needs its own explicit yes. A reply that is not a clear yes — a typo, another question, a partial answer — is not one: ask again before acting.
* End with a numbered list of next steps: what was created and where (dataset, table, scheduled query, grant, scan), how to check it (the scan's link, `https://app.mastheadata.com/data-quality/data-scans/<id>`, or `list_data_scans`), and how to undo it.

## Documentation

* [Data scans](https://docs.mastheadata.com/governance/data-quality-scans#custom-data-scans)
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools)
* [BigQuery scheduled queries](https://cloud.google.com/bigquery/docs/scheduling-queries)
