---
name: masthead-compute-savings-with-dead-end-pipelines
description: Optimize BigQuery compute costs by identifying and pausing/disabling dead-end pipelines that consume compute resources but only feed into dead-end tables.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs and access dataset tables.
---

# Optimize Compute Costs (Dead-End Pipelines)

## Purpose

Identify and pause/disable data pipelines that consume BigQuery compute resources (slots, bytes billed) but only feed into dead-end or unused tables, based on Masthead Data lineage and cost analysis.

## When to Use

- Reducing compute costs (slot usage or on-demand query costs) by eliminating wasted processing.
- Cleaning up legacy or orphaned pipelines that are still scheduled to run.
- Coordinating compute cleanup with storage cleanup (dropping the target dead-end tables).

## Prerequisites

- Verify the [Masthead Data integration](https://docs.mastheadata.com/get-started/integrate-using-iac) is version **v0.2.7+** (required for lineage data).

## Implementation Steps

### Step 0: Configure Masthead Dataset

1. Ask the user for the BigQuery dataset where Masthead insights are stored. This dataset must contain an `insights` table with the same schema as `masthead-prod.YOUR_DATASET.insights`. If the user does not have access, direct them to [request access](https://docs.mastheadata.com/api#get-access-to-bigquery-resources).

   Once provided, **immediately persist it** by appending to the project-level agent instructions file (e.g. `AGENTS.md`, `.github/copilot-instructions.md` — whichever already exists in the project root, or create `AGENTS.md` if none exist). Append inside `<!-- masthead -->` fences so existing content is not disturbed:

   ```
   <!-- masthead -->
   MASTHEAD_DATASET=YOUR_DATASET
   <!-- /masthead -->
   ```

   On subsequent runs, read this value from the instructions file instead of prompting the user again.

### Step 1: Query Compute Waste from Dead-End Pipelines

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  subtype,
  project_id,
  target_resource,
  JSON_VALUE(overview, '$.technology') AS technology,
  JSON_VALUE(overview, '$.model_id') AS model_id,
  JSON_VALUE(overview, '$.masthead_pipeline_id') AS masthead_pipeline_id,
  SAFE_CAST(JSON_VALUE(overview, '$.cost_30d') AS FLOAT64) AS cost_usd_30d,
  SAFE_CAST(JSON_VALUE(overview, '$.savings_30d') AS FLOAT64) AS savings_usd_30d,
  SAFE_CAST(JSON_VALUE(overview, '$.billed_slot_ms_30d') AS INT64) AS billed_slot_ms_30d,
  SAFE_CAST(JSON_VALUE(overview, '$.billed_bytes_30d') AS INT64) AS billed_bytes_30d,
  last_updated_time
FROM \`masthead-prod.YOUR_DATASET.insights\`
WHERE category = 'Cost'
  AND type = 'Dead end'
  AND subtype = 'Dead end pipeline'
ORDER BY savings_usd_30d DESC"
```

### Step 2: Review and Decide

Review the retrieved list of candidates. The user or agent can choose the most optimal format to store, present, or review these candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Decide on the action for each pipeline:

- `pause` — Safe to disable or pause this pipeline/job
- `keep` — Pipeline is needed (e.g., writing data that is read externally or via tools not tracked in lineage)
- `investigate` — Needs further analysis

**Review criteria:**

- **Lineage Gaps:** Does the target table have external consumers (e.g., connected sheets, BI tools, external APIs) that are not tracked in the lineage graph?
- **Code Search:** Search the repository to locate where the pipeline/model is defined (e.g., search for the table name or `model_id` / `masthead_pipeline_id`).
- **Multiple Writers:** Check if other pipelines or manual queries write to the same table.

### Step 3: Pause/Disable the Pipelines

Based on the pipeline's technology, apply the corresponding action for each candidate marked for deactivation:

#### Dataform
1. Locate the SQLX file defining the model in the repository (e.g., search for `name: "model_id"` or `target_resource` table name).
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
1. Locate the model YAML or SQL file in the dbt project matching `model_id`.
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
1. Locate the DAG file defining the workflow matching `model_id` or the task writing to `target_resource`.
2. If the entire DAG is dead-end:
   - Pause the DAG in the Airflow UI, or
   - Set `is_paused_upon_creation=True` in the DAG definition in code.
3. If only a single task is dead-end, comment out or remove the task from the DAG and update downstream dependencies.

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
> Once a pipeline is paused/disabled, always drop the target dead-end table to stop storage costs. Pausing the pipeline *first* is critical: dropping a table while its producer is still active will result in the table being automatically recreated on the next scheduled run.
> Run `masthead-storage-savings-with-tables` to identify and drop the tables.

### Step 5: Verify Savings

1. Verify that the pipeline has stopped executing by checking the BigQuery job history for references to `target_resource` or `model_id`.
2. Monitor compute savings in the Masthead UI after 24-48 hours.

## Related Optimizations

- **Table Cleanup**: Drop the orphan tables left behind by disabled pipelines (`masthead-storage-savings-with-tables`).
- **Compute Reservations**: Re-assign active pipelines to appropriate reservations or on-demand pricing (`masthead-compute-savings-with-data-models`).

## Documentation

- [Masthead Compute Costs & Lineage](https://docs.mastheadata.com/cost-insights/compute-costs)
- [Disabling Dataform actions](https://cloud.google.com/dataform/docs/disable-action)
- [dbt Model configurations (enabled)](https://docs.getdbt.com/reference/resource-configs/enabled)
