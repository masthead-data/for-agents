---
name: masthead-compute-savings-with-data-models
description: Optimize BigQuery compute costs by reassigning data models (Dataform, dbt, Airflow) or principals (service accounts, users) to slot reservations or on-demand compute based on Masthead recommendations without impacting performance.
compatibility: Requires gcloud CLI, bq command-line tool. Must have read-only permissions to run BigQuery jobs, access Masthead insight datasets, and view reservations.
---

# Optimize BigQuery Compute Costs (Models & Principals)

## Purpose

Automatically translate Masthead compute-cost recommendations (`views.insight` / exported `insights` tables) into concrete, verified configurations for BigQuery reservations and orchestration pipelines.

The primary objective is **reliable enterprise workload cost optimization without performance impact**. Workloads are systematically routed between autoscale slot reservations and on-demand compute pools based on simulated execution profiles.

## Workload Scope

Masthead evaluates two classes of compute recommendations:

1. **Data Models (`DAG_MODEL`)**: Orchestrated pipeline nodes across Dataform actions, dbt models, and Airflow tasks.
2. **Principals (`PRINCIPAL`)**: Identity-based workloads executed by service accounts or users across projects.

## Operating Mode: Cautious Advisory (Non-Action)

This skill operates strictly in an advisory capacity:

- **Zero Automated In-Place Mutation**: The agent **never** creates/alters BigQuery reservations, grants IAM permissions, or modifies repository configuration files (`definitions/_reservations.js`, `dbt_project.yml`, `reservations_config.json`) without explicit human review and approval.
- **Agent Role**: Query insights, evaluate simulation reliability caveats, calculate trade-offs, verify reservation capacity, and prepare exact SQL commands, configuration diffs, and validation checks for human review.

---

## Workflow Implementation

### Step 0: Dataset Context & Target Resolution

Ensure access to the Masthead insights dataset in BigQuery:

- **Table Location**: Exported under `masthead-prod.<DATASET_NAME>.insights` (e.g. `masthead-prod.hkm.insights`, `masthead-prod.realtruck.insights`).
- **Resolution**: Check `$MASTHEAD_INSIGHTS_DATASET`, global `~/.masthead/config.json`, or local `.masthead/config.json`. If not set, ask the user once and cache per preference.

### Step 1: Pull & Filter Compute Recommendations

Execute the following query to extract active compute recommendations. The query filters out unprofitable configurations (`savings_30d <= 0`) and extracts both model and principal reassignments:

```bash
bq query --project_id=YOUR_PROJECT --nouse_legacy_sql --format=prettyjson \
"WITH ranked_insights AS (
  SELECT
    subtype,
    last_updated_time,
    overview,
    operations,
    SAFE.FLOAT64(overview.cost_30d) AS cost_30d,
    SAFE.FLOAT64(overview.savings_30d) AS savings_30d,
    STRING(overview.status) AS status,
    STRING(overview.location) AS location,
    JSON_EXTRACT_ARRAY(overview.reservations) AS reservations,
    JSON_EXTRACT_ARRAY(overview.statusData) AS status_data
  FROM \`masthead-prod.<DATASET_NAME>.insights\`
  WHERE category = 'Cost'
    AND type = 'Compute costs'
)
SELECT *
FROM ranked_insights
WHERE savings_30d > 0
ORDER BY savings_30d DESC"
```

#### Row Contract & Rules

- **Alternative End-States**: Each row is an independently simulated plan for a workload group. **Rows whose operations touch the same reservation are mutually exclusive alternative end-states, not composable steps.** Select the row yielding the highest verified savings and skip alternatives.
- **Negative Savings**: Discard any row where `savings_30d <= 0` (the simulated setup costs *more* than the status quo).
- **Recalculation Freshness**: Check `last_updated_time`. Rows are regenerated periodically; re-verify before finalizing a proposal.

### Step 2: Audit Simulation Reliability & Caveats

To ensure reliable optimization with **zero performance degradation**, evaluate `status` and all entries in `status_data`:

| Status / Caveat Type | Meaning & Enterprise Impact | Required Action |
| --- | --- | --- |
| `status = 'DRAFT'` | Provisional plan; simulation could not fully verify all workload variables. | **Do not auto-apply.** Prepare proposal for manual engineering review. |
| `UNMET_PERFORMANCE` | No simulated reservation size met the performance criteria; closest option chosen. | **High Risk.** Workloads may experience latency spikes or miss SLAs. Require human approval and set up latency monitoring. |
| `SKIPPED_WORKLOAD` | Workload for listed entities (`totalSlotMs`, `repositories`, `sourceProjects`) was excluded from simulation (e.g. models spanning multiple reservations). | **Do not route skipped workloads** and **do not count their slot hours toward savings**. |
| `MAX_PLAN_PROJECTS` | Workload group exceeded the simulation project limit; costs are plan estimates. | Flag that numbers are theoretical estimates rather than cycle-accurate simulations. |
| `UNMAPPED_WORKLOAD` | Workloads had no pipeline mapping; costs are plan estimates. | Require manual validation of underlying query patterns. |

