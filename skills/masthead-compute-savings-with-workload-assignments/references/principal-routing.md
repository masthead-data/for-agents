# Principal Workload Routing Reference

This reference covers routing identity-based BigQuery workloads (`PRINCIPAL`) to slot reservations or on-demand compute pools based on Masthead compute recommendations.

When `operations` contains a `RESERVATION_CONFIG` action with `principals` (instead of `models`/`technology`), queries run by those service accounts or user identities are reassigned.

Each element of `principals` is one BigQuery assignment to create, with every `OPTIONS` value precomputed:

```json
{
  "action": "RESERVATION_CONFIG",
  "reservation": "projects/ADMIN_PROJECT/locations/EU/reservations/RESERVATION_ID",
  "principals": [
    {
      "email": "etl-runner@my-project.iam.gserviceaccount.com",
      "principal": "principal://iam.googleapis.com/projects/-/serviceAccounts/etl-runner@my-project.iam.gserviceaccount.com",
      "source_project": "my-project",
      "job_type": "PIPELINE"
    }
  ]
}
```

| Field | Use as |
| --- | --- |
| `principal` | the `principal` option verbatim (`principal://goog/subject/…` for users, `principal://iam.googleapis.com/projects/-/serviceAccounts/…` for service accounts) |
| `source_project` | `assignee = 'projects/<source_project>'`—the project the principal's jobs run in, not the admin project |
| `job_type` | the `job_type` option: `QUERY` or `PIPELINE` (load, copy, extract). A principal running both kinds appears twice, once per kind—create both assignments |
| `email` | display only; never derive `principal` from it yourself |

`reservation` may name a reservation that does not exist yet (`BQ_ADMIN_PROJECT` / `RESERVATION_ID` placeholders): create it first with the row's `CREATE_RESERVATION` action, then use the same name here.

---

> [!IMPORTANT]
> **Execution Hierarchy: SQL DDL First**:
> Always use native **BigQuery SQL** (`CREATE ASSIGNMENT`, `DROP ASSIGNMENT`, `SET @@reservation`) as the primary execution method for routing principal workloads. Declarative Terraform is standard for infrastructure as code.
> The `bq` CLI commands (`bq mk/rm --reservation_assignment`) are provided **only as an alternative fallback** when SQL DDL or Terraform execution is unavailable.

---

## 1. BigQuery SQL DDL Principal Assignment

BigQuery natively supports assigning reservations directly to specific principals within a project using SQL DDL.
Documentation: [BigQuery SQL CREATE ASSIGNMENT](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_assignment) | [BigQuery SQL DROP ASSIGNMENT](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#drop_assignment)

### Assign Principal to Reservation

```sql
-- one statement per element of `principals`; values come from the element's fields
CREATE ASSIGNMENT `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID.ASSIGNMENT_NAME`
OPTIONS (
  assignee = 'projects/<source_project>',
  job_type = '<job_type>',            -- QUERY or PIPELINE
  principal = '<principal>'           -- principal://… string from the element
);
```

### Route Principal to On-Demand

To route a specific principal to on-demand compute pool, assign to `none`:

```sql
CREATE ASSIGNMENT `ADMIN_PROJECT.region-LOCATION.none.ASSIGNMENT_NAME`
OPTIONS (
  assignee = 'projects/TARGET_PROJECT',
  job_type = 'QUERY',
  principal = 'principal://iam.googleapis.com/projects/-/serviceAccounts/runner-sa@PROJECT.iam.gserviceaccount.com'
);
```

### Remove Assignment

```sql
DROP ASSIGNMENT `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID.ASSIGNMENT_NAME`;
```

---

## 2. Session / Job-Level Reservation Assignment (SQL Variable)

When principals share a multi-tenant project and only specific script runs or queries should be routed:

### BigQuery Session SQL Variable

Documentation: [BigQuery System Variables](https://cloud.google.com/bigquery/docs/reference/standard-sql/system-variables)

Configure the script, notebook, or application session:

```sql
SET @@reservation = 'projects/ADMIN_PROJECT/locations/LOCATION/reservations/RESERVATION_ID';
```

To reset to default / on-demand:

```sql
SET @@reservation = NULL;
```

### Client Library & BI Tool Configuration

In database connections (Looker, Metabase, Tableau, Python BigQuery Client):

- Configure connection property: `default_query_reservation = projects/ADMIN_PROJECT/locations/LOCATION/reservations/RESERVATION_ID`
- Or pass `configuration.query.reservation` on the job configuration when submitting query jobs.

---

## 3. Google Terraform Resource

Documentation: [`google_bigquery_reservation_assignment`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_reservation_assignment)

To manage workload assignments declaratively via Terraform:

```hcl
resource "google_bigquery_reservation_assignment" "query_assignment" {
  assignee    = "projects/SOURCE_PROJECT"
  job_type    = "QUERY"
  reservation = google_bigquery_reservation.reservation.id
}
```

---

## 4. `bq` CLI

*Use `bq` commands only when native SQL DDL or declarative Terraform is not available.*
Documentation: [`bq mk --reservation_assignment`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_mk) | [`bq rm --reservation_assignment`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_rm) | [`bq ls --reservation_assignments`](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference#bq_ls)

### Assign Project or Specific Principal to Reservation

```bash
# Project-wide assignment:
bq mk --reservation_assignment \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation_id=RESERVATION_ID \
  --job_type=QUERY \
  --assignee_type=PROJECT \
  --assignee_id=SOURCE_PROJECT

# Identity-specific principal assignment within project:
bq mk --reservation_assignment \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation_id=RESERVATION_ID \
  --job_type=QUERY \
  --assignee_type=PROJECT \
  --assignee_id=SOURCE_PROJECT \
  --principal="principal://iam.googleapis.com/projects/-/serviceAccounts/runner-sa@PROJECT.iam.gserviceaccount.com"
```

### Route Back to On-Demand

When routing an entire project or principal back to on-demand, delete its query reservation assignment:

```bash
# 1. Identify assignment ID
bq ls --reservation_assignments \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID

# 2. Delete the assignment
bq rm --reservation_assignment \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID.ASSIGNMENT_ID
```

---

## 5. Pre-Requisite Permissions (`ALLOW_FLEXIBLE_ASSIGNMENT`)

Ensure every principal in the recommendation has been granted `roles/bigquery.resourceEditor` (which provides `bigquery.reservations.use`) on the target reservation resource.

> [!NOTE]
> Because BigQuery standard SQL does **not** support `GRANT` statements on reservation resources, this permission must be granted using declarative Terraform ([`google_project_iam_member`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam#google_project_iam_member) with an IAM condition) or the `bq` CLI fallback (`bq get/set-iam-policy --reservation`). See [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-workload-assignments/references/reservation-operations.md#4-allow_flexible_assignment). Without this IAM binding, query jobs targeting the reservation will fail with permission denied errors.
