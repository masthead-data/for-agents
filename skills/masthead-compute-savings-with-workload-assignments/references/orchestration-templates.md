# Orchestration Workload Routing Reference

This reference provides the canonical configuration templates for data orchestration tools (Dataform, dbt, Airflow) when implementing `RESERVATION_CONFIG` actions from Masthead compute recommendations.

> [!IMPORTANT]
> **Canonical Package Usage**: Never route workloads by editing individual DAG operators, Dataform action SQL files, or dbt model SQL. Always use the canonical open-source Masthead packages detailed below.

---

## The `"reservation": "none"` Convention

When `reservation` is `"none"`, the listed models must execute on **on-demand compute capacity**. This is an intentional routing decision (e.g. for infrequent, bursty, or lightweight transformations) to preserve reservation slots for SLA-critical workloads.

---

## 1. Dataform

**Package**: [`@masthead-data/dataform-package`](https://github.com/masthead-data/dataform-package)

### Step 1: Add Package Dependency

In `package.json`:

```json
{
  "dependencies": {
    "@masthead-data/dataform-package": "^1.0.0"
  }
}
```

### Step 2: Configure `definitions/_reservations.js`

Create or update `definitions/_reservations.js` (prefixed with `_` so it executes first in Dataform's compilation queue):

```javascript
const { autoAssignActions } = require("@masthead-data/dataform-package");

const RESERVATION_CONFIG = [
  {
    reservation: 'projects/ADMIN_PROJECT/locations/LOCATION/reservations/RESERVATION_ID',
    actions: [
      'project.dataset.table_a',
      'project.dataset.table_b'
    ]
  },
  {
    reservation: 'none', // Routes to On-Demand capacity
    actions: [
      'project.dataset.table_ad_hoc'
    ]
  }
];

autoAssignActions(RESERVATION_CONFIG);
```

### Step 3: Validate

```bash
dataform compile
```

---

## 2. dbt

**Package**: [`masthead-data/bq_reservations`](https://github.com/masthead-data/dbt-reservations)

### Step 1: Add Package Dependency

In `packages.yml`:

```yaml
packages:
  - package: masthead-data/bq_reservations
    version: 0.1.0 # Use latest version from dbt hub
```

Then install dependencies:

```bash
dbt deps
```

### Step 2: Configure Root Model Settings

In root `dbt_project.yml` under `models:` (or in shared project configs):

```yaml
models:
  your_project:
    +sql_header: "{{ bq_reservations.assign_from_config() }}"
```

### Step 3: Add `RESERVATION_CONFIG` Variable

In `dbt_project.yml`:

```yaml
vars:
  RESERVATION_CONFIG:
    - reservation: 'projects/ADMIN_PROJECT/locations/LOCATION/reservations/RESERVATION_ID'
      models:
        - 'model.package.stg_orders'
        - 'model.package.fct_daily_sales'
    - reservation: 'none' # Routes to On-Demand capacity
      models:
        - 'model.package.int_infrequent_rollup'
```

### Step 4: Validate

```bash
dbt compile
```

---

## 3. Apache Airflow

**Package**: [`airflow-reservations`](https://github.com/masthead-data/airflow-reservations)

### Step 1: Add Package Dependency

In `requirements.txt`:

```text
airflow-reservations>=0.1.0
```

### Step 2: Configure `reservations_config.json`

Create or update `reservations_config.json` in the root of your `dags/` folder. Models in the recommendation map directly to `dag_id.task_id`:

```json
{
  "reservation_config": [
    {
      "reservation": "projects/ADMIN_PROJECT/locations/LOCATION/reservations/RESERVATION_ID",
      "tasks": [
        "core_pipeline.execute_transform",
        "hourly_sync.load_events"
      ]
    },
    {
      "reservation": "none",
      "tasks": [
        "reporting_dag.weekly_summary"
      ]
    }
  ]
}
```

---

## Checklist for All Orchestration Tools

1. **Uniqueness**: Ensure each model/action appears in **only one** reservation configuration entry.
2. **Graph Consistency**: Verify all action names / model IDs exist in the active repository graph. Filter out any obsolete models.
3. **Execution Freshness**: Changes take effect on the next scheduled orchestration run.
