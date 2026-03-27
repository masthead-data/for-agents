---
name: masthead-storage-savings-with-datasets
description: Optimize BigQuery storage costs at the dataset level by switching storage billing models and setting expiration policies.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access data, and view reservations.
---

# Optimize Storage Costs (Dataset-Level)

## Purpose

Reduce BigQuery storage costs by acting at the dataset level — switching storage billing models (logical vs. physical) and setting table expiration policies — based on Masthead Data insights.

## When to Use

- Optimizing storage costs across whole datasets, not just individual tables
- Switching datasets with heavily compressed data to physical billing (can reduce costs significantly)
- Applying automatic expiration to datasets containing temporary or transient tables
- Running a broad cost reduction pass before diving into table-level cleanup

## Important: Table Cleanup First

Before switching a dataset to physical storage billing, drop unused/dead-end tables first. Physical billing includes costs for **time-travel and fail-safe storage**, so removing tables beforehand avoids paying for their retention. Run `masthead-storage-savings-with-tables` before this skill if you haven't already.

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

### Step 1: Query Dataset-Level Storage Recommendations

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=csv \
"SELECT
  subtype,
  project_id,
  target_resource,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  JSON_VALUE(JSON_QUERY_ARRAY(operations)[OFFSET(0)], '$.recommended_action') AS recommended_action,
  JSON_VALUE(JSON_QUERY_ARRAY(operations)[OFFSET(0)], '$.current_billing_model') AS current_billing_model,
  JSON_VALUE(JSON_QUERY_ARRAY(operations)[OFFSET(0)], '$.recommended_billing_model') AS recommended_billing_model
FROM \`masthead-prod.YOUR_DATASET.insights\`
WHERE category = 'Cost'
  AND type = 'Storage costs'
  AND target_level = 'Dataset'
ORDER BY savings_usd_30d DESC" > dataset_storage_candidates.csv
```

**Note:** `savings_30d` is the primary ranking signal. Review `recommended_action` to understand what Masthead is suggesting per dataset.

### Step 2: Review Candidates

Open `dataset_storage_candidates.csv` and add a `status` column:

- `apply` — Ready to execute the recommended action
- `skip` — Keep current configuration
- `investigate` — Needs further analysis (e.g. unsure of dataset ownership or active use)

**Review criteria:**

- Is the dataset actively written to by production pipelines?
- Is there a known reason for the current billing model (e.g. compliance, recent migration)?
- Are there tables in this dataset that should be dropped first (see Important note above)?
- Does the expiration policy align with data retention requirements?

### Step 3: Apply Billing Model Changes

For datasets marked `apply` with a billing model recommendation:

```bash
# Switch a dataset to physical billing
bq update --storage_billing_model=PHYSICAL YOUR_PROJECT:YOUR_DATASET

# Switch a dataset back to logical billing (if needed)
bq update --storage_billing_model=LOGICAL YOUR_PROJECT:YOUR_DATASET
```

Generate and review commands for all approved datasets:

```bash
# Generate commands from CSV (column 3 is target_resource: project:dataset)
awk -F',' '$NF=="apply" && $(NF-1)!="" {
  split($3, parts, ".")
  print "bq update --storage_billing_model=" $(NF-1) " " parts[1] ":" parts[2]
}' dataset_storage_candidates.csv > update_billing_models.sh

cat update_billing_models.sh
# Executable only by a human operator after review!
bash update_billing_models.sh
```

**Note:** Billing model changes take effect immediately but cost impact is reflected in the next billing cycle. Wait at least 14 days before evaluating savings.

### Step 4: Verify Changes

```bash
# Check current billing model and expiration for a dataset
bq show --format=prettyjson YOUR_PROJECT:YOUR_DATASET | grep -E '"defaultTableExpirationMs"|"storageBillingModel"'
```

After 24-48 hours, review storage cost trends in Masthead:

- [Storage Cost Insights](https://app.mastheadata.com/costs?tab=Storage+costs)

## Decision Framework

| Recommendation        | When to Apply                                                         | When to Skip                                                               |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Switch to physical    | Dataset has high compression ratio; tables are not being dropped soon | Dataset has many tables pending drop; recent migration                     |
| Switch to logical     | Dataset has low compression; physical costs exceed logical            | Rarely needed; only if physical savings haven't materialized after 30 days |
| Set expiration policy | Dataset contains short-lived, temporary, or transient tables          | Dataset contains long-lived production tables                              |

## Key Notes

- Physical billing can **increase** costs for datasets with uncompressed data or many small tables — always check Masthead's `savings_30d` before applying
- Billing model changes are **reversible** but take time to reflect in billing
- Coordinate with data teams before modifying shared or production datasets
- Run table-level cleanup (`masthead-storage-savings-with-tables`) before switching to physical billing

## Documentation

- [Masthead Storage Costs](https://docs.mastheadata.com/cost-insights/storage-costs)
- [BigQuery Storage Pricing](https://cloud.google.com/bigquery/pricing#storage)
- [BigQuery Storage Billing Models](https://docs.cloud.google.com/bigquery/docs/datasets-intro#dataset_storage_billing_models)
