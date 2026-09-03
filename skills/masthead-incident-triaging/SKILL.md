---
name: masthead-incident-triaging
description: Triage, analyze downstream impact, and mitigate data quality and pipeline incidents using the Masthead MCP server.
compatibility: Requires connection to the Masthead MCP server at `https://mcp.mastheadata.com/mcp`.
---

# Real-Time Incident Triaging and Response

## Purpose

This skill instructs agents on how to triage, analyze, and resolve BigQuery data quality, pipeline failure, and anomaly incidents in real time using the Masthead MCP server tools.

## Prerequisites

* Active connection to the Masthead MCP server: `https://mcp.mastheadata.com/mcp`.
* Valid bearer token auth or service account configuration.
* For client setup guides and configuration templates, refer to the [Masthead MCP Server Setup Documentation](https://docs.mastheadata.com/developer/mcp/) and the [MCP Tools Reference](https://docs.mastheadata.com/developer/mcp/tools).

---

## Execution Modes

This skill supports two execution modes:

* **Recommendation Mode (Default)**: Investigates open incidents, analyzes upstream pipelines and downstream lineage impact, classifies severity, and drafts owner assignments and status updates. **Zero writes or modifications are made in this mode.**

* **Action Mode**: Applies assignments (`assign_incident_owner`), status transitions (`update_incident_status`), severity updates (`update_incident_severity`), and notes (`append_incident_notes`) directly to Masthead. **Requires explicit user sign-off on the proposed changes before executing.**

### Pacing Options

* **Step-by-Step**: Pauses after Phase 1 (Discovery) and Phase 2 (Impact Analysis) to summarize findings and confirm next steps before proceeding.
* **Straight Through**: Executes discovery and impact analysis continuously, presenting a full mitigation proposal for review.

---

## Triage Workflow

Incident response is structured into three consecutive phases: **Discovery & Triaging**, **Impact Analysis**, and **Mitigation/Resolution**.

### Phase 1: Discovery & Triaging

Find open incidents and extract full contextual failure details.

#### 1. List Monitored GCP Projects

Before querying incidents, retrieve the list of active GCP project IDs monitored for your tenant to use as filters.

* **Tool**: `list_projects`
* **Example Prompt**: *"List all GCP projects monitored by Masthead."*

#### 2. Scan Incidents

Fetch active anomalies and pipeline issues. Try to minimize the scope of your query by filtering with project IDs, technologies, and date ranges to find relevant incidents faster.

* The statuses `OPEN`, `IN_PROGRESS`, `ACKNOWLEDGED` require attention, while `FIXED`, `EXPECTED`, `NO_ACTION_NEEDED` are considered resolved or non-actionable.
* Filter the alertTiers to `CRITICAL` or `PRIORITY` to focus on high-impact incidents first.
* When filtering by date, start with the most recent dates (e.g., last 3 days) to find ongoing incidents, and expand the range if needed to find related past incidents.
* Based on the access to particular technologies (e.g., dbt, Airflow), filter by pipelineTypes to find relevant pipeline failure incidents.
* Development or staging projects (or the ones where there is no access) may have many non-actionable incidents that can create noise, so prioritize production projects first.
* If the total number of incidents exceeds the returned items, paginate through results to ensure you don't miss relevant incidents.

* **Tool**: `list_incidents` (`list_open_incidents` returns only the incidents that require attention)
* **Key Arguments**: `project`, `pipelineTypes`, `alertTiers`, `statuses`, `dataset`, `from`, `to`, `page`, `limit`
* **Example Prompt**: *"Show incidents in project your-project-id."*

#### 3. Retrieve Detailed Failure Logs

Use the incident group UUID to retrieve detailed descriptions of the failure, including the failing table, alert type, and raw error messages.

* **Tool**: `get_incident_details`
* **Key Arguments**: `incidentGroupUuid` (string)
* **Example Prompt**: *"Get details for volume incident on table project.dataset.table_id."*

---

### Phase 2: Impact Analysis

Check which upstream dependencies wrote to the table and what downstream tables, models, or dashboards will fail or receive corrupted data.

#### 1. Fetch Table Metadata

Check columns count, table type, and active anomaly statuses.

* **Tool**: `get_table_metadata`
* **Key Arguments**: `project`, `dataset`, `table`
* **Example Prompt**: *"Get metadata for table your-project-id.your_dataset.your_table."*

#### 2. Identify Upstream Writers / Pipelines

Determine what process or pipeline writes to the target table to see if a pipeline rerun or schedule adjustment is necessary.

* **Tool**: `get_table_pipelines`
* **Key Arguments**: `project`, `dataset`, `table`
* **Example Prompt**: *"Which pipelines write to your-project-id.your_dataset.your_table?"*

#### 3. Trace Downstream Lineage

Trace downstream tables and pipelines to assess blast radius.

* **Tool**: `get_table_lineage`
* **Key Arguments**: `project`, `dataset`, `table`
* **Example Prompt**: *"Show the lineage for table your-project-id.your_dataset.another_table to find downstream tables."*
* **Response Reading**: The tool returns a `ValueResponse`. Look for nodes in the `value.nodes` array where `positionType` is `DOWNSTREAM` and inspect their `info` (e.g., `value.nodes[].info.alertType`).

---

### Phase 3: Incident Response & Mitigation

Take immediate action to assign ownership, document investigation steps, adjust severity, and update the incident life-cycle.

#### 1. Lookup Authorized Users

Retrieve registered team members in your Masthead tenant to assign tasks correctly.

* **Tool**: `list_users`
* **Example Prompt**: *"List all active users in my Masthead tenant."*

#### 2. Assign Incident Owner

Route the incident to a specific team member.

* **Tool**: `assign_incident_owner`
* **Key Arguments**: `incidentGroupUuid`, `email`
* **Example Prompt**: *"Assign incidents on table project.dataset.table_id to <user@yourcompany.com>."*

#### 3. Adjust Status & Severity

Set the status and severity. Statuses: `FIXED`, `EXPECTED`, `NO_ACTION_NEEDED` are considered final and should be used when the incident is resolved or doesn't require any action.

* **Tools**: `update_incident_status`, `update_incident_severity`
* **Key Arguments**: `incidentGroupUuid`, `status` and/or `severity`
* **Example Prompt**: *"Mark incident freshness for table project.dataset.table_id as in progress and escalate it to P1."*

#### 4. Document Investigation (Notes)

Append audit log notes or comments documenting progress, pipeline rerun confirmations, or root-cause explanations.

* **Tool**: `append_incident_notes`
* **Key Arguments**: `incidentGroupUuid`, `notes` (string)
* **Example Prompt**: *"Add the note 'Investigating query schema change after release' to incident on table project.dataset.table_id."*

#### 5. Adjust Monitoring Priority (Optional)

For important data assets, elevate its monitoring tier to `PRIORITY` or `CRITICAL` to reduce the time to detect future incidents. On the other hand, if the data asset is not critical and you want to reduce noise, you can lower its monitoring tier to `REGULAR` or `MUTED`.

* **Tool**: `update_table_priority`
* **Key Arguments**: `project`, `dataset`, `table`, `priorityTier`
* **Example Prompt**: *"Set the monitoring priority for table your-project-id.your_dataset.your_table to PRIORITY."*

---

## Guidelines for AI Agents

* **Verify IDs**: Always invoke `list_projects` and `list_users` first to verify project and email values before executing queries or assignments.
* **Triage Order**: Always perform Phase 1 (Triage) and Phase 2 (Impact Analysis) before proposing Phase 3 (Mitigation) updates.
* **Human Review**: Do not silently update incidents without displaying the current state and getting user confirmation first.
* **Pagination & Large Datasets**: When retrieving list data (e.g., using `list_open_incidents` or `list_incidents`), pay close attention to the `total` number of records in the response. If the `total` count is larger than the number of returned items (e.g., limit is reached), you **MUST** paginate using the `page` (1-indexed) and `limit` parameters to explore all relevant items. Do not assume the first page contains all incidents.

---

## Web UI URL Reference

If the user asks to open or view an incident, table, or cost detail in the Masthead Web UI, construct and provide a clickable URL using the following templates:

* **Incident Details**: `https://app.mastheadata.com/incident/<incidentGroupUuid>/<lastIncidentId>`
* **Lineage**:
  * **Table view**: `https://app.mastheadata.com/lineage?project=<projectId>&dataset=<datasetId>&table=<tableId>`
  * **Pipeline view**: `https://app.mastheadata.com/lineage?uuid=<pipelineUUID>&type=TABLE&tab=pipeline_view`
* **Dictionary**:
  * **Table**: `https://app.mastheadata.com/dictionary/details?project=<projectId>&dataset=<datasetId>&table=<tableId>`
  * **Dashboards**: `https://app.mastheadata.com/dictionary/reporting-assets?uuid=<assetUUID>&type=<assetType>`
