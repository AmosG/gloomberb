import type { PluginPersistence } from "../../../types/plugin";
import type { NotesFiles } from "./files";
import type { CloudNotesStore } from "./store";

const MIGRATED_AT_KEY = "notes:migratedAt";

export interface NotesMigrationResult {
  uploaded: number;
  skipped: number;
}

export function notesMigratedAt(persistence: PluginPersistence | null): string | null {
  return persistence?.getState<string>(MIGRATED_AT_KEY) ?? null;
}

/**
 * First signed-in launch: every `.md` on disk goes up unless the cloud
 * already holds a newer copy. Files stay where they are; they are the export
 * format now. Idempotent through the migratedAt stamp, and a partial failure
 * leaves the stamp unset so the next launch retries.
 */
export async function migrateLocalNotes(
  files: NotesFiles,
  cloud: CloudNotesStore,
  persistence: PluginPersistence | null,
): Promise<NotesMigrationResult | null> {
  if (notesMigratedAt(persistence)) return null;
  const local = await files.list();
  const quickIndex = await files.loadQuickNotesIndex();
  const titles = new Map(quickIndex.map((entry) => [files.quickNoteKey(entry.id), entry.title]));
  const remote = new Map((await cloud.list()).map((entry) => [entry.key, entry]));

  let uploaded = 0;
  let skipped = 0;
  for (const entry of local) {
    const existing = remote.get(entry.key);
    if (existing && (existing.updatedAt >= entry.updatedAt || existing.text === entry.text)) {
      skipped += 1;
      continue;
    }
    if (existing) cloud.forgetRevision(entry.key);
    await cloud.save(entry.key, entry.text, { title: titles.get(entry.key) ?? null });
    uploaded += 1;
  }
  // Quick note tabs that exist in the index but have no body yet still get a title.
  for (const entry of quickIndex) {
    const key = files.quickNoteKey(entry.id);
    if (local.some((note) => note.key === key) || remote.has(key)) continue;
    await cloud.save(key, "", { title: entry.title });
    uploaded += 1;
  }
  persistence?.setState(MIGRATED_AT_KEY, new Date().toISOString());
  return { uploaded, skipped };
}
