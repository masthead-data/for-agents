---
name: masthead-storage-savings-with-tables
description: Optimize BigQuery storage costs by identifying and removing dead-end and unused tables.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access data, and view reservations.
---

# Optimize Storage Costs (Dead-end and Unused Tables)

## Purpose

Identify and remove BigQuery tables that contribute to storage costs but have no active consumption, based on Masthead Data lineage analysis.

## Prerequisites

- Verify the [Masthead Data integration ](https://docs.mastheadata.com/get-started/integrate-using-iac) is version **v0.2.7+** (required for accurate lineage data)

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

### Step 1: Query Storage Waste

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=csv \
"SELECT
  subtype,
  project_id,
  target_resource,
  JSON_VALUE(JSON_QUERY_ARRAY(operations)[OFFSET(0)], '$.resource_type') AS resource_type,
  SAFE.INT64(overview.num_bytes) / POW(1024, 4) AS total_tib,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  SAFE.TIMESTAMP(overview.last_modified_time) AS last_modified_time
FROM \`masthead-prod.YOUR_DATASET.insights\`
WHERE category = 'Cost'
  AND subtype IN ('Dead end table', 'Leaf dead end table', 'Unused table')
  AND overview.num_bytes IS NOT NULL
ORDER BY savings_usd_30d DESC" > storage_waste.csv
```

**Note:** `cost_30d` and `savings_30d` may be null — `total_tib` is the reliable sizing signal. Include `last_modified_time` to detect external writers (see Key Signal above).

### Step 2: Review and Decide

Review `storage_waste.csv` and add a `status` column with values:

- `keep` - Table is needed
- `to drop` - Safe to remove
- `investigate` - Needs further analysis

**Review criteria:**

- Is this a backup or archive table?
- Is there a downstream dependency not captured in lineage?
- Is this table part of an active experiment or migration?
- **For repo-managed projects:** Search the codebase (e.g., `grep` for table name in model definitions, scripts) to confirm ownership. Table naming can be misleading (e.g. may seem like current outputs but could be legacy).
- **Disable producers:** if there is a related pipeline code - it needs to be disabled to avoid regenerating the table after dropping.

### Step 3: Drop Approved Tables

```bash
# Generate DROP statements
# Column 3 in storage_waste.csv is target_resource (project.dataset.table)
awk -F',' '$NF=="to drop" {
  print "bq rm -f -t " $3
}' storage_waste.csv > drop_tables.sh

# Review generated commands
cat drop_tables.sh

# Execute (after review, and run only by users!)
bash drop_tables.sh
```

**Safe mode (dry-run first):**

```bash
# Add --dry-run flag to each command
# To be run by users only!
sed 's/bq rm/bq rm --dry-run/' drop_tables.sh > drop_tables_dryrun.sh
bash drop_tables_dryrun.sh
```

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
