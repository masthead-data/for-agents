# Contributing to Masthead Agent Skills

This guide explains how to develop and test Masthead agent skills locally against live BigQuery datasets.

## Development & Testing

When testing skills against a live BigQuery dataset, persist your configuration in the project root's `AGENTS.md` file:

```markdown
<!-- masthead -->
MASTHEAD_DATASET=your_dataset_name
<!-- /masthead -->
```

## Design Guidelines

When developing new skills or modifying existing ones, adhere to the following principles:

### User-Defined Review Formats and Processes
Do not enforce rigid output destinations (e.g. piping command results directly to specific CSV files). Instead, design steps so that they retrieve the relevant information (using standard formatting like `--format=pretty`) and allow the user or the agent to choose the most optimal format to store, present, or review the candidates (e.g., as a Markdown table, a CSV file, or an interactive terminal selection). Avoid assumptions about the intermediate file names in subsequent steps.

### Mandatory Human Review Before Applying Changes
Any action that applies BigQuery recommendations (e.g., pausing/disabling pipelines, dropping tables, altering billing models, updating reservation tags) must include an explicit instruction that these recommendations should be reviewed and verified by a human before they are executed. Never automate modifications or deletions without explicit user review and confirmation.


