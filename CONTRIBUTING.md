# Contributing to Masthead Agent Skills

This guide explains how to develop and test Masthead agent skills locally against live BigQuery datasets.

## Development & Testing

When testing skills against a live BigQuery dataset, persist your configuration in `~/.masthead/config.json` or project-local `.masthead/config.json`:

```json
{
  "insights_dataset": "your_dataset_name"
}
```

## Design Guidelines

When developing new skills or modifying existing ones, adhere to the following principles:

### User-Defined Review Formats and Processes

Do not enforce rigid output destinations (e.g. piping command results directly to specific CSV files). Instead, design steps so that they retrieve the relevant information (using standard formatting like `--format=pretty`) and allow the user or the agent to choose the most optimal format to store, present, or review the candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Avoid assumptions about the intermediate file names in subsequent steps.

### Mandatory Human Review Before Applying Changes

Any action that applies BigQuery recommendations (e.g., pausing/disabling pipelines, dropping tables, altering billing models, updating reservation tags) must include an explicit instruction that these recommendations should be reviewed and verified by a human before they are executed. Never automate modifications or deletions without explicit user review and confirmation.

### BigQuery Action Hierarchy (SQL -> Terraform -> bq)

When guiding and describing examples in skills markdown, structure BigQuery implementation patterns according to the following precedence:
1. **Native BigQuery SQL DDL** (`CREATE/ALTER RESERVATION`, `ALTER PROJECT SET OPTIONS`, `CREATE/DROP ASSIGNMENT`, `SET @@reservation`). Native SQL is standardized, portable across tools and drivers, and provides transparent auditability.
2. **Terraform (Google Provider Resources)** (`hashicorp/google` resources such as `google_bigquery_reservation`, `google_bigquery_reservation_assignment`, `google_bigquery_reservation_iam_member`). Provide declarative Terraform configurations for enterprise infrastructure management.
3. **`bq` CLI** (`bq mk`, `bq update`, `bq rm`, `bq set-iam-policy`). Use `bq` only when SQL DDL is not available (e.g. reservation-scoped IAM policies where BigQuery SQL lacks `GRANT` syntax) or as a secondary command-line fallback when direct SQL or Terraform execution is not viable.

> [!NOTE]
> Consuming agents will determine which API client or execution method to use based on their internal runtime context and active credentials. However, skill engineering and documentation examples must strictly maintain this sequence: **SQL -> Terraform -> bq**.
