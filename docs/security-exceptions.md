# Security exceptions

Every scan in this pipeline blocks by default. This file is the complete list of
places where a finding is allowed through, why, and what limits the risk instead.
An exception is narrow (one image or one rule), keeps the scan running and visible,
and is reviewed on the date shown. Anything not listed here blocks.

Standard (midterm plan): block every vulnerability severity, including UNKNOWN and
unfixed findings, for npm dependencies (including dev dependencies), the application
image, and the image that is published and signed. Remove or replace any component
that cannot be patched.

Current status of that standard:

| Target | Gate | Findings at every severity |
|---|---|---|
| `package-lock.json` (prod + dev) | **blocks** (`sca.yml`) | 0 |
| Application image (Chainguard `node`, Wolfi) | **blocks** (`container-security.yml`) | 0 |
| Published image (same digest, re-scanned before push) | **blocks** (`publish-sign`) | 0 |
| `mongo:8.0` (third-party database image) | reports only: **EX-01** | see below |

## EX-01: official MongoDB image does not block

| | |
|---|---|
| **Scope** | The `mongo:8.0` image used by CI service containers, Docker Compose and `k8s/mongo.yaml`. Only this image; nothing this repository builds, signs or deploys. |
| **Scan** | `trivy image --scanners vuln --exit-code 0 mongo:8.0` on every run of `container-security.yml`; results are in the job log. |
| **Findings when raised (2026-11-27)** | Ubuntu 24.04 OS: 144 (137 MEDIUM, 7 LOW), most with no Ubuntu fix. Each of the 8 bundled Go tools (`bsondump`, `mongodump`, …): 4 (1 HIGH). `gosu`: 62 (1 CRITICAL, 25 HIGH). A bundled `js-yaml`: 5 (3 HIGH). |
| **Why it cannot meet the standard** | We do not build this image. Its OS packages have no available fix, and its bundled tools are compiled by MongoDB with older Go toolchains. Free hardened MongoDB images require a registry login, which would put a credential into pull-request jobs (against the "no secrets in PR jobs" rule, threat T1/T4). |
| **What was done instead** | Upgraded from end-of-life `mongo:4.4` (which had 99 findings per bundled tool, 1 CRITICAL each) to supported `mongo:8.0`; made possible by porting the app to MongoDB driver 7.8. |
| **Compensating controls** | No published port; reachable only on an internal network (`backend: internal: true` in Compose, ClusterIP in Kubernetes), enforced by Conftest (`policy/compose`, `policy/k8s`) in CI. Runs as uid 999, read-only root filesystem, all capabilities dropped, no privilege escalation, CPU/memory limits. Holds synthetic seed data only. The app no longer sends server-side JavaScript (`$where` removed, A1). |
| **Residual risk** | A vulnerability in `mongod` or its OS libraries reachable over the internal network from a compromised app container. The bundled tools and `gosu` are not used at runtime. |
| **Exit condition** | Move to a hardened MongoDB image that can be pulled without credentials, or pull one only in `main`-branch jobs, and make the scan blocking. |
| **Review** | By 2026-12-16 (final report), then with every MongoDB image update. |

## EX-02: the EC2 host has a public IP address

| | |
|---|---|
| **Scope** | `aws_instance.app` in `infra/deploy.tf` only, suppressed inline on that resource (Semgrep `aws-ec2-has-public-ip`, Checkov `CKV_AWS_88`). The rules still apply to every other resource. |
| **Why** | The host must reach GHCR (image), Sigstore (signature check), SSM and Secrets Manager. Without a public address that needs a NAT gateway (about $33/month) or four VPC interface endpoints (about $29/month) plus a NAT for GHCR and Sigstore anyway, which exceeds the course's $20/month budget. |
| **Compensating controls** | The security group has **no ingress rules** (egress 80/443 only) and the instance has **no SSH key pair**; both are enforced by the OPA policy `terraform.ec2` (`infra/ec2_policy.rego`, 14 unit tests in CI). The app binds to `127.0.0.1:4000` and MongoDB to an internal Docker network (Conftest `policy/compose`). Administration and the demo go through SSM Session Manager (IAM-authenticated, logged). IMDSv2 with hop limit 1. |
| **Residual risk** | The address is visible to internet scanners, which find no open port. Outbound traffic is not restricted by destination. |
| **Exit condition** | A private subnet with a NAT gateway or a GHCR pull-through cache, if the deployment outlives the course budget. |
| **Review** | By 2026-12-16 (final report). |

## Static analysis (Semgrep) rule exclusions

Excluded by rule id in `.github/workflows/sast.yml`; every other rule still blocks.
Each exclusion is backed by a test of the real control.

| Rule | Why it is a false positive here | Test of the real control |
|---|---|---|
| `express-cookie-session-no-expires` | Expiry is set with `maxAge`, which express-session recommends over `expires` | Smoke test asserts `Expires=` in `Set-Cookie` |
| `express-cookie-session-no-domain` | No `Domain` keeps the cookie host-only, stricter than any `Domain` value | Smoke test asserts no `Domain=` |
| `python.django.security.django-no-csrf-token` | Looks for Django's `{% csrf_token %}`, which Nunjucks does not have; the forms carry the `_csrf` field | Smoke test: forged POSTs without or with a wrong token get 403 |
| `express-check-csurf-middleware-usage` | Only recognises the `csurf` and `csrf` packages; protection is `csrf-sync` (`app/csrf.js`), which replaced the archived `csurf` | `test/ci/csrf.test.js`; smoke test: forged POSTs (including logout) get 403 |
