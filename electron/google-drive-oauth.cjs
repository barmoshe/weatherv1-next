"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];
const OAUTH_PORTS = [39901, 39902, 39903, 39904];

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makePkce() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function formBody(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function listenOnceOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

async function createCallbackServer() {
  let lastError = null;
  for (const port of OAUTH_PORTS) {
    try {
      const server = await listenOnceOnPort(port);
      return { server, port };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("No OAuth callback port available");
}

async function exchangeCode({ clientId, code, redirectUri, verifier }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `OAuth token exchange failed with HTTP ${res.status}`);
  }
  return data;
}

async function runGoogleDriveOAuth({ clientId, openExternal }) {
  if (!clientId || typeof clientId !== "string") {
    throw new Error("Google OAuth client ID is required");
  }

  const { server, port } = await createCallbackServer();
  const { verifier, challenge } = makePkce();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = base64Url(crypto.randomBytes(24));

  const codePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Google OAuth timed out"));
    }, 120000);

    server.on("request", (req, res) => {
      try {
        const url = new URL(req.url || "/", redirectUri);
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== state) {
          throw new Error("OAuth state mismatch");
        }
        const error = url.searchParams.get("error");
        if (error) throw new Error(error);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Missing OAuth code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><title>WeatherV1</title><p>Google Drive connected. You can close this tab.</p>");
        clearTimeout(timeout);
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><title>WeatherV1</title><p>Google Drive authorization failed.</p>");
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  await openExternal(authUrl.toString());
  const code = await codePromise;
  return exchangeCode({ clientId, code, redirectUri, verifier });
}

module.exports = {
  SCOPES,
  runGoogleDriveOAuth,
};
