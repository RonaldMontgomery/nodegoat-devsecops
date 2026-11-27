# Local TLS certificate

Upstream NodeGoat shipped a self-signed private key here. It was removed (Gitleaks rule `private-key`) and purged from this repository's history before first publication.

NodeGoat now serves HTTPS only (fix for A6), and the session cookie is `Secure`, so it needs a key and certificate at startup. Nothing in the repository contains one. Create a throwaway self-signed pair for local runs:

```bash
scripts/dev-cert.sh          # writes artifacts/cert/tls.key and tls.crt (localhost, 30 days)
```

`*.key`, `*.crt` and `*.pem` are git-ignored and excluded from the Docker build context. The app reads the files from `TLS_KEY_FILE` / `TLS_CERT_FILE`, defaulting to this folder:

| Environment | Where the key comes from |
|---|---|
| Local `npm start` / `npm run dev` | `artifacts/cert/` (this folder) |
| CI smoke test | generated per run in `$RUNNER_TEMP`, never stored |
| Docker Compose | this folder, mounted read-only at `/run/secrets/tls` |
| Kubernetes | `nodegoat-tls` Secret (`kubectl create secret tls`), mounted at `/run/secrets/tls` |
| EC2 (planned) | AWS Secrets Manager, written to a tmpfs file by the host at startup |

The browser will warn about the self-signed certificate; that is expected for local and lab use.
