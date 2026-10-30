export const TRASH_RETENTION_DAYS=30;
export const TRASH_RETENTION_MS=TRASH_RETENTION_DAYS*24*60*60*1000;
export function trashExpiresAt(document){return typeof document?.deletedAt==='number'&&Number.isFinite(document.deletedAt)&&document.deletedAt>0?document.deletedAt+TRASH_RETENTION_MS:null;}
