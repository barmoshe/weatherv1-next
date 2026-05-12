# WeatherV1 Cloudflare Infrastructure

Pulumi TypeScript project for the WeatherV1 R2 asset layer.

## Resources

- R2 bucket, default `weatherv1-media`
- R2 lifecycle rule that aborts incomplete multipart uploads after 24 hours
- Optional R2 CORS when `allowedOrigin` is not `*`
- Worker gateway with an R2 bucket binding
- Optional Worker route when `zoneId` and `routePattern` are set

## Required Config

```bash
pulumi config set accountId <cloudflare-account-id>
pulumi config set --secret appToken <weatherv1-app-token>
pulumi config set --secret cloudflareApiToken <cloudflare-api-token-with-r2-temp-credential-access>
pulumi config set --secret r2ParentAccessKeyId <r2-parent-access-key-id>
```

## Optional Config

```bash
pulumi config set bucketName weatherv1-media
pulumi config set tenantId default
pulumi config set workerName weatherv1-r2-gateway
pulumi config set workersDevSubdomain <account-workers-dev-subdomain-without-.workers.dev>
pulumi config set allowedOrigin http://127.0.0.1:3765
pulumi config set zoneId <zone-id>
pulumi config set routePattern r2.example.com/*
pulumi config set r2Location weur
pulumi config set r2StorageClass Standard
```

## Commands

```bash
npm install
npm run typecheck
npm run preview
npm run up
```
