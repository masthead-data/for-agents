---
description: Audit BigQuery storage and compute waste across tables, datasets, and pipelines
---

# Masthead FinOps Optimization

Run the Masthead FinOps advisory workflow:

0. Call the Masthead MCP tool `get_tenant_settings` once: it returns the insights dataset (`masthead-prod.<dataset>`) and the look-back window every skill below needs. If `insightsDataset.enabled` is `false`, stop — BigQuery export is not provisioned for this tenant.
1. Scan for dead-end or unused tables (`masthead-storage-savings-with-tables`).
2. Evaluate dataset storage billing models and expiration (`masthead-storage-savings-with-datasets`).
3. Identify orphan or dead-end data pipelines (`masthead-compute-savings-with-pipelines`).
4. Rebalance Dataform, dbt, or Airflow reservation compute (`masthead-compute-savings-with-data-models`).
