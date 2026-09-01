/**
 * The scheduling maths lives in `@erp/shared` because the API needs the same
 * "next run" calculation to report it to Gestión — see the note there. This
 * module only re-exports it so the agent's own imports stay local.
 */
export { nextRunAt, parseTimes, type ScheduledTime } from '@erp/shared';
