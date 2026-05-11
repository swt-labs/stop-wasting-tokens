# Dashboard — Permission Gates

> **Status:** stub — expanded at M2 (`UiPermissionGate` lands).
>
> **Canonical reference:** [`TDD2.md` §12](../../TDD2.md).
> **Implementing package:** `packages/dashboard/src/server/permission/`.

Some actions Pi triggers — running shell commands, network fetches, file writes outside `.swt-planning/` — need user approval before they execute. The Dashboard hosts the approval UI; the orchestrator routes Pi's `permission_request` events through a composite gate (config policy + UI gate) that returns the decision back to Pi via the `pi.approve` / `pi.reject` API surface.

M2 ships the `UiPermissionGate` + composite-gate plumbing. Until then, the dashboard renders permission requests as read-only events; approval defaults follow the project's `.swt-planning/config.json` policy.

This page expands at M2.
