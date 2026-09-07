# Principal Workload Routing Reference

This reference covers routing identity-based BigQuery workloads (`PRINCIPAL`) to slot reservations or on-demand compute pools based on Masthead compute recommendations.

When `operations` contains a `RESERVATION_CONFIG` action with `principals` (instead of `models`/`technology`), queries run by those service accounts or user identities are reassigned.

---

## 1. Native BigQuery SQL Principal Assignment (Recommended)

BigQuery natively supports assigning reservations directly to specific principals within a project using SQL DDL:

### Assign Principal to Reservation

```sql
CREATE ASSIGNMENT `ADMIN_PROJECT.region-LOCATION.RESERVATION_ID.ASSIGNMENT_NAME`
OPTIONS (
  assignee = 'projects/TARGET_PROJECT',
  job_type = 'QUERY',
  -- For service accounts:
  principal = 'principal://iam.googleapis.com/projects/-/serviceAccounts/runner-sa@PROJECT.iam.gserviceaccount.com'
  -- For users:
  -- principal = 'principal://goog/subject/user@domain.com'
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

## 2. Dedicated Source Project Assignment via `bq` CLI

If all workloads run by the principal are isolated in a dedicated project:

### Assign Project to Reservation

```bash
bq mk --reservation_assignment \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  --reservation_id=RESERVATION_ID \
  --job_type=QUERY \
  --assignee_type=PROJECT \
  --assignee_id=SOURCE_PROJECT
```

### Route Project Back to On-Demand

When routing an entire project back to on-demand, delete its query reservation assignment:

```bash
# 1. Identify assignment ID
bq ls --reservation_assignments \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID.ASSIGNMENT_ID

# 2. Delete the assignment
bq rm --reservation_assignment \
  --project_id=ADMIN_PROJECT \
  --location=LOCATION \
  ADMIN_PROJECT:LOCATION.RESERVATION_ID.ASSIGNMENT_ID
```

---

## 3. Session / Job-Level Reservation Assignment

When principals share a multi-tenant project and only specific script runs or queries should be routed:

### BigQuery Session SQL Variable

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

## 4. Pre-Requisite Permissions

Ensure every principal in the recommendation has been granted `roles/bigquery.resourceEditor` (which provides `bigquery.reservations.use`) on the target reservation resource (see [reservation-operations.md](file:///Users/maxostapenko/masthead/for-agents/skills/masthead-compute-savings-with-data-models/references/reservation-operations.md#4-allow_flexible_assignment)). Without this IAM binding, query jobs targeting the reservation will fail with permission denied errors.
