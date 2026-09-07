# BigQuery Reservation Operations Reference

This reference provides the canonical SQL DDL and CLI commands for configuring BigQuery reservations, project options, and IAM permissions as dictated by Masthead compute-cost recommendations (`operations`).

---

## 1. `CREATE_RESERVATION`

Triggered when the recommendation establishes a new reservation for an unreserved or consolidated workload group.

- **Placeholders**: If `reservation` in the recommendation contains `BQ_ADMIN_PROJECT:location.RESERVATION_ID`, replace with the customer's reservation admin project and designated reservation name consistently across all operations.
- **Baseline Slots**: Always set `slot_capacity = 0`. Production workloads run on dynamic autoscaling for optimal cost efficiency.
- **Max Autoscaling**: Set `autoscale_max_slots` to the exact value from the operation.
- **Edition**: Set `edition` (`STANDARD`, `ENTERPRISE`, or `ENTERPRISE_PLUS`) from the operation.

```sql
CREATE RESERVATION `BQ_ADMIN_PROJECT.region-LOCATION.RESERVATION_ID`
OPTIONS (
  edition = ENTERPRISE,        -- from "edition"
  slot_capacity = 0,           -- autoscale only (baseline = 0)
  autoscale_max_slots = 450,   -- from "autoscale_max_slots"
  ignore_idle_slots = false
);
```

---

## 2. `ALTER_RESERVATION`

Triggered when resizing or modifying an existing reservation.

- **Target**: Use the exact existing reservation resource path from `reservation` (`<project>:<location>.<id>`).
- **Selective Update**: Only modify options that have changed (`autoscale_max_slots` and `edition` if updated).
- **Rollback Tracking**: Note `prev_max_reservation_size` in your proposal summary so the operator can roll back if needed.

```sql
ALTER RESERVATION `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID`
SET OPTIONS (autoscale_max_slots = 400);
```

---

## 3. `ENABLE_FLUID_AUTOSCALING`

Configures the BigQuery admin project to allow fluid autoscaling across reservations in the region.

> [!WARNING]
> **Append Only**: Always inspect the existing project configuration first. Append the new reservation ID to the existing list—**never overwrite** the array, or other reservations in the project will lose fluid autoscaling.

```sql
-- Step 1: Inspect existing project options
SELECT option_value
FROM `ADMIN_PROJECT.region-LOCATION.INFORMATION_SCHEMA.PROJECT_OPTIONS`
WHERE option_name = 'preflight_fluid_autoscaling_reservations';

-- Step 2: Append the reservation ID to the array
ALTER PROJECT `ADMIN_PROJECT`
SET OPTIONS (
  `region-LOCATION.preflight_fluid_autoscaling_reservations` = [
    -- Retain all existing reservations here
    'existing-reservation-1',
    'RESERVATION_ID'
  ]
);
```

---

## 4. `ALLOW_FLEXIBLE_ASSIGNMENT`

Grants listed service accounts or user identities permission to route jobs directly to the specific reservation (`bigquery.reservations.use`).

> [!IMPORTANT]
> **Reservation Resource Scope**: To avoid granting project-wide reservation access, apply IAM bindings directly to the **reservation resource itself** using the `bq` CLI (`--reservation`), rather than project-level IAM.

- **Target Resource**: `ADMIN_PROJECT:LOCATION.RESERVATION_ID`
- **Role**: `roles/bigquery.resourceEditor` (supported least-privilege predefined role on reservations providing `bigquery.reservations.use`)
- **CLI Commands**: [`bq get-iam-policy`](https://docs.cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_get-iam-policy) and [`bq set-iam-policy`](https://docs.cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_set-iam-policy) with `--reservation`.

### Step 1: Export Current Policy

```bash
bq get-iam-policy \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID > /tmp/policy.json
```

### Step 2: Add Principal Binding

Update `/tmp/policy.json` to grant `roles/bigquery.resourceEditor` to the listed principals.

**Using `jq`**:

```bash
jq '
  .bindings = (
    if (.bindings | any(.role == "roles/bigquery.resourceEditor")) then
      .bindings | map(
        if .role == "roles/bigquery.resourceEditor" then
          .members = ((.members + ["serviceAccount:runner-sa@PROJECT.iam.gserviceaccount.com"]) | unique)
        else . end
      )
    else
      .bindings + [{
        "role": "roles/bigquery.resourceEditor",
        "members": ["serviceAccount:runner-sa@PROJECT.iam.gserviceaccount.com"]
      }]
    end
  )
' /tmp/policy.json > /tmp/updated_policy.json
```

*(Or edit `/tmp/policy.json` directly to append the principal under the `roles/bigquery.resourceEditor` binding).*

### Step 3: Apply Updated Policy to Reservation
```bash
bq set-iam-policy \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID \
  /tmp/updated_policy.json
```
