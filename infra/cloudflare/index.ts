import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

const config = new pulumi.Config();
const accountId = config.require("accountId");
const bucketName = config.get("bucketName") ?? "weatherv1-media";
const tenantId = config.get("tenantId") ?? "default";
const workerName = config.get("workerName") ?? "weatherv1-r2-gateway";
const allowedOrigin = config.get("allowedOrigin") ?? "*";
const workersDevSubdomain = config.get("workersDevSubdomain");
const zoneId = config.get("zoneId");
const routePattern = config.get("routePattern");
const r2Location = config.get("r2Location");
const r2StorageClass = config.get("r2StorageClass") ?? "Standard";

// Worker shared-credential auth. The username can be plain config; the
// password must be a Pulumi secret. Defaults to "weatherv1" if unset to keep
// `pulumi up` from breaking on existing stacks during the migration.
const appUsername = config.get("appUsername") ?? "weatherv1";
const appPassword = config.requireSecret("appPassword");
const cloudflareApiToken = config.requireSecret("cloudflareApiToken");
const r2ParentAccessKeyId = config.requireSecret("r2ParentAccessKeyId");

const workerPath = path.join(process.cwd(), "worker", "r2-gateway.js");
const workerContent = fs.readFileSync(workerPath, "utf8");
const workerHash = crypto.createHash("sha256").update(workerContent).digest("hex");

const bucket = new cloudflare.R2Bucket("media", {
  accountId,
  name: bucketName,
  location: r2Location,
  storageClass: r2StorageClass,
});

new cloudflare.R2BucketLifecycle("media-lifecycle", {
  accountId,
  bucketName: bucket.name,
  rules: [{
    id: "abort-incomplete-multipart",
    enabled: true,
    conditions: { prefix: "" },
    abortMultipartUploadsTransition: {
      condition: { type: "Age", maxAge: 60 * 60 * 24 },
    },
  }],
});

if (allowedOrigin !== "*") {
  new cloudflare.R2BucketCors("media-cors", {
    accountId,
    bucketName: bucket.name,
    rules: [{
      id: "weatherv1-app",
      allowed: {
        origins: [allowedOrigin],
        methods: ["GET", "PUT", "POST", "HEAD"],
        headers: ["authorization", "content-type", "x-amz-*"],
      },
      exposeHeaders: ["etag", "content-length"],
      maxAgeSeconds: 3600,
    }],
  });
}

const script = new cloudflare.WorkersScript("r2-gateway", {
  accountId,
  scriptName: workerName,
  content: workerContent,
  contentSha256: workerHash,
  contentType: "application/javascript+module",
  compatibilityDate: "2026-05-12",
  mainModule: "worker.js",
  bindings: [
    { name: "WEATHERV1_MEDIA", type: "r2_bucket", bucketName: bucket.name },
    { name: "CLOUDFLARE_ACCOUNT_ID", type: "plain_text", text: accountId },
    { name: "R2_BUCKET_NAME", type: "plain_text", text: bucket.name },
    { name: "DEFAULT_TENANT_ID", type: "plain_text", text: tenantId },
    { name: "ALLOWED_ORIGIN", type: "plain_text", text: allowedOrigin },
    { name: "WEATHERV1_APP_USERNAME", type: "secret_text", text: appUsername },
    { name: "WEATHERV1_APP_PASSWORD", type: "secret_text", text: appPassword },
    { name: "CLOUDFLARE_API_TOKEN", type: "secret_text", text: cloudflareApiToken },
    { name: "R2_PARENT_ACCESS_KEY_ID", type: "secret_text", text: r2ParentAccessKeyId },
  ],
}, { dependsOn: [bucket] });

if (workersDevSubdomain) {
  new cloudflare.WorkersScriptSubdomain("r2-gateway-workers-dev", {
    accountId,
    scriptName: script.scriptName,
    enabled: true,
    previewsEnabled: false,
  }, { dependsOn: [script] });
}

if (zoneId && routePattern) {
  new cloudflare.WorkersRoute("r2-gateway-route", {
    zoneId,
    pattern: routePattern,
    script: script.scriptName,
  });
}

// Cloudflare Pages: download / pitch-deck site.
// If you change `pagesProjectName`, also update `--project-name=` in
// .github/workflows/pitch-deck.yml — the workflow can't read Pulumi outputs.
const pagesProjectNameConfig = config.get("pagesProjectName") ?? "weatherv1-download";
const pagesProductionBranch = config.get("pagesProductionBranch") ?? "main";

const pitchDeckPages = new cloudflare.PagesProject("pitch-deck", {
  accountId,
  name: pagesProjectNameConfig,
  productionBranch: pagesProductionBranch,
  // No `source` block: direct-upload via wrangler-action in CI.
});

export const r2BucketName = bucket.name;
export const r2TenantPrefix = pulumi.interpolate`tenants/${tenantId}/`;
export const workerScriptName = script.scriptName;
export const workerRoute = routePattern
  ?? (workersDevSubdomain ? `https://${workerName}.${workersDevSubdomain}.workers.dev` : undefined);
export const pagesProjectName = pitchDeckPages.name;
export const pagesDefaultUrl = pulumi.interpolate`https://${pitchDeckPages.name}.pages.dev`;
