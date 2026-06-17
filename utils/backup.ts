import { File, Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

/**
 * Backup strategy:
 *  - exportBackupFile:
 *      • Android → opens the native FOLDER picker (Storage Access Framework),
 *        so the user chooses exactly where to save the .json (Downloads, Drive
 *        folder, SD card, etc.). The file lands there directly.
 *      • iOS → opens the share sheet, which on iOS includes "Save to Files".
 *        iOS has no folder-picker concept the way Android does.
 *  - importBackupFile: lets the user pick a previously exported .json and returns
 *    the parsed object to feed into the store's importBackup().
 *
 * Why the split: expo-sharing's share sheet is for SENDING a file to an app,
 * not for saving into a folder. On Android many devices don't surface a
 * "save to folder" option there, which is why no folder choice appeared.
 * SAF is the correct Android API for letting the user pick a destination folder.
 */

export async function exportBackupFile(snapshot: object): Promise<boolean> {
  const json = JSON.stringify(snapshot, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `domino-scorer-backup-${date}.json`;

  try {
    if (Platform.OS === "android") {
      // Ask the user to pick a destination folder. Returns a SAF URI.
      const perm =
        await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) {
        // User cancelled the folder picker — fall back to the share sheet
        // so they still have a way to get the file out.
        return await shareFallback(json, filename);
      }

      // Create the file inside the chosen folder and write the JSON.
      const destUri = await StorageAccessFramework.createFileAsync(
        perm.directoryUri,
        filename,
        "application/json",
      );
      await StorageAccessFramework.writeAsStringAsync(destUri, json);
      return true;
    }

    // iOS (and web): write to cache, then open the share sheet → "Save to Files".
    return await shareFallback(json, filename);
  } catch (e) {
    console.warn("export backup error", e);
    return false;
  }
}

// Writes the JSON to a temp file and opens the OS share sheet.
async function shareFallback(json: string, filename: string): Promise<boolean> {
  try {
    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(json);

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
    console.warn("share fallback error", e);
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
