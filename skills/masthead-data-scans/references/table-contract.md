# Data Scan Table Contract

| Column | Type | Meaning |
| --- | --- | --- |
| `table_reference` | `STRING` | `project.dataset.table` of the monitored table; incidents attach to it |
| `rule_name` | `STRING` | Metric name; stable, becomes the incident's metric |
| `timestamp` | `TIMESTAMP` | Start of the period the value describes |
| `value` | `INT64`, `FLOAT64`, `NUMERIC`, `BIGNUMERIC` | Metric value |

Masthead reads `SELECT * FROM <scan table> WHERE timestamp >= <window start>` on every run and resamples each `(table_reference, rule_name)` series to the scan frequency. The customer's scheduled refresh writes the table; Masthead never reads the source tables.

## Metric SQL

Write the metric once, with a window on the source's time column. `<from>` and `<to>` are period boundaries.

### Daily row count of a date-partitioned table

```sql
SELECT
  'my-project.sales.orders' AS table_reference,
  'orders_row_count' AS rule_name,
  TIMESTAMP(order_date) AS `timestamp`,
  COUNT(*) AS value
FROM `my-project.sales.orders`
WHERE order_date >= DATE(<from>) AND order_date < DATE(<to>)
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
  WHERE updated_at >= <from> AND updated_at < <to>
  GROUP BY `timestamp`
)
UNPIVOT (value FOR rule_name IN (null_email_percent, null_phone_percent))
```

### A business metric per group, zero-filled

Daily compute cost per project, one series per project. Every known project gets a row every day, including days without cost, so a quiet project isn't flagged as missing data:

```sql
WITH projects AS (
  SELECT DISTINCT project
  FROM `my-project.finance.compute_cost_overview`
  WHERE project IS NOT NULL
),
days AS (
  SELECT day
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE(<from>), DATE_SUB(DATE(<to>), INTERVAL 1 DAY))) AS day
),
daily AS (
  SELECT project, date AS day, SUM(cost_usd) AS cost_usd
  FROM `my-project.finance.compute_cost_overview`
  WHERE date >= DATE(<from>) AND date < DATE(<to>)
  GROUP BY project, day
)
SELECT
  'my-project.finance.compute_cost_overview' AS table_reference,
  CONCAT('cost_usd / ', p.project) AS rule_name,
  TIMESTAMP(d.day) AS `timestamp`,
  IFNULL(daily.cost_usd, 0) AS value
FROM projects AS p
CROSS JOIN days AS d
LEFT JOIN daily ON daily.project = p.project AND daily.day = d.day
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
WHERE event_time >= <from> AND event_time < <to>
GROUP BY table_reference, rule_name, `timestamp`
```

## History and refresh

The history SQL fills the table once; the refresh SQL is the scheduled query. Both replace `<from>` and `<to>` in the metric SQL with closed-period boundaries in UTC.

| Frequency | `<to>` (end of the last closed period) | History `<from>` | Refresh `<from>` |
| --- | --- | --- | --- |
| `DAILY` | `TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY)` | `<to>` minus 30 days | `<to>` minus 3 days |
| `EVERY_12_HOURS` | `TIMESTAMP_ADD(TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY), INTERVAL DIV(EXTRACT(HOUR FROM CURRENT_TIMESTAMP()), 12) * 12 HOUR)` | `<to>` minus 30 days | `<to>` minus 36 hours |
| `EVERY_6_HOURS` | `TIMESTAMP_ADD(TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY), INTERVAL DIV(EXTRACT(HOUR FROM CURRENT_TIMESTAMP()), 6) * 6 HOUR)` | `<to>` minus 30 days | `<to>` minus 18 hours |
| `HOURLY` | `TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), HOUR)` | `<to>` minus 14 days | `<to>` minus 3 hours |

Refresh template — recomputes the last 3 closed periods, so late source data and a missed run both heal on the next run:

```sql
MERGE `<project>.masthead_dq.<table_name>` AS t
USING (
  <metric SQL with the refresh window>
) AS s
ON t.table_reference = s.table_reference
  AND t.rule_name = s.rule_name
  AND t.`timestamp` = s.`timestamp`
WHEN MATCHED THEN UPDATE SET value = s.value
WHEN NOT MATCHED THEN INSERT ROW
```

## Common mistakes

| Mistake | Effect | Fix |
| --- | --- | --- |
| A rolling filter decides which series to keep (`HAVING SUM(cost) >= 1` over the last 30 days) | A series that drops under it stops getting rows and alerts as missing every period | Filter on something stable, or keep low-value series |
| A series without source rows in a period gets no row | The period is flagged as missing data | Zero-fill: cross join the series with the periods |
| `INSERT` instead of `MERGE` in the refresh | A rerun adds a second row for the same period; only one is kept | Use the `MERGE` template |
| The refresh runs after the processing delay | Masthead reads the period before its row exists and flags it as missing | Use the schedule from the skill, or raise `processDelayHours` |
| `CURRENT_TIMESTAMP() AS timestamp` | Every row lands in the current period, and history collapses | Use the period the value describes |
| The refresh includes the in-progress period | Its value is partial and changes on every run | End the window at the last closed period |
| Ratio as a fraction (0–1) | The learned range is too wide to flag anything | Multiply by 100 |
| NULL in any column | The row is dropped, and the period may be flagged as missing | `IFNULL` or filter the NULLs out |
| Several rows for the same table, metric, and period | Only one of them is kept | Aggregate in the metric SQL |
