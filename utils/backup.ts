import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

/**
 * Backup strategy:
 *  - exportBackupFile: writes a .json file with the full snapshot and opens the
 *    native share sheet, so the user can save it to iCloud / Google Drive / email.
 *  - importBackupFile: lets the user pick a previously exported .json and returns
 *    the parsed object to be fed into the store's importBackup().
 *
 * This is the FREE tier (manual, user-owned cloud). The PRO tier (automatic
 * background sync to iCloud/Drive and real-time multi-device) requires a
 * development build + native modules and is intentionally not wired here.
 */

export async function exportBackupFile(snapshot: object): Promise<boolean> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `domino-scorer-backup-${date}.json`;
    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(snapshot, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Guardar respaldo',
        UTI: 'public.json',
      });
      return true;
    }
    return false;
  } catch (e) {
    console.warn('export backup error', e);
    return false;
  }
}

export async function importBackupFile(): Promise<any | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const uri = result.assets[0].uri;
    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(content);
  } catch (e) {
    console.warn('import backup error', e);
    return null;
  }
}
