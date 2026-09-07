# BigQuery Reservation Operations Reference

This reference provides the canonical SQL DDL and CLI commands for configuring BigQuery reservations, project options, and IAM permissions as dictated by Masthead compute-cost recommendations (`operations`).

> [!IMPORTANT]
> **Execution Hierarchy: SQL DDL First**:
> Always use native **BigQuery SQL DDL** (`CREATE RESERVATION`, `ALTER RESERVATION`, `ALTER PROJECT`) as the primary execution method.
> The `bq` CLI is used **only when BigQuery SQL DDL is not available**—specifically for setting reservation-scoped IAM policies in `ALLOW_FLEXIBLE_ASSIGNMENT` where no SQL DDL syntax exists.

---

## 1. `CREATE_RESERVATION`

Triggered when the recommendation establishes a new reservation for an unreserved or consolidated workload group.

- **Placeholders**: If `reservation` in the recommendation contains `BQ_ADMIN_PROJECT:location.RESERVATION_ID`, replace with the customer's reservation admin project and designated reservation name consistently across all operations.
- **Baseline Slots**: Always set `slot_capacity = 0`. Production workloads run on dynamic autoscaling for optimal cost efficiency.
- **Max Autoscaling**: Set `autoscale_max_slots` to the exact value from the operation.
- **Edition**: Set `edition` (`STANDARD`, `ENTERPRISE`, or `ENTERPRISE_PLUS`) from the operation.

### 1. BigQuery SQL DDL
Documentation: [BigQuery SQL CREATE RESERVATION](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_reservation)

```sql
CREATE RESERVATION `BQ_ADMIN_PROJECT.region-LOCATION.RESERVATION_ID`
OPTIONS (
  edition = ENTERPRISE,        -- from "edition"
  slot_capacity = 0,           -- autoscale only (baseline = 0)
  autoscale_max_slots = 450,   -- from "autoscale_max_slots"
  ignore_idle_slots = false
);
```

### 2. Google Terraform Resource
Documentation: [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation)

```hcl
resource "google_bigquery_reservation" "reservation" {
  name              = "RESERVATION_ID"
  project           = "ADMIN_PROJECT"
  location          = "LOCATION"
  slot_capacity     = 0
  edition           = "ENTERPRISE"
  ignore_idle_slots = false

  autoscale {
    max_slots = 450
  }
}
```

