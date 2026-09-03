---
name: masthead-compute-savings-with-data-models
description: Optimize BigQuery compute costs by assigning data models (Dataform, dbt, Airflow) to slot reservations or on-demand compute based on Masthead recommendations.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access data, and view reservations.
---

# Optimize Orchestration Compute (BigQuery Reservations)

## Purpose

Automatically assign data models from data orchestration to BigQuery slot reservations based on compute complexity and cost optimization strategy. Routes high-compute workloads to on-demand capacities while using reservations pricing for high-traffic jobs.

## When to Use

- Assigning new models/actions to appropriate compute tiers (reserved vs on-demand)
- Rebalancing reservation assignments based on priority changes
- Optimizing costs by moving low-priority workloads to on-demand
- Ensuring critical pipelines get guaranteed compute resources

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated Configuration Changes**: The agent **never** alters reservation assignments or modifies repo files (`definitions/_reservations.js`, `dbt_project.yml`) directly without explicit human direction.
- **Agent Role**: Query insights for compute model recommendations, calculate workload trade-offs between slot editions and on-demand, verify reservation capacity, and prepare proposed configuration diffs or review tables for human approval.

## Implementation Steps

### Step 0: Dataset Context

Ensure access to your Masthead insights dataset in BigQuery:

- **Location**: Exported under `masthead-prod.<DATASET_NAME>.insights` (see [Masthead BigQuery API Overview](https://docs.mastheadata.com/developer/api.md) and [Insights Table Reference](https://docs.mastheadata.com/developer/api/insights.md)).
- **Resolution**: Check `$MASTHEAD_INSIGHTS_DATASET`, global `~/.masthead/config.json`, or local `.masthead/config.json`. If not set, ask the user once and cache it per their preference (global `~/.masthead/config.json` recommended).

### Step 1: Detect Orchestration Technology

Identify which orchestration technology is in use by querying available recommendations:

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT subtype, COUNT(*) AS recommendation_count
FROM \`masthead-prod.YOUR_DATASET.insights\`
WHERE category = 'Cost'
  AND type = 'Compute costs'
GROUP BY subtype"
```

If compute model recommendations are not present or all rows share the same technology, infer from the user's project structure (presence of `dbt_project.yml` → dbt, `definitions/` folder → Dataform, Airflow DAG files → Airflow). Confirm the detected tool with the user before proceeding.

### Step 2: Pull Recommendations

Pull recommendations from `masthead-prod.YOUR_DATASET.insights`:

Replace the `subtype` value with the one detected in step 1 (e.g. `'Re-assign reservation for Dataform models'`, `'Re-assign reservation for dbt models'`, or `'Re-assign reservation for Airflow DAGs'`).

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  JSON_VALUE(m, '$.model_id') AS action_name,
  JSON_VALUE(op, '$.recommended_compute_model') AS recommended_model,
  -- CAST(JSON_VALUE(overview, '$.cost_30d') AS FLOAT64) AS cost_30d,
  last_updated_time
FROM \`masthead-prod.YOUR_DATASET.insights\`,
  UNNEST(JSON_QUERY_ARRAY(operations)) AS op,
  UNNEST(JSON_QUERY_ARRAY(op, '$.models')) AS m
WHERE category = 'Cost'
  AND type = 'Compute costs'
  AND subtype = 'Re-assign reservation for Dataform models'
--ORDER BY cost_30d DESC
"
```

### Step 3: Resolve Reservation Targets

Resolve reservation targets using `recommended_model` values and reservation edition metadata:

- Verify reservation editions using `INFORMATION_SCHEMA.RESERVATIONS`:

```bash
bq query --project_id=YOUR_PROJECT --location=US --use_legacy_sql=false --format=pretty \
"SELECT
  reservation_name,
  project_id,
  edition,
  slot_capacity
FROM RESERVATION_ADMIN_PROJECT.\`region-us\`.INFORMATION_SCHEMA.RESERVATIONS
ORDER BY project_id, reservation_name"
```

- Map `recommended_model = 'ON-DEMAND'` to the config entry where `reservation = 'none'`.
- For all other values (for example `ENTERPRISE`), choose a reservation whose **edition** matches `recommended_model`.
- If exactly one matching reservation exists, assign automatically.
- If multiple matching reservations exist, ask the user which reservation tag to use.
- If no matching reservation exists, ask the user to pick a fallback reservation or create a new matching reservation first.
- Ensure an on-demand bucket exists. If missing, create one:

```javascript
{
  tag: 'on_demand',
  reservation: 'none',
  actions: []
}
```

### Step 4: Review Assignment Mapping

Retrieve the final assignment mapping. The user or agent can choose the most optimal format to store, present, or review these candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection):

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  JSON_VALUE(m, '$.model_id') AS action_name,
  JSON_VALUE(op, '$.recommended_compute_model') AS recommended_model
FROM \`masthead-prod.YOUR_DATASET.insights\`,
  UNNEST(JSON_QUERY_ARRAY(operations)) AS op,
  UNNEST(JSON_QUERY_ARRAY(op, '$.models')) AS m
WHERE category = 'Cost'
  AND type = 'Compute costs'
  AND subtype = 'Re-assign reservation for Dataform models'
ORDER BY CAST(JSON_VALUE(overview, '$.cost_30d') AS FLOAT64) DESC"
```

### Step 5: Prepare Configuration Artifacts (User-Executed)

> [!IMPORTANT]
> The agent does **not** alter repository configuration files directly without explicit human direction. All query recommendations must be reviewed and merged by a developer.

Prepare the configuration diffs or artifacts for the detected orchestration tool:

#### Dataform

- Open `definitions/_reservations.js`.
- The `action_name` values map directly to Dataform action IDs (e.g. `project.dataset.table`) as used in the `actions` arrays of `_reservations.js`.
- Replace `on_demand` `actions` with all actions where the recommended model is `ON-DEMAND`.
- Replace reserved reservation `actions` with all actions where the recommended model is not `ON-DEMAND` (e.g., using the reservation mapped to the recommended edition).
- Remove duplicates; keep only actions present in this repo's Dataform graph.
- Verify: `dataform compile` and check for duplicate assignments.
- See package reference: [`@masthead-data/dataform-package`](https://github.com/masthead-data/dataform-package)

#### dbt

- Follow the reservation assignment workflow from [`masthead-data/dbt-reservations`](https://github.com/masthead-data/dbt-reservations).
- Map recommendations to the appropriate dbt model tags or selector targets.
- Update the relevant `dbt_project.yml` or profile configuration per the repo's instructions.

#### Airflow

- Follow the reservation assignment workflow from [`masthead-data/airflow-reservations`](https://github.com/masthead-data/airflow-reservations).
- Map recommendations to DAG or task-level BigQuery reservation labels.
- Update the relevant operator configuration per the repo's instructions.

### Step 6: Verify Changes

After applying, confirm assignments are non-overlapping and align with the recommendation output. For Dataform:

```bash
# Check syntax
dataform compile

# Validate no duplicate assignments
grep -r "\.actions" definitions/_reservations.js
```

For dbt and Airflow, follow the verification steps in their respective repositories.

## Decision Criteria

| Factor           | Reserved Slots     | On-Demand             |
| ---------------- | ------------------ | --------------------- |
| **Priority**     | High, SLA-bound    | Low, flexible         |
| **Frequency**    | Regular, scheduled | Ad-hoc, occasional    |
| **Cost Pattern** | Predictable usage  | Variable, sporadic    |
| **Impact**       | Critical pipelines | Experimental, samples |

## Key Notes

- Each action should appear in only ONE reservation config
- File starts with `_` to ensure it runs first in Dataform queue
- Changes take effect on next Dataform workflow run
- Package automatically handles global assignment (no per-file edits needed)
- **All recommendations must be human-reviewed** before applying. Rely on PR review or explicit confirmation.
- The only interactive checkpoint is reservation selection when more than one reservation matches the recommended edition

## Package References

- **Dataform**: [`@masthead-data/dataform-package`](https://github.com/masthead-data/dataform-package)
- **dbt**: [`masthead-data/dbt-reservations`](https://github.com/masthead-data/dbt-reservations)
- **Airflow**: [`masthead-data/airflow-reservations`](https://github.com/masthead-data/airflow-reservations)
