---
name: masthead-compute-savings-with-pipelines
description: Optimize BigQuery compute costs by identifying and pausing/disabling unused, dead-end, or inefficient pipelines that consume compute resources.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs and access dataset tables.
---

# Optimize Compute Costs (Pipeline Cleanup)

## Purpose

Identify and pause/disable data pipelines that consume BigQuery compute resources (slots, bytes billed) but are unused, dead-end, or inefficient, based on Masthead Data lineage and cost analysis.

## When to Use

- Reducing compute costs (slot usage or on-demand query costs) by eliminating wasted processing.
- Cleaning up legacy, unused, or orphaned pipelines that are still scheduled to run.
- Coordinating compute cleanup with storage cleanup (dropping the target tables).

## Prerequisites

- Verify the [Masthead Data integration](https://docs.mastheadata.com/get-started/integrate-using-iac) is version **v0.2.7+** (required for lineage data).

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated Disabling**: The agent **never** pauses Airflow DAGs, disables BigQuery Data Transfer Service jobs, or modifies live orchestration schedules directly. All deactivations must be verified and executed by the human operator.
- **Agent Role**: Query insights, investigate upstream triggers and downstream consumers, locate pipeline code in the repository, and generate concrete remediation diffs, review tables, or CLI commands for human review.

## Implementation Steps

### Step 0: Dataset Context

Resolve the Masthead insights dataset before querying. It always lives in the `masthead-prod` project; only the dataset name is per-tenant.

1. **Masthead MCP connected** (preferred): call `get_tenant_settings`. Use `insightsDataset.project` + `insightsDataset.dataset` as `<DATASET_NAME>` (for example `masthead-prod.mastheadata`). If `insightsDataset.enabled` is `false`, stop and tell the user BigQuery export is not enabled for their tenant ([request access](https://docs.mastheadata.com/api#get-access-to-bigquery-resources)). Cache the dataset in `~/.masthead/config.json` (or `.masthead/config.json` per the user's preference).
2. **No MCP**: check `$MASTHEAD_INSIGHTS_DATASET`, then global `~/.masthead/config.json`, then local `.masthead/config.json`. If none is set, ask the user once and cache it.

`YOUR_PROJECT` in the commands below is the **user's own GCP project** that bills and authorizes the `bq` jobs (`gcloud config get-value project`) — never `masthead-prod`, customers cannot run jobs there. Reference: [Masthead BigQuery API Overview](https://docs.mastheadata.com/developer/api.md), [Insights Table Reference](https://docs.mastheadata.com/developer/api/insights.md).

### Step 1: Query Compute Waste from Pipelines

A pipeline row is identified by the principal that runs it and the table it writes (`target_resource` = destination). There is no separate pipeline id in the export.

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  subtype,
  project_id,
  target_resource AS destination,
  SAFE.STRING(overview.destination_type) AS destination_type,
  SAFE.STRING(overview.resource_technology) AS technology,
  SAFE.STRING(overview.principal_name) AS principal,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  last_updated_time
FROM \`masthead-prod.<DATASET_NAME>.insights\`
WHERE category = 'Cost'
  AND type = 'Dead end'
  AND subtype IN ('Dead end pipeline', 'Leaf dead end pipeline')
ORDER BY savings_usd_30d DESC"
```

`Leaf dead end pipeline` writes a table nobody reads — directly actionable. `Dead end pipeline` feeds only other dead-end tables — re-evaluate after the leaf is gone. `technology` is Masthead's detected tool (`Dataform`, `DBT`, `Airflow`, `BQ DTS`, `Spark`, `Airbyte`, `Browser`, …) and picks the section in Step 3.

### Step 2: Review and Decide

Review the retrieved list of candidates. The user or agent can choose the most optimal format to store, present, or review these candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Decide on the action for each pipeline:

- `pause` — Safe to disable or pause this pipeline/job
- `keep` — Pipeline is needed (e.g., writing data that is read externally or via tools not tracked in lineage)
- `investigate` — Needs further analysis

**Review criteria:**

- **Lineage Gaps:** Does the target table have external consumers (e.g., connected sheets, BI tools, external APIs) that are not tracked in the lineage graph?
- **Code Search:** If the current working directory is a git repository, grep it for the destination table name; the `principal` (service account) usually narrows it to one orchestrator or CI job. If it is not a repository, ask the user which repository holds the pipeline instead of searching the filesystem.
- **Multiple Writers:** Check if other pipelines or manual queries write to the same table.

### Step 3: Generate Deactivation Artifacts (User-Executed)

> [!IMPORTANT]
> The agent does **not** pause or disable pipelines automatically. All changes must be reviewed and executed by a developer or operator.

Prepare the configuration diffs, commands, or documentation requested by the user for the corresponding orchestration technology:

#### Dataform

1. Locate the SQLX file defining the model in the repository (search for the destination table name).
2. Add `disabled: true` in the `config { ... }` block of the SQLX file:

   ```javascript
   config {
     type: "table",
     disabled: true,
     // other configs
   }
   ```

3. Run `dataform compile` to verify the configuration.

#### dbt

1. Locate the model SQL file in the dbt project that materializes the destination table.
2. Disable the model by adding `enabled: false` to its config block:

   ```sql
   {{ config(enabled=false) }}
   ```

   Or globally in `dbt_project.yml`:

   ```yaml
   models:
     your_project:
       path_to_model:
         +enabled: false
   ```

#### Airflow

1. Locate the DAG file whose task writes to the destination table (the `principal` is typically the Composer/Airflow service account).
2. If the entire DAG is unused or dead-end:
   - Pause the DAG in the Airflow UI, or
   - Set `is_paused_upon_creation=True` in the DAG definition in code.
3. If only a single task is unused or dead-end, comment out or remove the task from the DAG and update downstream dependencies.

#### BQ DTS (BigQuery Data Transfer Service)

1. List transfer configurations to locate the matching resource ID:

   ```bash
   bq ls --transfer_config --transfer_location=us
   ```

2. Disable the transfer config:

   ```bash
   bq update --transfer_config --is_disabled=true YOUR_TRANSFER_CONFIG_NAME_OR_RESOURCE_ID
   ```

#### Fivetran / Stitch / Airbyte

1. Log in to the service console (Fivetran, Stitch, or Airbyte UI).
2. Locate the connector or integration matching the source/destination target resource.
3. Pause or disable the sync schedule.

#### Custom / Undefined / Cron Pipelines

1. Locate the scheduler or job manager running the script/query (e.g., Cron, Jenkins, GitHub Actions, Cloud Scheduler).
2. Disable, pause, or remove the schedule.

### Step 4: Clean Up Target Tables (Storage Savings)

> [!IMPORTANT]
> Once a pipeline is paused/disabled, always drop the target table to stop storage costs. Pausing the pipeline *first* is critical: dropping a table while its producer is still active will result in the table being automatically recreated on the next scheduled run.
> Run `masthead-storage-savings-with-tables` to identify and drop the tables.

### Step 5: Verify Savings

1. Verify that the pipeline has stopped executing by checking the BigQuery job history for jobs by `principal` writing to the destination table.
2. Monitor compute savings in the Masthead UI after 24-48 hours.

## Related Optimizations

- **Table Cleanup**: Drop the orphan tables left behind by disabled pipelines (`masthead-storage-savings-with-tables`).
- **Compute Reservations**: Re-assign active pipelines to appropriate reservations or on-demand pricing (`masthead-compute-savings-with-workload-assignments`).

## Documentation

- [Masthead Compute Costs & Lineage](https://docs.mastheadata.com/cost-insights/compute-costs)
- [Disabling Dataform actions](https://cloud.google.com/dataform/docs/disable-action)
- [dbt Model configurations (enabled)](https://docs.getdbt.com/reference/resource-configs/enabled)
