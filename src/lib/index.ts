/**
 * Central exports for lib utilities. The Next API helpers were removed
 * in the Tauri-Tor pivot — community/channel CRUD now lives in the relay
 * (server/api.ts) and will move to Tauri Rust commands in Phase 3.
 */

export { prisma } from './prisma';
export { formatPublicId, truncatePublicId } from './format';
