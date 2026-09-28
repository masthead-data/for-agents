---
name: masthead-custom-data-scans
description: Set up a custom data quality scan end to end — define a metric with the user, publish it as a BigQuery view in a `masthead_dq` dataset, give Masthead read access to that dataset only, then validate and create the scan through the Masthead MCP server. Also lists, pauses, updates, and deletes existing custom scans. Every BigQuery change and every scan change runs only on explicit confirmation.
compatibility: Requires the Masthead MCP server at `https://mcp.mastheadata.com/mcp` (US region) and the `bq` CLI signed in to the customer's Google Cloud project, with permission to create datasets and views and to change access on the source datasets.
---

# Custom Data Scans

## Purpose

Add a custom data quality scan to Masthead end to end. The user describes a metric; the skill turns it into a BigQuery view that follows Masthead's contract, publishes it in a dedicated `masthead_dq` dataset in the user's project, gives Masthead read access to that dataset only, and creates the scan through the Masthead MCP server. Masthead then reads the view on a schedule, learns the expected range of every metric, and raises a data quality incident when a value falls outside it. The skill also lists, pauses, updates, and deletes existing custom scans.

## Operating Modes

* **Recommendation Mode (Default)**: read-only. Writes the view SQL, runs the local checks with the user's credentials, and shows the setup plan. Calls only `list_projects` and `list_custom_data_scans` (and `create_custom_data_scan` with `dryRun=true` for a view that already exists). No DDL, no `bq` write, no scan change.
* **Action Mode**: runs each customer-side step (dataset, view, grant, dataset authorization), the real scan creation, and every update or delete — **each only after the user's explicit yes for that step**. A yes for one step never covers the next.

## How Masthead runs a custom scan

* Masthead runs `SELECT * FROM <view> WHERE timestamp >= <window start>` as `masthead-quality-checks@masthead-prod.iam.gserviceaccount.com`, in Masthead's project and at Masthead's cost.
* Every run adds its own time filter, so the view must never filter to a fixed date.
* Each `(table_reference, rule_name)` pair is one series. Masthead resamples it to the scan frequency (rows in the same period are summed), learns its expected range, and flags values outside it as well as periods with no row at all.
* The first run starts within about 10 minutes of creation, backfills the last 14 days, and sends no notifications. Later anomalies raise data quality incidents, which follow the tenant's alert settings.
* Custom data scans are available in the US region only.

## View contract

The view returns these columns; extra columns are ignored. Examples: [references/view-contract.md](references/view-contract.md).

| Column | Type | Rule |
| --- | --- | --- |
| `table_reference` | `STRING` | `project.dataset.table` of the monitored table the metric describes; incidents attach to it |
| `rule_name` | `STRING` | Stable metric name; it becomes the incident's metric and cannot be renamed later |
| `timestamp` | `TIMESTAMP` | Start of the period: `TIMESTAMP_TRUNC(<column>, DAY)` or `TIMESTAMP(<date column>)` |
| `value` | `INT64`, `FLOAT64`, `NUMERIC`, `BIGNUMERIC` | The metric. Ratios as percents (0–100), because the learned range is very wide for values under 25 |

* One row per `table_reference`, `rule_name`, and period; no NULLs.
* No fixed date filter; at least 14 days of history.
* Aggregated metrics only — never expose raw rows.
* All source tables in one BigQuery location, the same as the `masthead_dq` dataset.
* At most 1,000 series per scan.

## Workflow

### Step 0: Preconditions

1. If the `create_custom_data_scan` tool is not available, stop: "Custom data scans are available in the US region only." Don't look for workarounds.
2. `list_projects`: the project that will hold the view must be listed. If it isn't, stop and tell the user to connect that project to Masthead first.
3. `bq ls --project_id=<project>` must succeed. If it doesn't, ask the user to run `gcloud auth login` and retry.
4. `list_custom_data_scans`: show the existing scans, so a new name doesn't clash and an existing scan isn't recreated.

### Step 1: Define the metric

Agree with the user on: the monitored table or tables, the metric or metrics, the frequency (`HOURLY`, `EVERY_6_HOURS`, `EVERY_12_HOURS`, `DAILY`), the scan name, and the view name (snake_case, for example `orders_daily_volume`). Write the view SQL to the contract above. Read the source by its partition column where possible, so each run stays cheap.

### Step 2: Local checks (read-only)

Run with the user's credentials and fix every failure before any DDL:

1. Dry run of the view SQL, and report the bytes it would process:

   ```bash
   bq query --use_legacy_sql=false --dry_run '<view SQL>'
   ```

