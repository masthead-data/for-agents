---
name: masthead-compute-savings-with-capacity-commitments
description: Optimize BigQuery Enterprise and Enterprise Plus compute costs by buying or growing slot capacity commitments, shrinking them at renewal, and setting reservation baselines, based on Masthead commitment recommendations.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access Masthead insight datasets, and view reservations and capacity commitments in the reservation admin project.
---

# Optimize Compute Costs (Slot Commitments)

## Purpose

Translate Masthead capacity commitment recommendations (`Capacity commitment` rows in the exported `insights` table) into reviewed, user-executed changes: buy or grow a commitment, change what renews, and set reservation baselines.

## When to Use

- Deciding whether a 1-year slot commitment lowers Enterprise or Enterprise Plus reservation costs, and how many slots it should have.
- Planning a smaller commitment, or none, before an active commitment renews.
- Setting reservation baselines after the committed slots change.

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated Purchases or Changes**: The agent **never** creates capacity commitments, changes renewal plans, splits commitments, or alters reservations. A commitment is a purchase that can't be cancelled or reduced before it ends, so every command must be reviewed and executed by a human operator.
- **Agent Role**: Query insights, check that each recommendation still matches the live commitments, and prepare the exact SQL DDL and `bq` commands with their warnings for human review.

## Implementation Steps

### Step 0: Dataset Context

Resolve the Masthead insights dataset before querying. It always lives in the `masthead-prod` project; only the dataset name is per-tenant.

