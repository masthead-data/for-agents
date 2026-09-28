# Custom Data Scan View Contract

| Column | Type | Meaning |
| --- | --- | --- |
| `table_reference` | `STRING` | `project.dataset.table` of the monitored table; incidents attach to it |
| `rule_name` | `STRING` | Metric name; stable, becomes the incident's metric |
| `timestamp` | `TIMESTAMP` | Start of the period the value describes |
| `value` | `INT64`, `FLOAT64`, `NUMERIC`, `BIGNUMERIC` | Metric value |

Masthead reads `SELECT * FROM <view> WHERE timestamp >= <window start>` on every run and resamples each `(table_reference, rule_name)` series to the scan frequency.

## Examples

### Daily row count of a date-partitioned table

```sql
SELECT
  'my-project.sales.orders' AS table_reference,
  'orders_row_count' AS rule_name,
  TIMESTAMP(order_date) AS `timestamp`,
  COUNT(*) AS value
FROM `my-project.sales.orders`
GROUP BY table_reference, rule_name, `timestamp`
```

### NULL rate of several columns, as percents

```sql
SELECT
  'my-project.crm.customers' AS table_reference,
  rule_name,
  `timestamp`,
  value
FROM (
  SELECT
    TIMESTAMP_TRUNC(updated_at, DAY) AS `timestamp`,
    100 * COUNTIF(email IS NULL) / COUNT(*) AS null_email_percent,
    100 * COUNTIF(phone IS NULL) / COUNT(*) AS null_phone_percent
  FROM `my-project.crm.customers`
  GROUP BY `timestamp`
)
UNPIVOT (value FOR rule_name IN (null_email_percent, null_phone_percent))
```

### A business metric per group

Daily compute cost per project, one series per project:

```sql
SELECT
  'my-project.finance.compute_cost_overview' AS table_reference,
  CONCAT('cost_usd / ', project) AS rule_name,
  TIMESTAMP(date) AS `timestamp`,
  SUM(cost_usd) AS value
FROM `my-project.finance.compute_cost_overview`
GROUP BY table_reference, rule_name, `timestamp`
```

### Hourly event volume

Use with frequency `HOURLY`:

```sql
SELECT
  'my-project.events.page_views' AS table_reference,
  'page_views' AS rule_name,
  TIMESTAMP_TRUNC(event_time, HOUR) AS `timestamp`,
  COUNT(*) AS value
FROM `my-project.events.page_views`
GROUP BY table_reference, rule_name, `timestamp`
```

## Common mistakes

| Mistake | Effect | Fix |
| --- | --- | --- |
| `WHERE date = '2026-09-25'` or another fixed date | Every later run finds no new rows, and each missing period is flagged | Remove it; Masthead adds its own time filter |
| `CURRENT_TIMESTAMP() AS timestamp` | Every row lands in the current period, and history collapses | Use the period the value describes |
| Ratio as a fraction (0–1) | The learned range is too wide to flag anything | Multiply by 100 |
| NULL in any column | The row is dropped, and the period may be flagged as missing | `IFNULL` or filter the NULLs out |
| Several rows for the same table, metric, and period | Only one of them is kept | Aggregate in the view |