2. Contract check over the first-run window:

   ```sql
   SELECT
     COUNT(*) AS row_count,
     COUNT(DISTINCT CONCAT(table_reference, '|', rule_name)) AS series,
     MIN(`timestamp`) AS min_timestamp,
     MAX(`timestamp`) AS max_timestamp,
     COUNTIF(NOT REGEXP_CONTAINS(table_reference, r'^[^.]+\.[^.]+\.[^.]+$')) AS malformed_table_references,
     COUNTIF(table_reference IS NULL OR rule_name IS NULL OR value IS NULL) AS null_rows,
     COUNTIF(`timestamp` > CURRENT_TIMESTAMP()) AS future_rows
   FROM (<view SQL>)
   WHERE `timestamp` >= TIMESTAMP_SUB(TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY), INTERVAL 14 DAY)
   ```

   `row_count` must be above 0, `malformed_table_references` and `null_rows` must be 0, `series` at most 1,000, and `min_timestamp` should reach back about 14 days. Raise `future_rows` above 0 with the user.

3. Read the location of every source dataset with `bq show --format=prettyjson <project>:<dataset>` (the `location` field). They must all match.

### Step 3: Setup plan, then apply on confirmation

Show the whole plan first, then apply one step at a time after the user's yes. Offer native SQL DDL first, then Terraform, then `bq` commands. If the user manages BigQuery IAM in Terraform, give only the Terraform version so their state doesn't drift.

1. Dataset:

   ```sql
   CREATE SCHEMA IF NOT EXISTS `<project>.masthead_dq`
   OPTIONS (location = '<location>', description = 'Views read by Masthead custom data scans');
   ```

2. View:

   ```sql
   CREATE OR REPLACE VIEW `<project>.masthead_dq.<view_name>` AS
   <view SQL>;
   ```

3. Read access for Masthead on that dataset only:

   ```sql
   GRANT `roles/bigquery.dataViewer` ON SCHEMA `<project>.masthead_dq`
   TO "serviceAccount:masthead-quality-checks@masthead-prod.iam.gserviceaccount.com";
   ```

4. Authorize `masthead_dq` on each source dataset. BigQuery has no DDL for this. Skip datasets that already list it.

   Terraform:

   ```hcl
   resource "google_bigquery_dataset_access" "masthead_dq_on_<source_dataset>" {
     project    = "<source_project>"
     dataset_id = "<source_dataset>"
     dataset {
       dataset {
         project_id = "<project>"
         dataset_id = "masthead_dq"
       }
       target_types = ["VIEWS"]
     }
   }
   ```

   `bq`:

   ```bash
   bq show --format=prettyjson <source_project>:<source_dataset> > source_dataset.json
   # Add this entry to the "access" list:
   # {"dataset": {"dataset": {"projectId": "<project>", "datasetId": "masthead_dq"}, "targetTypes": ["VIEWS"]}}
   bq update --source source_dataset.json <source_project>:<source_dataset>
   ```

   `bq update --source` replaces the whole access list: re-read the dataset right before editing and show the user the `access` diff before running it.

### Step 4: Masthead-side dry run

Call `create_custom_data_scan` with `view`, `name`, `frequency`, optional `processDelayHours`, and `dryRun=true`. Show the summary: rows, tables, metrics, series, time range, bytes processed, warnings. Map an error to its fix:

| The error says | Fix |
| --- | --- |
| Masthead cannot read the view | The Step 3.3 grant or a Step 3.4 authorization is missing |
| missing column or wrong type | Fix the view to the contract |
| no rows, NULLs, or a malformed `table_reference` | Fix the view SQL and rerun Step 2 |
| the project is not connected to Masthead | Use a project from `list_projects` |
| a scan with that name already exists | Pick another name, or manage the existing scan |

### Step 5: Create (Action Mode)

After the user's yes, call `create_custom_data_scan` with the same arguments and `dryRun=false`. Report the scan `id`, that the first run starts within about 10 minutes and backfills 14 days without notifications, and that anomalies arrive as data quality incidents in Masthead.

### Step 6: Manage existing scans

* List: `list_custom_data_scans`. Only scans with `source` `api` can be changed; `manual` scans were set up by Masthead.
* Pause or resume: `update_custom_data_scan` with `active` set to `false` or `true`.
* Processing delay: `update_custom_data_scan` with `processDelayHours`.
* View or frequency: `update_custom_data_scan` with `view` or `frequency`. Warn first: this **deletes the scan's history and incidents** and analyzes it again from scratch. When the metric logic changes, create a new view and point the scan at it instead of editing the view in place, so old and new logic don't mix in the history.
* Delete: `delete_custom_data_scan`, one scan per confirmation. It removes the scan's results and open incidents; the view stays, and the user can drop it themselves.
* Scan names can't be changed.

## Guardrails

* Masthead's service account gets access to the `masthead_dq` dataset only — never grant it anything on source datasets or projects.
* Views expose aggregated metrics, never raw rows.
* Never run DML, and never drop or replace a dataset or view the skill didn't create in this session.
* Never call `create_custom_data_scan` with `dryRun=false` before a successful dry run of the same arguments.
* Every DDL statement, `bq update`, scan creation, update, and deletion needs its own explicit yes.
* End with a numbered list of next steps: what was created and where, how to check it (`list_custom_data_scans`), and how to undo it.

## Documentation

* [Custom data scans](https://docs.mastheadata.com/governance/data-quality-scans#custom-data-scans)
* [MCP tools reference](https://docs.mastheadata.com/developer/mcp/tools)