### 3. `bq` CLI (`bq mk`)
*Use `bq` only when SQL DDL or Terraform execution is not available.*
Documentation: [`bq mk --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk)

```bash
bq mk \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  --slots=0 \
  --edition=ENTERPRISE \
  --autoscale_max_slots=450 \
  --ignore_idle_slots=false \
  RESERVATION_ID
```

---

## 2. `ALTER_RESERVATION`

Triggered when resizing or modifying an existing reservation.

- **Target**: Use the exact existing reservation resource path from `reservation` (`<project>:<location>.<id>`).
- **Selective Update**: Only modify options that have changed (`autoscale_max_slots` and `edition` if updated).
- **Rollback Tracking**: Note `prev_max_reservation_size` in your proposal summary so the operator can roll back if needed.

### 1. BigQuery SQL DDL
Documentation: [BigQuery SQL ALTER RESERVATION](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_reservation)

```sql
ALTER RESERVATION `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID`
SET OPTIONS (autoscale_max_slots = 400);
```

### 2. Google Terraform Resource
Documentation: [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation)

```hcl
resource "google_bigquery_reservation" "reservation" {
  # Modify autoscale.max_slots on the existing reservation resource
  autoscale {
    max_slots = 400
  }
}
```

### 3. `bq` CLI (`bq update`)
*Use `bq` only when SQL DDL or Terraform execution is not available.*
Documentation: [`bq update --reservation`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_update)

```bash
bq update \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  --autoscale_max_slots=400 \
  RESERVATION_ID
```

---

## 3. `ENABLE_FLUID_AUTOSCALING`

Configures the BigQuery admin project to allow fluid autoscaling across reservations in the region.

> [!WARNING]
> **Append Only**: Always inspect the existing project configuration first. Append the new reservation ID to the existing list—**never overwrite** the array, or other reservations in the project will lose fluid autoscaling.

### 1. BigQuery SQL DDL
Documentation: [BigQuery SQL ALTER PROJECT](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#alter_project)

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

### 2. Terraform Pattern
Documentation: [`terraform_data`](https://developer.hashicorp.com/terraform/language/resources/terraform-data) / [`google_bigquery_reservation`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation)

Because project-level BigQuery options are governed via SQL DDL, maintain them in Terraform using a `terraform_data` provisioner that tracks reservation definitions:

```hcl
resource "terraform_data" "fluid_autoscaling_config" {
  triggers_replace = [
    sha256(join(",", sort([google_bigquery_reservation.reservation.name, "existing-reservation-1"])))
  ]

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -euo pipefail
      bq query \
        --project_id="ADMIN_PROJECT" \
        --location="LOCATION" \
        --nouse_legacy_sql \
        "ALTER PROJECT \`ADMIN_PROJECT\` SET OPTIONS (\`region-LOCATION.preflight_fluid_autoscaling_reservations\` = ['existing-reservation-1', '${google_bigquery_reservation.reservation.name}']);"
    EOT
  }

  depends_on = [
    google_bigquery_reservation.reservation
  ]
}
```

### 3. `bq` CLI (`bq query`)
*Use `bq` only when running SQL DDL directly via CLI.*
Documentation: [`bq query`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_query)

```bash
bq query \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --nouse_legacy_sql \
  "ALTER PROJECT \`ADMIN_PROJECT\` SET OPTIONS (\`region-LOCATION.preflight_fluid_autoscaling_reservations\` = ['existing-reservation-1', 'RESERVATION_ID']);"
```

---

## 4. `ALLOW_FLEXIBLE_ASSIGNMENT`

Grants listed service accounts or user identities permission to route jobs directly to the specific reservation (`bigquery.reservations.use`).

> [!IMPORTANT]
> **No SQL DDL Available**: BigQuery standard SQL does not support `GRANT` or `REVOKE` statements on reservation resources. To avoid granting project-wide reservation access, apply IAM bindings directly to the **reservation resource itself** using declarative Terraform or the `bq` CLI (`--reservation`).

- **Target Resource**: `ADMIN_PROJECT:LOCATION.RESERVATION_ID`
- **Role**: `roles/bigquery.resourceEditor` (supported least-privilege predefined role on reservations providing `bigquery.reservations.use`)
- **Terraform Resource**: [`google_bigquery_reservation_iam_member`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation_iam#google_bigquery_reservation_iam_member)
- **CLI Commands**: [`bq get-iam-policy`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_get-iam-policy) and [`bq set-iam-policy`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_set-iam-policy) with `--reservation`.

### 1. Google Terraform Resource
Documentation: [`google_bigquery_reservation_iam_member`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation_iam#google_bigquery_reservation_iam_member)

```hcl
resource "google_bigquery_reservation_iam_member" "flexible_assignment" {
  project     = "ADMIN_PROJECT"
  location    = "LOCATION"
  reservation = google_bigquery_reservation.reservation.name
  role        = "roles/bigquery.resourceEditor"
  member      = "serviceAccount:runner-sa@PROJECT.iam.gserviceaccount.com"
}
```

### 2. `bq` CLI (`bq get-iam-policy` / `bq set-iam-policy`)
*Used when Terraform is not managing IAM bindings.*

#### Step 1: Export Current Policy
Documentation: [`bq get-iam-policy`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_get-iam-policy)

```bash
bq get-iam-policy \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID > /tmp/policy.json
```

#### Step 2: Add Principal Binding
Update `/tmp/policy.json` to grant `roles/bigquery.resourceEditor` to the listed principals using `jq`:

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

#### Step 3: Apply Updated Policy to Reservation
Documentation: [`bq set-iam-policy`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_set-iam-policy)

```bash
bq set-iam-policy \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID \
  /tmp/updated_policy.json
```