> [!IMPORTANT]
> Whenever `status = 'DRAFT'` or `status_data` is non-empty, your proposal **must** include a `Notes & Risk Assessment` section explicitly detailing each caveat, its scope, and the performance implications for the plan.

---

## Canonical Operations Sequence (`operations`)

The `operations` array contains atomic actions in their strict execution order:

```text
1. CREATE_RESERVATION / ALTER_RESERVATION
   └── 2. ENABLE_FLUID_AUTOSCALING
       └── 3. ALLOW_FLEXIBLE_ASSIGNMENT
           └── 4. RESERVATION_CONFIG
```

> [!IMPORTANT]
> **Execution Interface Hierarchy: SQL DDL First**:
> Always use native **BigQuery SQL DDL** (`CREATE/ALTER RESERVATION`, `ALTER PROJECT`, `CREATE/DROP ASSIGNMENT`) as the primary execution method. Use the **`bq` CLI tool only when BigQuery SQL DDL is not available**—specifically for reservation-scoped IAM policies in `ALLOW_FLEXIBLE_ASSIGNMENT`—or for discovery queries (`bq query`).

### Implementation Reference Matrix

When guiding BigQuery actions, follow the engineering hierarchy: **Native SQL DDL -> Declarative Terraform -> CLI (`bq`) fallback** (use `bq` only when SQL DDL is not supported or as a secondary fallback):

