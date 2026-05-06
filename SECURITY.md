# Security Policy

## Supported versions

`stop-wasting-tokens` is currently in alpha. Only the latest published version on the `main` branch is supported. Pre-release versions (`v0.x.y`) may receive fixes only in the most recent release.

| Version | Supported |
|---------|-----------|
| latest pre-release | Yes |
| older pre-releases | No |

Once the project reaches v1.0, this matrix will be updated to cover at least the current major and the previous major.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, report privately by emailing the maintainer at:

> `security@stopwastingtokens.dev` *(placeholder — to be activated when the domain is registered; until then please use GitHub's private "Report a vulnerability" feature on the repository's Security tab)*

Include:

- A description of the issue and its potential impact.
- Steps to reproduce, including version numbers, OS, and Codex CLI version.
- Any proof-of-concept code or commands.

## Response process

1. We will acknowledge receipt within **72 hours**.
2. We will provide an initial assessment within **7 days**, including whether we accept the report and a tentative timeline.
3. We will work on a fix and coordinate disclosure with you. Standard target: a fix released within **90 days** of accepted disclosure.
4. Once a fix is released, we will publish a security advisory on GitHub crediting you (unless you prefer to remain anonymous).

## Scope

In scope:

- The `stop-wasting-tokens` source code in this repository.
- Published npm artefacts under the project name.
- Configuration parsing and command-line argument handling.

Out of scope:

- Bugs in the OpenAI Codex CLI itself — please report those upstream.
- Bugs in third-party dependencies — please report those to their respective projects (we will help with coordination if relevant).
- Issues that require administrative access to a user's machine to exploit.

## Safe harbour

We will not pursue legal action against researchers who:

- Make a good-faith effort to report vulnerabilities through the channel above.
- Avoid privacy violations, destruction of data, and interruption or degradation of services.
- Do not exploit a vulnerability beyond what is necessary to demonstrate it.

Thank you for helping keep `stop-wasting-tokens` and its users safe.
