# Local TLS certificate

Upstream NodeGoat shipped a self-signed private key here. It was removed (Gitleaks rule `private-key`) and purged from this repository's history before first publication.

The HTTPS server in `server.js` is commented out, and nothing in the repository needs a key. To try the A6 HTTPS fix locally, generate a throwaway pair; `*.key` and `*.pem` are git-ignored:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -subj "/CN=localhost" \
  -keyout artifacts/cert/server.key -out artifacts/cert/server.crt
```
