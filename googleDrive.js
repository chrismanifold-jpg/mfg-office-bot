import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

export async function listSOPFiles() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON env variable");
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  const drive = google.drive({
    version: "v3",
    auth,
  });

  const response = await drive.files.list({
    pageSize: 20,
    fields: "files(id, name, mimeType)",
  });

  return response.data.files;
}