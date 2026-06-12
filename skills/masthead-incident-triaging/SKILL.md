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
* For client setup guides and configuration templates, refer to the [Masthead MCP Server Setup Documentation](https://docs.mastheadata.com/mcp) and the [MCP Tools Reference](https://docs.mastheadata.com/mcp/tools).

---

## Triage Workflow

Incident response is structured into three consecutive phases: **Discovery & Triaging**, **Impact Analysis**, and **Mitigation/Resolution**.

### Phase 1: Discovery & Triaging

Find open incidents and extract full contextual failure details.

#### 1. List Monitored GCP Projects
Before querying incidents, retrieve the list of active GCP project IDs monitored for your tenant to use as filters.
* **Tool:** `list_projects`
* **Example Prompt:** *"List all GCP projects monitored by Masthead."*

#### 2. Scan Open Incidents
Fetch active anomalies and pipeline issues.
* **Tool:** `list_open_incidents` (optionally `list_incidents`)
* **Key Arguments:** `limit` (int)
* **Example Prompt:** *"Show all open incidents in project masthead-prod."*

#### 3. Retrieve Detailed Failure Logs
Use the incident group UUID to retrieve detailed descriptions of the failure, including the failing table, alert type, and raw error messages.
* **Tool:** `get_incident_details`
* **Key Arguments:** `incidentGroupUuid` (string)
* **Example Prompt:** *"Get full details for incident a2e99118-a8e4-3b4d-a4bb-3bf718aea1d5."*

---

### Phase 2: Impact Analysis

Check which upstream dependencies wrote to the table and what downstream tables, models, or dashboards will fail or receive corrupted data.

#### 1. Fetch Table Metadata
Check columns count, table type, and active anomaly statuses.
* **Tool:** `get_table_metadata`
* **Key Arguments:** `project`, `dataset`, `table`
* **Example Prompt:** *"Get metadata for table masthead-prod.looker_pdt.LR_9MCT0_dataset_fields_history."*

#### 2. Identify Upstream Writers / Pipelines
Determine what process or pipeline writes to the target table to see if a pipeline rerun or schedule adjustment is necessary.
* **Tool:** `get_table_pipelines`
* **Key Arguments:** `project`, `dataset`, `table`
* **Example Prompt:** *"Which pipelines write to masthead-prod.looker_pdt.LR_9MCT0_dataset_fields_history?"*

#### 3. Trace Downstream Lineage
Trace downstream tables and pipelines to assess blast radius.
* **Tool:** `get_table_lineage`
* **Key Arguments:** `project`, `dataset`, `table`
* **Example Prompt:** *"Show the lineage for table masthead-prod.marcia.data_scans to find downstream tables."*
* **Response Reading:** Look for nodes where `positionType` is `DOWNSTREAM` and note their `alertType` or priority (e.g. `CRITICAL`).

---

### Phase 3: Incident Response & Mitigation

Take immediate action to assign ownership, document investigation steps, adjust severity, and update the incident life-cycle.

#### 1. Lookup Authorized Users
Retrieve registered team members in your Masthead tenant to assign tasks correctly.
* **Tool:** `list_users`
* **Example Prompt:** *"List all active users in my Masthead tenant."*

#### 2. Assign Incident Owner
Route the incident to a specific team member.
* **Tool:** `assign_incident_owner`
* **Key Arguments:** `incidentGroupUuid`, `email`
* **Example Prompt:** *"Assign incident a2e99118-a8e4-3b4d-a4bb-3bf718aea1d5 to taras.kolomoiets@mastheadata.com."*

#### 3. Adjust Status & Severity
Set the status (e.g., `OPEN`, `IN_PROGRESS`, `ACKNOWLEDGED`, `RESOLVED`) and severity (e.g., `P1`, `P2`, `P3`).
* **Tools:** `update_incident_status`, `update_incident_severity`
* **Key Arguments:** `incidentGroupUuid`, `status` or `severity`
* **Example Prompt:** *"Mark incident a2e99118-a8e4-3b4d-a4bb-3bf718aea1d5 as in progress and escalate it to P1."*

#### 4. Document Investigation (Notes)
Append audit log notes or comments documenting progress, pipeline rerun confirmations, or root-cause explanations.
* **Tool:** `append_incident_notes`
* **Key Arguments:** `incidentGroupUuid`, `notes` (string)
* **Example Prompt:** *"Add the note 'Investigating query schema change after release' to incident a2e99118-a8e4-3b4d-a4bb-3bf718aea1d5."*

#### 5. Adjust Monitoring Priority (Optional)
If the incident was resolved but the table is critical, elevate its monitoring tier to prevent future delayed alerts.
* **Tool:** `update_table_priority`
* **Key Arguments:** `project`, `dataset`, `table`, `priorityTier` (`CRITICAL` or `REGULAR`)
* **Example Prompt:** *"Set the monitoring priority for table masthead-prod.looker_pdt.LR_9MCT0_dataset_fields_history to CRITICAL."*

---

## Guidelines for AI Agents

* **Verify IDs:** Always invoke `list_projects` and `list_users` first to verify project and email values before executing queries or assignments.
* **Triage Order:** Always perform Phase 1 (Triage) and Phase 2 (Impact Analysis) before proposing Phase 3 (Mitigation) updates.
* **Human Review:** Do not silently mark incidents as `RESOLVED` or assign ownership without displaying the current state and getting user confirmation first.
