export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
] as const;

export interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
}

export interface DriveCatalogClient {
  findFolderByName(parentId: string, name: string): Promise<DriveFileMetadata | null>;
  createFolder(parentId: string, name: string): Promise<DriveFileMetadata>;
  findFileByName(parentId: string, name: string): Promise<DriveFileMetadata | null>;
  getFile(fileId: string): Promise<DriveFileMetadata>;
  downloadText(fileId: string): Promise<string>;
  createTextFile(parentId: string, name: string, content: string): Promise<DriveFileMetadata>;
  updateTextFile(fileId: string, content: string): Promise<DriveFileMetadata>;
}

export interface GoogleDriveRestClientOptions {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formBody(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export class GoogleDriveRestClient implements DriveCatalogClient {
  private accessToken: string | null;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly refreshToken?: string;

  constructor(opts: GoogleDriveRestClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.refreshToken = opts.refreshToken;
    this.accessToken = opts.accessToken ?? null;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!this.clientId || !this.refreshToken) {
      throw new Error("Google Drive is enabled but GOOGLE_CLIENT_ID and GOOGLE_REFRESH_TOKEN are not configured");
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description ?? data.error ?? `Google token refresh failed with HTTP ${res.status}`);
    }
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  private async request<T>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && retry && this.refreshToken) {
      this.accessToken = null;
      return this.request<T>(url, init, false);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google Drive request failed with HTTP ${res.status}${text ? `: ${text}` : ""}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as T;
  }

  private async listFirst(q: string): Promise<DriveFileMetadata | null> {
    const params = new URLSearchParams({
      q,
      pageSize: "1",
      fields: "files(id,name,mimeType,modifiedTime,md5Checksum)",
      spaces: "drive",
    });
    const data = await this.request<{ files?: DriveFileMetadata[] }>(
      `https://www.googleapis.com/drive/v3/files?${params}`,
    );
    return data.files?.[0] ?? null;
  }

  findFolderByName(parentId: string, name: string): Promise<DriveFileMetadata | null> {
    const escaped = escapeDriveQueryValue(name);
    const parent = escapeDriveQueryValue(parentId);
    return this.listFirst(
      `'${parent}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    );
  }

  createFolder(parentId: string, name: string): Promise<DriveFileMetadata> {
    return this.request<DriveFileMetadata>("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parents: [parentId],
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
  }

  findFileByName(parentId: string, name: string): Promise<DriveFileMetadata | null> {
    const escaped = escapeDriveQueryValue(name);
    const parent = escapeDriveQueryValue(parentId);
    return this.listFirst(
      `'${parent}' in parents and name = '${escaped}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    );
  }

  getFile(fileId: string): Promise<DriveFileMetadata> {
    const params = new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,md5Checksum" });
    return this.request<DriveFileMetadata>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`);
  }

  downloadText(fileId: string): Promise<string> {
    return this.request<string>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  }

  createTextFile(parentId: string, name: string, content: string): Promise<DriveFileMetadata> {
    const boundary = `weatherv1_${Math.random().toString(36).slice(2)}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ name, parents: [parentId], mimeType: "application/json" }),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    return this.request<DriveFileMetadata>(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,md5Checksum",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }

  updateTextFile(fileId: string, content: string): Promise<DriveFileMetadata> {
    return this.request<DriveFileMetadata>(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,modifiedTime,md5Checksum`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: content,
      },
    );
  }
}
