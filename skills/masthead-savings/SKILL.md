---
name: masthead-savings
description: Run the full Masthead FinOps audit across tables, datasets, pipelines, data models, and slot commitments. Same workflow as the Claude Code `/savings` command, invocable as `$masthead-savings` in Codex.
compatibility: Requires the Masthead MCP server and the five masthead-*-savings skills from this plugin.
---

# Masthead FinOps Audit

Run the Masthead FinOps advisory workflow, in this order. If the user named a project, dataset, table, or a single area (tables, datasets, pipelines, models, commitments), restrict the audit to that and skip the other steps.

0. Call the Masthead MCP tool `get_tenant_settings` once: it returns the insights dataset (`masthead-prod.<dataset>`) and the look-back window every skill below needs. If `insightsDataset.enabled` is `false`, stop — BigQuery export is not provisioned for this tenant.
1. Scan for dead-end or unused tables (`masthead-storage-savings-with-tables`).
2. Evaluate dataset storage billing models and expiration (`masthead-storage-savings-with-datasets`).
3. Identify orphan or dead-end data pipelines (`masthead-compute-savings-with-pipelines`).
4. Rebalance Dataform, dbt, or Airflow reservation compute (`masthead-compute-savings-with-workload-assignments`).
5. Size slot commitments and reservation baselines (`masthead-compute-savings-with-capacity-commitments`).

Every step is advisory: produce review tables and user-executed scripts, never run `bq rm`, `bq update`, `CREATE CAPACITY`, or pipeline changes yourself.
