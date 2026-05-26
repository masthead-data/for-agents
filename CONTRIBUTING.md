# Contributing to Masthead Agent Skills

This guide explains how to develop and test Masthead agent skills locally against live BigQuery datasets.

## Development & Testing

When testing skills against a live BigQuery dataset, persist your configuration in the project root's `AGENTS.md` file:

```markdown
<!-- masthead -->
MASTHEAD_DATASET=your_dataset_name
<!-- /masthead -->
```
