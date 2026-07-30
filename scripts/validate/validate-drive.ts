import { GoogleDriveAdapterService } from '../../src/modules/drive/google-drive-adapter.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const folderId = parseArg('folder-id');
  if (!folderId) {
    throw new Error('Missing required argument: --folder-id <GOOGLE_DRIVE_FOLDER_ID>');
  }

  const drive = app.get(GoogleDriveAdapterService);
  const files = await drive.listFilesInFolderRecursive(folderId);

  return {
    folderId,
    totalDiscovered: files.length,
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      folderPath: file.folderPath,
      size: file.size,
    })),
  };
});
