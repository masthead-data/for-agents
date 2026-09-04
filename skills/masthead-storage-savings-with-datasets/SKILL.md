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

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated Billing Changes**: The agent **never** runs `bq update --storage_billing_model` or alters dataset billing policies directly. BigQuery enforces a **14-day lock-in period** on storage billing model changes. All changes must be executed by the human operator.
- **Agent Role**: Query insights, analyze compression ratios and savings, verify that dead-end tables have been dropped first (avoiding physical storage charges for time-travel), and prepare migration commands or review artifacts for human approval.

## Implementation Steps

### Step 0: Dataset Context

Ensure access to your Masthead insights dataset in BigQuery:

- **Location**: Exported under `masthead-prod.<DATASET_NAME>.insights` (see [Masthead BigQuery API Overview](https://docs.mastheadata.com/developer/api.md) and [Insights Table Reference](https://docs.mastheadata.com/developer/api/insights.md)).
- **Resolution**: Check `$MASTHEAD_INSIGHTS_DATASET`, global `~/.masthead/config.json`, or local `.masthead/config.json`. If not set, ask the user once and cache it per their preference (global `~/.masthead/config.json` recommended).

### Step 1: Query Dataset-Level Storage Recommendations

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  subtype,
  project_id,
  target_resource,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  SAFE.STRING(operations[0].recommended_action) AS recommended_action,
  SAFE.STRING(operations[0].current_billing_model) AS current_billing_model,
  SAFE.STRING(operations[0].recommended_billing_model) AS recommended_billing_model
FROM \`masthead-prod.<DATASET_NAME>.insights\`
WHERE category = 'Cost'
  AND type = 'Storage costs'
  AND target_level = 'Dataset'
ORDER BY savings_usd_30d DESC"
```

**Note:** `savings_30d` is the primary ranking signal. Review `recommended_action` to understand what Masthead is suggesting per dataset.

### Step 2: Review Candidates

Review the retrieved list of candidates. The user or agent can choose the most optimal format to store, present, or review these candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Decide on the action for each dataset:

- `apply` — Ready to execute the recommended action
- `skip` — Keep current configuration
- `investigate` — Needs further analysis (e.g. unsure of dataset ownership or active use)

**Review criteria:**

- Is the dataset actively written to by production pipelines?
- Is there a known reason for the current billing model (e.g. compliance, recent migration)?
- Are there tables in this dataset that should be dropped first (see Important note above)?
- Does the expiration policy align with data retention requirements?

### Step 3: Generate Migration Artifacts (User-Executed)

The agent does **not** execute billing model changes. BigQuery enforces an irreversible **14-day lock-in** where a dataset cannot be transitioned back immediately, and physical storage billing immediately begins charging for 7-day time travel and 7-day fail-safe bytes.

Generate the migration commands or documentation requested by the user for independent review and execution:

```bash
# Generated for human operator review and execution:
# Switch a dataset to physical billing
bq update --storage_billing_model=PHYSICAL YOUR_PROJECT:YOUR_DATASET

# Switch a dataset back to logical billing (allowed only after 14-day lock-in period)
bq update --storage_billing_model=LOGICAL YOUR_PROJECT:YOUR_DATASET
```

**Note:** Billing model changes take effect immediately, but cost impact is reflected in the next billing cycle. Wait at least 14 days before evaluating savings.

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
