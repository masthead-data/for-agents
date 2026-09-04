---
description: Audit BigQuery storage and compute waste across tables, datasets, and pipelines
---

# Masthead FinOps Optimization

Run the Masthead FinOps advisory workflow:

1. Scan for dead-end or unused tables (`masthead-storage-savings-with-tables`).
2. Evaluate dataset storage billing models and expiration (`masthead-storage-savings-with-datasets`).
3. Identify orphan or dead-end data pipelines (`masthead-compute-savings-with-pipelines`).
4. Rebalance Dataform, dbt, or Airflow reservation compute (`masthead-compute-savings-with-data-models`).
