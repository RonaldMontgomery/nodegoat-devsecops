# Draft Pipeline Review: NodeGoat

Ronald Montgomery | CAPS-CS.5023.01 | Due November 11, 2026

Repository: https://github.com/RonaldMontgomery/nodegoat-devsecops (solo project)

## Status note

NodeGoat now runs every control from Labs 2–8 and the Lab 10 signing work. Working: Gitleaks hook and CI scan, with upstream's private key and ZAP key purged from history; SHA-pinned actions with an enforcement check; CI build, lint, unit tests and a smoke test against seeded MongoDB; Terraform with Checkov and OPA; Conftest rules for Compose and Kubernetes; Restricted Pod Security and Kyverno manifests. The Semgrep, Trivy SCA and image gates run and correctly block. NodeGoat's 2016-era dependencies carry Critical CVEs and Semgrep flags its intentional flaws, so GHCR publishing, Cosign signing and provenance verification are wired but skipped until the gates pass. My custom taint rule found the eval() injection in contributions.js, and I fixed it.

In progress: triaging Semgrep findings, upgrading dependencies, EC2 deployment with Secrets Manager, and ZAP.

Unsure: upgrading the mongodb 2.x driver means rewriting every DAO, and it is what keeps MongoDB on end-of-life 4.4. Should I prioritize that, or replacing marked/swig first?

## Gate status

| Workflow | Expected result now | Why |
|---|---|---|
| Secret Scan | Pass | Full-history Gitleaks scan is clean after the pre-publication purge |
| Action Pinning | Pass | All `uses:` references are full SHAs |
| CI | Pass | Lint, 5 unit tests, smoke test |
| IaC Policy (static) | Pass | Policy and unit tests pass locally; Terraform and Checkov run in CI |
| IaC Policy (plan) | Skipped | Waiting for the `AWS_PLAN_ROLE_ARN` variable and a trust-policy update for this repo |
| SAST | **Fail (intended)** | Default ruleset flags NodeGoat's remaining OWASP Top 10 flaws |
| SCA | **Fail (intended)** | Critical CVEs in 2016-era dependencies |
| Container Security | **Fail (intended)**; publish/sign/verify skipped | Same dependencies ship in the image |

## Divergence from the midterm checkpoint architecture

| Midterm plan | Current build | Why |
|---|---|---|
| Images in **ECR**, pushed with AWS OIDC | Images in **GHCR**, pushed with `GITHUB_TOKEN` | Reused the working Lab 6/10 pipeline. Publishing needs no AWS credentials, which shrinks T1's attack surface. ECR remains an option once EC2 deployment exists. |
| Cosign `attest` with a hand-built in-toto/SLSA statement | Cosign keyless `sign` of the digest + `actions/attest-build-provenance`, verified with `gh attestation verify` and `cosign verify` | Lab 10 showed the GitHub attestation already produces signed SLSA provenance tied to the commit and run (T3, T8), with less custom code. |
| SCA and image gates block **every** severity, including UNKNOWN/unfixed | Block **CRITICAL** only, as in Labs 5/6 | NodeGoat's dependencies produce hundreds of lower-severity findings. A gate that fails on all of them can't show whether a change made things worse. I'll tighten it severity by severity as upgrades land. Nothing ships meanwhile because the Critical gate already blocks. |
| Trivy blocks on the **MongoDB** image too | `mongo:4.4` scan is **report-only** | 4.4 is end-of-life, but the mongodb 2.x driver can't connect to a supported server. Blocking would only become possible after the driver rewrite. |
| Local cluster on **minikube** with **OPA Gatekeeper** | Manifests target **kind** with **Kyverno**, plus Conftest in CI | Lab 8 was completed on kind + Kyverno. The planned registry/digest admission rule will be written in Kyverno rather than adding Gatekeeper. |
| Lab 7 workflow planned on PRs with a read-only AWS role | Terraform plan runs **only on `main`** | The midterm requires that PR jobs receive no cloud credentials (T1). Checkov and all policy tests still run on every PR. |
| Terraform for the EC2/Compose host | Terraform currently covers only the **S3 evidence bucket** | EC2, SSM and Secrets Manager wiring are next; the `deploy` job is a placeholder. |
| Node.js version unspecified (my-app uses Node 24) | **Node 22** LTS | Node 23 removed the deprecated `util.is*` helpers that 2016-era dependencies may call. |
| Single SAST rule for a hard-coded session secret | That rule plus `eval-of-request-input` and the my-app `child_process.exec` rule, each with `semgrep --test` cases | The taint rule found a real NodeGoat flaw (A1 SSJS injection), which is now fixed. |
| Upstream CI kept | Upstream `e2e-test.yml` and `lint.yml` removed | They used unpinned `@v1`/`@v2` actions and Node 10–14. jshint now runs inside `build-test`. |

## Known gaps

- `app/assets/vendor/` (jQuery 1.10.2 and other minified libraries) is excluded from Semgrep, and Trivy doesn't detect vendored browser libraries. These need replacing with npm-managed versions so SCA can see them.
- The `semgrep/semgrep` and `hadolint/hadolint` container images are referenced by tag, not digest, as in my-app. Pinning them by digest is planned.
- MongoDB has no authentication yet. The midterm plan calls for a scoped DB account.
- DAST (authenticated ZAP + BOLA tests) and Falco runtime detection are Lab 9/11 work.
