import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";

/**
 * Backup strategy (SDK 54+ File/Paths API):
 *  - exportBackupFile: writes a .json file with the full snapshot and opens the
 *    native share sheet, so the user can save it to iCloud / Google Drive / email.
 *  - importBackupFile: lets the user pick a previously exported .json and returns
 *    the parsed object to be fed into the store's importBackup().
 *
 * NOTE: This was previously broken because it imported the legacy API
 * (FileSystem.cacheDirectory / writeAsStringAsync / readAsStringAsync) which,
 * since Expo SDK 54, throws a deprecation error when called. The catch block
 * swallowed that error, so export/import silently did nothing.
 *
 * This version uses the new object-oriented File/Paths API, which is the
 * default export in SDK 54+.
 */

export async function exportBackupFile(snapshot: object): Promise<boolean> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `domino-scorer-backup-${date}.json`;

    // Create the file in the cache directory and write the JSON snapshot.
    const file = new File(Paths.cache, filename);
    // If a backup from today already exists, remove it first (write won't overwrite).
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(JSON.stringify(snapshot, null, 2));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Guardar respaldo",
        UTI: "public.json",
      });
      return true;
    }
    return false;
  } catch (e) {
    console.warn("export backup error", e);
    return false;
  }
}

export async function importBackupFile(): Promise<any | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;

    const uri = result.assets[0].uri;
    const file = new File(uri);
    const content = file.textSync();
    return JSON.parse(content);
  } catch (e) {
    console.warn("import backup error", e);
    return null;
  }
}
