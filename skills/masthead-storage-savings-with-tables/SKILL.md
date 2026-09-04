---
name: masthead-storage-savings-with-tables
description: Optimize BigQuery storage costs by identifying and removing dead-end and unused tables.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access data, and view reservations.
---

# Optimize Storage Costs (Dead-end and Unused Tables)

## Purpose

Identify and remove BigQuery tables that contribute to storage costs but have no active consumption, based on Masthead Data lineage analysis.

## Prerequisites

- Verify the [Masthead Data integration](https://docs.mastheadata.com/get-started/integrate-using-iac) is version **v0.2.7+** (required for accurate lineage data).

## Table Categories

Masthead Data uses lineage analysis to identify tables, but relies on visible pipeline references. Modification timestamps are critical:

| Type              | Definition                                                                                        | Indicators                         | Watch for                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Leaf dead-end** | Leaf table in a dead-end chain — regularly updated, no downstream consumers. Directly actionable. | Updated but never read in 30+ days | External writers outside lineage graph (manual jobs, independent pipelines)                                                       |
| **Dead-end**      | Upstream table or pipeline that contributes solely to a dead-end chain                            | Feeds only into dead-end tables    | May become resolvable once the leaf dead-end is dropped; re-evaluate after leaf removal                                           |
| **Unused**        | No upstream or downstream activity                                                                | No reads/writes in 30+ days        | Recent `last_modified_time` (in query output) despite "Unused" flag suggests external writer—**do not drop without verification** |

### Key Signal

If a table is flagged `Unused` **and** has a recent `last_modified_time` in the query output (i.e. the actual BigQuery table was recently written to), something outside Masthead's lineage visibility is writing to it — for example a manual job or external pipeline. `last_modified_time` here is the **referenced table's** BigQuery metadata timestamp, not the insights record update time. This always warrants investigation before dropping.

## When to Use

- Reducing storage costs when budget is constrained
- Cleaning up abandoned tables and pipelines
- Implementing regular storage hygiene
- Investigating sudden storage cost increases

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated Deletions**: The agent **never** executes `bq rm` or drops tables directly. All table deletions are reserved exclusively for the human operator.
- **Agent Role**: Query insights, investigate table recency and lineage, formulate clear argumentation with cost/risk trade-offs, and generate whatever review or execution artifacts the user requests (e.g., Markdown review tables, CSV exports, or standalone shell scripts with dry-run commands for the user to inspect and run independently).

## Implementation Steps

### Step 0: Dataset Context

Ensure access to your Masthead insights dataset in BigQuery:

- **Location**: Exported under `masthead-prod.<DATASET_NAME>.insights` (see [Masthead BigQuery API Overview](https://docs.mastheadata.com/developer/api.md) and [Insights Table Reference](https://docs.mastheadata.com/developer/api/insights.md)).
- **Resolution**: Check `$MASTHEAD_INSIGHTS_DATASET`, global `~/.masthead/config.json`, or local `.masthead/config.json`. If not set, ask the user once and cache it per their preference (global `~/.masthead/config.json` recommended).

### Step 1: Query Storage Waste

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=pretty \
"SELECT
  subtype,
  project_id,
  target_resource,
  SAFE.STRING(operations[0].resource_type) AS resource_type,
  SAFE.INT64(overview.num_bytes) / POW(1024, 4) AS total_tib,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  SAFE.TIMESTAMP(SAFE.STRING(overview.last_modified_time)) AS last_modified_time
FROM \`masthead-prod.<DATASET_NAME>.insights\`
WHERE category = 'Cost'
  AND subtype IN ('Dead end table', 'Leaf dead end table', 'Unused table')
  AND overview.num_bytes IS NOT NULL
ORDER BY savings_usd_30d DESC"
```

**Note:** `cost_30d` and `savings_30d` may be null — `total_tib` is the reliable sizing signal. Include `last_modified_time` to detect external writers (see Key Signal above).

### Step 2: Review and Decide

Review the retrieved list of candidates. The user or agent can choose the most optimal format to store, present, or review these candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Decide on the action for each table:

- `keep` — Table is needed
- `to drop` — Safe to remove
- `investigate` — Needs further analysis

**Review criteria:**

- Is this a backup or archive table?
- Is there a downstream dependency not captured in lineage?
- Is this table part of an active experiment or migration?
- **For repo-managed projects:** Search the codebase (e.g., `grep` for table name in model definitions, scripts) to confirm ownership. Table naming can be misleading (e.g. may seem like current outputs but could be legacy).
- **Disable producers:** if there is a related pipeline code - it needs to be disabled to avoid regenerating the table after dropping.
- **Inspect Live Metadata**: For ambiguous or high-value candidates, run the CLI equivalent of `table_get` to verify live row count, total bytes, labels, and exact `lastModifiedTime`:

  ```bash
  bq show --format=prettyjson YOUR_PROJECT:YOUR_DATASET.YOUR_TABLE
  ```

### Step 3: Generate Remediation Artifacts (User-Executed)

The agent does **not** execute drop commands. Instead, generate the remediation artifacts requested by the user for independent review and execution:

1. **Review Artifacts**: Provide a clear Markdown summary or CSV candidate list with table sizes, 30-day savings, and last modified dates.
2. **Execution Script**: When requested, prepare a standalone shell script that inspects live table metadata before taking actions.

### Step 4: Verify Savings

After 24-48 hours, check storage reduction in Masthead:

- [Storage Cost Insights](https://app.mastheadata.com/costs?tab=Storage+costs)
- Compare before/after storage size and costs

## Decision Framework

| Monthly Savings | Action                           | Recency Check                                                     |
| --------------- | -------------------------------- | ----------------------------------------------------------------- |
| < $10           | Consider keeping (low ROI)       | Skip if `lastModifiedTime` > 12 months old (hygiene only)         |
| $10-$100        | Review and drop if unused        | Check modification date; recent writes require owner verification |
| $100-$1000      | Priority review, likely drop     | Mandatory verification if modified in last 30 days                |
| > $1000         | Immediate investigation required | Always verify external writer before any action                   |

## Key Notes

- **Unused tables with recent modifications** are the highest-priority investigate cases. The gap between Masthead's "no lineage" and actual writes means an external dependency exists.
- **Dead-end tables** may indicate pipeline issues - investigate before dropping
- Tables can be restored from time travel (7 days) or fail-safe (7 days after time travel)
- Prioritize running a table cleanup before switching a dataset billing model to physical storage, as the latter will include costs for time-travel and fail-safe.
- Coordinate with data teams before dropping shared resources
- Wait 14 days after storage billing model changes before dropping tables

## Related Optimizations

- **Storage billing model**: Switch between Logical/Physical pricing (see docs)
- **Table expiration**: Set automatic expiration for temporary tables
- **Partitioning**: Use partitioned tables with expiration policies

## Documentation

- [Masthead Storage Costs](https://docs.mastheadata.com/cost-insights/storage-costs)
- [BigQuery Storage Pricing](https://cloud.google.com/bigquery/pricing#storage)
