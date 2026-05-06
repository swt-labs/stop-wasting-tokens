export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never';

export interface PermissionProfile {
  readonly name: string;
  readonly sandbox_mode: SandboxMode;
  readonly approval_policy: ApprovalPolicy;
  readonly writable_roots: readonly string[];
}

export interface PermissionRequest {
  readonly profile: string;
  /** Tool the caller wants to invoke. */
  readonly tool: string;
  /** Backend-supplied arguments for the tool call. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Working directory the tool will run in. */
  readonly cwd: string;
}

export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Backend-agnostic permission validator. Wraps the backend's native sandbox
 * with an SWT-side bash safety pre-filter and named permission profiles.
 */
export interface PermissionGate {
  registerProfile(profile: PermissionProfile): Promise<void>;
  removeProfile(name: string): Promise<void>;
  evaluate(request: PermissionRequest): Promise<PermissionDecision>;
}
