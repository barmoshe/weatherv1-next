/// <reference types="vite/client" />

// Chromium File System Access API surface that TypeScript's DOM lib leaves out.

declare const __WEATHERV1_VERSION__: string;

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
}

interface Window {
  showDirectoryPicker(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker(options?: {
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
}
