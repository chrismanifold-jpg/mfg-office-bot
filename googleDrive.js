import { google } from "googleapis";

/**
 * Lists SOP files from Google Drive
 */
export async function listSOPFiles() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"]
  });

  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.list({
    q: "mimeType != 'application/vnd.google-apps.folder'",
    fields: "files(id, name, mimeType)"
  });

  return res.data.files || [];
}