| Recommendation Action | SQL DDL | Terraform | bq CLI | Detailed Reference |
| :--- | :--- | :--- | :--- | :--- |
| `CREATE_RESERVATION` | [`CREATE RESERVATION`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_reservation) | [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation) | [`bq mk --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk) *(when SQL/TF unavailable)* | [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#1-create_reservation) |
| `ALTER_RESERVATION` | [`ALTER RESERVATION`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_reservation) | [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation) | [`bq update --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_update) *(when SQL/TF unavailable)* | [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#2-alter_reservation) |
| `ENABLE_FLUID_AUTOSCALING` | [`ALTER PROJECT SET OPTIONS`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_project) | [`terraform_data`](https://developer.hashicorp.com/terraform/language/resources/terraform-data) (executes SQL) | [`bq query`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_query) (executes SQL) | [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#3-enable_fluid_autoscaling) |
| `ALLOW_FLEXIBLE_ASSIGNMENT` | *N/A (No SQL DDL for reservation IAM)* | [`google_project_iam_member`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam#google_project_iam_member) *(with IAM condition)* | [`bq set-iam-policy --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_set-iam-policy) | [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#4-allow_flexible_assignment) |
| `RESERVATION_CONFIG` (`PRINCIPAL`) | [`CREATE ASSIGNMENT`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_assignment) / [`DROP ASSIGNMENT`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#drop_assignment) | [`google_bigquery_reservation_assignment`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation_assignment) | [`bq mk --reservation_assignment`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk) *(when SQL/TF unavailable)* | [principal-routing.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/principal-routing.md) |
| `RESERVATION_CONFIG` (`DAG_MODEL`) | Orchestration packages | Dataform / dbt / Airflow package config | *N/A* | [orchestration-templates.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/orchestration-templates.md) |

### 1. Reservation Configuration (`CREATE_RESERVATION` / `ALTER_RESERVATION`)

- **Baseline Capacity**: Always set `slot_capacity = 0` (autoscale-only for cost efficiency).
- **Max Autoscaling**: Set `autoscale_max_slots` from the recommendation.
- **Implementation Hierarchy**:
  1. **SQL DDL**: Native BigQuery SQL ([`CREATE RESERVATION`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_reservation) / [`ALTER RESERVATION`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_reservation)).
  2. **Terraform**: Declarative resource [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation).
  3. **bq CLI**: [`bq mk --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk) or [`bq update --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_update) when SQL DDL or Terraform is not available.
- **Details & Syntax**: See [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#1-create_reservation).

### 2. Fluid Autoscaling (`ENABLE_FLUID_AUTOSCALING`)

- Project-level setting enabling dynamic slot sharing.
- **Append Only**: Always append the reservation ID to `region-<location>.preflight_fluid_autoscaling_reservations`—**never overwrite** existing entries.
- **Implementation Hierarchy**:
  1. **SQL DDL**: Native BigQuery SQL ([`ALTER PROJECT SET OPTIONS`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_project)).
  2. **Terraform**: `terraform_data` provisioner executing the DDL.
  3. **bq CLI**: [`bq query`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_query) executing the DDL.
- **Details & SQL Syntax**: See [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#3-enable_fluid_autoscaling).

### 3. Permissions (`ALLOW_FLEXIBLE_ASSIGNMENT`)

- Grants `roles/bigquery.resourceEditor` (least-privilege predefined role providing `bigquery.reservations.use`) on the target reservation resource to each identity in `principals`.
- **Implementation Hierarchy** *(Note: BigQuery does not support SQL DDL for reservation-scoped IAM; the Terraform provider does not include a dedicated reservation IAM resource)*:
  1. **Terraform**: Declarative resource [`google_project_iam_member`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam#google_project_iam_member) with an IAM condition restricting `resource.name` to the specific reservation.
  2. **bq CLI**: Imperative [`bq set-iam-policy --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_set-iam-policy).
- **Details & Syntax**: See [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#4-allow_flexible_assignment).

### 4. Workload Routing (`RESERVATION_CONFIG`)

Routes target workloads to the designated reservation or on-demand (`"none"`):

- **For Data Models (`DAG_MODEL`)**: Implement using Masthead's open-source packages. Never hand-edit individual operator files.
  - **Dataform**: Configure `definitions/_reservations.js` via `@masthead-data/dataform-package`.
  - **dbt**: Configure `dbt_project.yml` via `masthead-data/bq_reservations`.
  - **Airflow**: Configure `reservations_config.json` via `airflow-reservations`.
  - *Full package setups and code examples*: See [orchestration-templates.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/orchestration-templates.md).
- **For Principals (`PRINCIPAL`)**: Implement identity-level routing:
  1. **SQL DDL**: Native BigQuery SQL DDL ([`CREATE ASSIGNMENT`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_assignment) / [`DROP ASSIGNMENT`](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#drop_assignment)) or session variable ([`SET @@reservation`](https://cloud.google.com/bigquery/docs/reference/standard-sql/system-variables)).
  2. **Terraform**: Declarative resource [`google_bigquery_reservation_assignment`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation_assignment).
  3. **bq CLI**: [`bq mk --reservation_assignment`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk) (with `--principal`) and [`bq rm --reservation_assignment`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_rm) when SQL DDL or Terraform is not available.
  - *Full commands, Terraform resources, and session examples*: See [principal-routing.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/principal-routing.md).

---

## Verification & Safeguards

Before submitting configuration diffs or marking proposals complete, perform the following validation checks:

### 1. Verify Capacity & Editions

```bash
bq query --project_id=ADMIN_PROJECT --location=LOCATION --nouse_legacy_sql --format=pretty \
"SELECT
  reservation_name,
  project_id,
  edition,
  slot_capacity,
  autoscale.max_slots AS autoscale_max_slots
FROM \`region-LOCATION.INFORMATION_SCHEMA.RESERVATIONS\`
ORDER BY project_id, reservation_name"
```

### 2. Validate Assignment Uniqueness & Syntax

- **No Duplicate Routing**: Each Dataform action, dbt model, Airflow task, or principal must appear in **exactly one** reservation target (`RESERVATION_CONFIG` group).
- **Compile Validation**:
  - Dataform: `dataform compile`
  - dbt: `dbt compile`
- **Verify Repository Scope**: Check that actions/models in the recommendation exist in the current project graph. Discard any obsolete model IDs.

---

## Decision Criteria: Reserved Slots vs. On-Demand

| Evaluation Factor | Reserved Slots (Autoscale) | On-Demand (`none`) |
| :--- | :--- | :--- |
| **Workload Profile** | High frequency, predictable queries, baseline data transforms. | Infrequent, bursty, exploratory queries, low slot-ms footprint. |
| **SLA & Performance** | Strict SLAs; requires guaranteed slot pool and priority scheduling. | Flexible timing; benefits from instant access to up to 2,000 on-demand slots. |
| **Cost Dynamics** | Economical for high slot-hour volumes under fixed/autoscale pricing. | Economical when queries scan modest data and run sporadically. |
| **Impact of Shift** | Protects organization budget from run-away query consumption. | Frees reservation slots for critical path workloads without throttling. |

---

## Common Anti-Patterns & Pitfalls

- **Overwriting Fluid Autoscaling**: Replacing the `preflight_fluid_autoscaling_reservations` array instead of appending new entries.
- **Treating `"reservation": "none"` as Missing**: Mistaking `"none"` for an unassigned error rather than deliberate on-demand routing.
- **Inconsistent Identifier Substitution**: Using different names for `BQ_ADMIN_PROJECT` or `RESERVATION_ID` across different steps of the same recommendation.
- **Ignoring `UNMET_PERFORMANCE` Warnings**: Moving performance-sensitive models to lower slot tiers when simulations flagged unmet latency thresholds.
- **Applying Sub-Zero Savings**: Implementing recommendations where `savings_30d < 0`.
- **Manual Pipeline Editing**: Attempting to set reservation flags on individual operators or BigQuery adapters instead of using the supported Masthead packages.