1. **Masthead MCP connected** (preferred): call `get_tenant_settings`. Use `insightsDataset.project` + `insightsDataset.dataset` as `<DATASET_NAME>` (for example `masthead-prod.mastheadata`). If `insightsDataset.enabled` is `false`, stop and tell the user BigQuery export is not enabled for their tenant ([request access](https://docs.mastheadata.com/developer/api#set-up-access)). Cache the dataset in `~/.masthead/config.json` (or `.masthead/config.json` per the user's preference).
2. **No MCP**: check `$MASTHEAD_INSIGHTS_DATASET`, then global `~/.masthead/config.json`, then local `.masthead/config.json`. If none is set, ask the user once and cache it.

`YOUR_PROJECT` in the commands below is the **user's own GCP project** that bills and authorizes the `bq` jobs (`gcloud config get-value project`) — never `masthead-prod`, customers cannot run jobs there. Reference: [Masthead BigQuery API Overview](https://docs.mastheadata.com/developer/api.md), [Insights Table Reference](https://docs.mastheadata.com/developer/api/insights.md).

### Step 1: Query Commitment Recommendations

Each row is one commitment group: a reservation admin project, location, and edition, whose reservations share committed slots and baselines. `project_id` is the admin project and `target_resource` is `project:location:EDITION`. A group has at most one row.

```bash
bq query --project_id=YOUR_PROJECT --use_legacy_sql=false --format=prettyjson \
"SELECT
  subtype,
  project_id AS admin_project,
  target_resource,
  last_updated_time,
  SAFE.STRING(overview.location) AS location,
  SAFE.STRING(overview.edition) AS edition,
  SAFE.INT64(overview.days) AS days,
  SAFE.INT64(overview.active_committed_slots) AS active_committed_slots,
  SAFE.INT64(overview.recommended_committed_slots) AS recommended_committed_slots,
  SAFE.FLOAT64(overview.cost_30d) AS cost_usd_30d,
  SAFE.FLOAT64(overview.savings_30d) AS savings_usd_30d,
  ROUND(SAFE_DIVIDE(SAFE.FLOAT64(overview.savings_30d), SAFE.FLOAT64(overview.cost_30d)), 3) AS savings_share,
  SAFE.FLOAT64(overview.prices.commitment) AS commitment_price,
  SAFE.STRING(overview.active_commitment_ends_at) AS active_commitment_ends_at,
  operations
FROM \`masthead-prod.<DATASET_NAME>.insights\`
WHERE category = 'Cost'
  AND type = 'Capacity commitment'
  AND SAFE.FLOAT64(overview.savings_30d) > 0
ORDER BY savings_usd_30d DESC"
```

| Subtype | Meaning | `operations`, in order |
| --- | --- | --- |
| `Buy commitment` | The group has no active commitment, and a 1-year commitment costs less than its current reservations. | `CREATE_CAPACITY`, `SET_BASELINES` |
| `Increase commitment` | More committed slots cost less than the current commitment. | `CREATE_CAPACITY` (`slot_count` is the slots to add), `SET_BASELINES` |
| `Decrease commitment at renewal` | A smaller commitment, or none, costs less. Savings start after `active_commitment_ends_at`. | `CHANGE_RENEWAL`, `SET_BASELINES` |
| `Set baseline` | The commitment size is right, or a smaller size is already scheduled to renew, but the reservation baselines don't match it. | `SET_BASELINES` |

`savings_usd_30d` compares the group's cost over the row's `period` (`days` days, up to 30) with its cost at `recommended_committed_slots`. Rows come from the latest daily recommendation, and the exported table refreshes once a day, so they don't show a purchase or change made after `last_updated_time`.

### Step 2: Review and Decide

Review the retrieved rows. The user or agent can choose the most optimal format to store, present, or review them (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Next to the row values, show:

- `savings_share` from the query (`savings_30d / cost_30d`);
- for `CREATE_CAPACITY`, the 1-year commitment cost: `slot_count × commitment_price × 8,760` hours (for example 450 slots × $0.0528 × 8,760 ≈ $208,000).

Decide on the action for each row:

- `apply` — Prepare the commands in Step 3
- `skip` — Don't apply now
- `investigate` — Needs the user's decision or more data

**Review criteria:**

- **Live Commitments:** Before any `CREATE_CAPACITY` or `CHANGE_RENEWAL`, run this query. The `slot_count` total of commitments in state `ACTIVE` or `PENDING` must equal `active_committed_slots`, and for `CHANGE_RENEWAL` every commitment in `commitments` must still have its listed `slot_count` and `renewal_plan`. If not, a purchase or change was made after `last_updated_time`: mark the row `skip` and re-read it after the next refresh.

  ```bash
  bq query --project_id=ADMIN_PROJECT --location=LOCATION --use_legacy_sql=false --format=pretty \
  "SELECT
    capacity_commitment_id,
    edition,
    commitment_plan,
    renewal_plan,
    state,
    slot_count
  FROM \`region-LOCATION.INFORMATION_SCHEMA.CAPACITY_COMMITMENTS\`
  WHERE edition = 'EDITION'
  ORDER BY capacity_commitment_id"
  ```

- **Already Done:** If the commitments in `commitments` whose `renewal_plan` isn't `NONE` already add up to `renew_slots`, the renewal change is done: skip `CHANGE_RENEWAL`. Before any `SET_BASELINES`, run the reservations query from Step 4: if the listed reservations' `slot_capacity` already adds up to `total_baseline_slots`, the baselines are done: say so and skip `SET_BASELINES`.

- **Planned Workload Changes:** A commitment is billed for every hour of its term, whatever the usage. Ask whether a migration, a decommission, or new workloads are planned within the term.
- **Savings Margin:** For every purchase, show `savings_share` next to the 1-year commitment cost: a small share leaves little margin if demand falls. Let the user decide; don't mark a row `investigate` only because of its share.
- **Short History:** `days` below 30 means a new group, so the recommendation rests on less history.
- **Idle Slots:** In `SET_BASELINES`, a reservation with `ignore_idle_slots = true` doesn't use committed slots it has no baseline for.

### Step 3: Generate Commitment Artifacts (User-Executed)

> [!IMPORTANT]
> The agent does **not** buy, alter, or split anything. All commands must be reviewed and executed by a developer or operator. `CREATE CAPACITY` is a purchase: a 1-year commitment can't be cancelled or reduced before it ends.

Take every value from `operations` verbatim and keep the array order. In `operations` a resource is `ADMIN_PROJECT:LOCATION.ID`; in SQL DDL it is `` `ADMIN_PROJECT.region-LOCATION.ID` ``. Validate each DDL statement without running it: `bq query --dry_run --project_id=ADMIN_PROJECT --location=LOCATION --use_legacy_sql=false "<DDL>"` prints `Query successfully validated`. The agent may run this dry run; it never runs a statement without `--dry_run`.

If the commitments or reservations are managed in Terraform, make the change in [`google_bigquery_capacity_commitment`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_capacity_commitment) or [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation) instead: the next `terraform apply` would revert a DDL change.

#### CREATE_CAPACITY

1. Ask the user for:
   - the commitment ID that replaces `COMMITMENT_ID`: lowercase letters, numbers, and dashes, starting and ending with a letter or number, unique in the admin project and location;
   - the renewal plan: `NONE` ends the commitment after its term; `ANNUAL` or `THREE_YEAR` renews it.
2. Write the DDL:

   ```sql
   CREATE CAPACITY `ADMIN_PROJECT.region-LOCATION.COMMITMENT_ID`
   OPTIONS (
     slot_count = SLOT_COUNT,
     edition = 'EDITION',
     plan = 'PLAN',
     renewal_plan = 'RENEWAL_PLAN');
   ```

#### SET_BASELINES

`total_baseline_slots` is the total to split across `reservations`; each reservation's `baseline_slots` is its current baseline.

1. Show the reservations with their current baselines and `ignore_idle_slots`, and ask the user how to split `total_baseline_slots`. Don't propose a split: the user knows which workloads run steadily. The baselines should add up to it: baseline above the committed slots is billed at pay-as-you-go rates. Baseline suits reservations that run steadily. Committed slots that a reservation isn't using are idle slots, which reservations with `ignore_idle_slots = false` use before they autoscale.
2. Write one statement per reservation whose baseline changes, with the user's numbers. Until the user gives them, keep `BASELINE_SLOTS` as a placeholder; fill it in yourself only when the split is fixed (one reservation, or a total of 0):

   ```sql
   ALTER RESERVATION `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID`
   SET OPTIONS (slot_capacity = BASELINE_SLOTS);
   ```

3. Timing and rules:
   - **After `CREATE_CAPACITY`:** run once the new commitment is `ACTIVE`. Baseline that committed slots don't cover must be a multiple of 50 and is billed at pay-as-you-go rates.
   - **After `CHANGE_RENEWAL`, or on a `Set baseline` row whose `active_committed_slots` is above `total_baseline_slots` (a smaller size is already scheduled to renew):** lower the baselines to `total_baseline_slots` on or before the earliest `ends_at` (`active_commitment_ends_at`). The savings start when the larger commitment ends, not when the baselines go down.
   - **`total_baseline_slots` is 0:** set every baseline to 0.
   - **`ignore_idle_slots = true` with no baseline:** offer `ALTER RESERVATION … SET OPTIONS (ignore_idle_slots = false)` so the reservation can use idle slots.
   - **Autoscaling:** keep it on: it covers demand above the commitment. A reservation's maximum size is its baseline plus `autoscale_max_slots`, so lowering a baseline lowers the maximum by the same amount. Where a baseline goes down, show the reservation's `autoscale_max_slots` from the reservations query in Step 4 and ask the user whether to raise it with `ALTER RESERVATION … SET OPTIONS (autoscale_max_slots = N)`. A reservation with no baseline and `autoscale_max_slots = 0` gets only idle slots, and none once the commitment ends.

#### CHANGE_RENEWAL

An active commitment can't be cancelled or reduced, so this changes what renews when it ends. `renew_slots` is the size to keep renewing; `commitments` lists the active commitments with their `slot_count`, `renewal_plan`, and `ends_at`. Make the changes before the earliest `ends_at`.

- **`renew_slots = 0`:** set the renewal plan of every listed commitment to `NONE`. A commitment with renewal plan `NONE` is deleted when it ends.

  ```sql
  ALTER CAPACITY `ADMIN_PROJECT.region-LOCATION.CAPACITY_COMMITMENT_ID`
  SET OPTIONS (renewal_plan = 'NONE');
  ```

- **`renew_slots > 0`:** choose commitments whose `slot_count` adds up to `renew_slots` and keep them renewing (set `renewal_plan = 'ANNUAL'` where it is `NONE`); set the rest to `NONE`. If no combination adds up, split a commitment first. There is no SQL DDL for a split; the new part keeps the plan and end date, `SLOTS` is the new part's size, and splits go in steps of 50 slots:

  ```bash
  bq update --project_id=ADMIN_PROJECT --location=LOCATION --split --slots=SLOTS --capacity_commitment=true CAPACITY_COMMITMENT_ID
  ```

  Then rerun the live commitments query from Step 2 to get the new part's ID.

The BigQuery console has the same actions: **Workload management** → **Slot commitments** → **Edit renewal plan** or **Split**.

### Step 4: Verify Changes

1. **Commitments:** rerun the live commitments query from Step 2. A new commitment shows `state = ACTIVE` with its `slot_count`; a changed commitment shows its new `renewal_plan`.
2. **Baselines:**

   ```bash
   bq query --project_id=ADMIN_PROJECT --location=LOCATION --use_legacy_sql=false --format=pretty \
   "SELECT
     reservation_name,
     edition,
     slot_capacity,
     ignore_idle_slots,
     autoscale.max_slots AS autoscale_max_slots
   FROM \`region-LOCATION.INFORMATION_SCHEMA.RESERVATIONS\`
   WHERE edition = 'EDITION'
   ORDER BY reservation_name"
   ```

3. After 24-48 hours, review the group on the **Commitments** tab of the Masthead Costs page.

## Decision Framework

| Recommendation | When to Apply | When to Skip or Investigate |
| --- | --- | --- |
| Buy or increase a commitment | Live commitments match the row; demand is steady and no decline is planned within the term | Live commitments differ (skip until the next refresh); a migration or decommission is planned; `days` below 30 |
| Decrease at renewal | Before the earliest `ends_at`, when the lower demand is expected to last | Planned growth would need the slots back |
| Set baselines | A commitment is `ACTIVE`, or the group has none, and the baselines don't add up to `total_baseline_slots` | A commitment bought for this row isn't `ACTIVE` yet |

## Common Pitfalls

- **Buying From a Stale Row**: Buying again after a purchase made since `last_updated_time`, including one that is still `PENDING`. Always run the live commitments check first.
- **Baselines Before the Commitment Is Active**: Uncovered baseline must be a multiple of 50 and is billed at pay-as-you-go rates.
- **Letting a Commitment End Without Lowering Baselines**: Baseline slots stay billed, at pay-as-you-go rates once the commitment is gone.
- **Invalid Commitment IDs**: `CREATE CAPACITY` rejects uppercase letters and IDs already used in the project and location.
- **DDL on Terraform-Managed Resources**: The next `terraform apply` reverts the change.

## Related Optimizations

- **Workloads and Pipelines**: Reassigning models and principals (`masthead-compute-savings-with-workload-assignments`) and pausing pipelines (`masthead-compute-savings-with-pipelines`) change the group's demand. Apply them first, then re-read the commitment row after the next daily refresh.

## Documentation

- [Masthead Slot Commitments](https://docs.mastheadata.com/cost-insights/compute-costs/slot-commitments)
- [Insights Table Reference: Capacity commitment](https://docs.mastheadata.com/developer/api/insights#capacity-commitment)
- [BigQuery slot commitments](https://cloud.google.com/bigquery/docs/reservations-commitments)
- [`CREATE CAPACITY`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_capacity_statement), [`ALTER CAPACITY`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_capacity_set_options_statement), and [`ALTER RESERVATION`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_reservation_set_options_statement) statements
- [`INFORMATION_SCHEMA.CAPACITY_COMMITMENTS` view](https://cloud.google.com/bigquery/docs/information-schema-capacity-commitments)
