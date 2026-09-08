---
name: masthead-savings
description: Run the full Masthead FinOps audit across tables, datasets, pipelines, and data models. Same workflow as the Claude Code `/savings` command, invocable as `$masthead-savings` in Codex.
compatibility: Requires the Masthead MCP server and the four masthead-*-savings skills from this plugin.
---

# Masthead FinOps Audit

Run the Masthead FinOps advisory workflow, in this order:

0. Call the Masthead MCP tool `get_tenant_settings` once: it returns the insights dataset (`masthead-prod.<dataset>`) and the look-back window every skill below needs. If `insightsDataset.enabled` is `false`, stop — BigQuery export is not provisioned for this tenant.
1. Scan for dead-end or unused tables (`masthead-storage-savings-with-tables`).
2. Evaluate dataset storage billing models and expiration (`masthead-storage-savings-with-datasets`).
3. Identify orphan or dead-end data pipelines (`masthead-compute-savings-with-pipelines`).
4. Rebalance Dataform, dbt, or Airflow reservation compute (`masthead-compute-savings-with-data-models`).

Every step is advisory: produce review tables and user-executed scripts, never run `bq rm`, `bq update`, or pipeline changes yourself.
