export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: bigint;
  folderPath: string;
  createdAt?: Date;
}
