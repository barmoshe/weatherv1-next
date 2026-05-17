# WINDOWS_INSTALLER_R2_TASK — Archived

Moved the public Windows installer to R2 via the existing Worker; dropped the GitHub Release asset; macOS is local-build only. Shipped: `.github/workflows/desktop-publish-release.yml` writes to R2; the Worker serves `/downloads/*`. Current procedure: [`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md).
