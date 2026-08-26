/**
 * Fixed, narrow IPC channel names — the ONLY surface exposed to the
 * launcher renderer (see `preload.ts`). No generic `invoke(channel,
 * payload)` bridge exists anywhere in this app; every channel here has
 * one fixed purpose and a validated request/response shape (Prompt #20
 * §11).
 */
export const IPC = {
  GET_DESKTOP_CONFIG: 'erp:get-desktop-config',
  GET_APP_INFO: 'erp:get-app-info',
  TEST_SERVER: 'erp:test-server',
  SAVE_SERVER: 'erp:save-server',
  OPEN_WORKSPACE: 'erp:open-workspace',
  CREATE_WORKSPACE_SHORTCUTS: 'erp:create-workspace-shortcuts',
  // Main -> renderer, one-directional, fixed payload shape.
  WORKSPACE_LOAD_FAILED: 'erp:workspace-load-failed',
  SHOW_CONFIG_SCREEN: 'erp:show-config-screen',
} as const;
