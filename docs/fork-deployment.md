# Deploying this fork

This fork ships the same kind of artifact as upstream: one self-contained `management.html`. CLIProxyAPI serves it at `/management.html`, and the file is identical on every operating system, so the steps below work for CLIProxyAPI hosts on **macOS** (Apple Silicon or Intel) and **Linux amd64** alike.

There are two ways to get the fork's panel onto a host:

- **Auto-update from the fork's releases** (recommended): the backend downloads the latest `management.html` from the fork, verifies its digest, and checks for new releases every 3 hours.
- **Manual install**: you place a verified `management.html` yourself and turn auto-update off.

## 1. Publish a release from the fork

1. Keep the fork **public**. The backend downloads release assets without authentication, so a private fork's asset returns 404 and the host falls back to the upstream panel.
2. Enable GitHub Actions in the fork. Forks start with workflows disabled; enable them from the fork's Actions tab.
3. Tag a version with a fork suffix, based on the upstream version you built from:

   ```bash
   git tag v1.26.0-rva.1
   ```

   ```bash
   git push origin v1.26.0-rva.1
   ```

   The existing release workflow builds `dist/index.html`, renames it to `management.html`, and publishes it as a non-draft, non-prerelease **Latest** release. GitHub attaches a `sha256` digest to the asset, which the backend checks before replacing its copy.
4. Confirm the release lists `management.html` with a digest.

## 2. Point each CLIProxyAPI host at the fork

Add the fork's URL to the host's `config.yaml`:

```yaml
management:
  panel-github-repository: "https://github.com/<owner>/Cli-Proxy-API-Management-Center"
```

Accepted forms are `https://github.com/<owner>/<repo>` (optionally with `.git` or extra path segments) and `https://api.github.com/repos/<owner>/<repo>` (optionally ending in `/releases/latest`). Anything else, including a bare `owner/repo`, a `git@` URL, a GitHub Enterprise host, or a `/releases/tags/...` URL, silently falls back to the upstream panel. You cannot pin a tag this way; use a manual install for that.

The backend checks once at startup and then every 3 hours, and runs at most one panel sync per 30 seconds. Changing the setting does not trigger a download. To apply it now, delete the cached file (location below) and load `/management.html` again, waiting 30 seconds after startup if the backend just started, or restart the backend.

### Where the panel file lives

The backend uses the first location that applies:

| Install | `management.html` location |
| --- | --- |
| `MANAGEMENT_STATIC_PATH` set | That directory, or that exact file path |
| `WRITABLE_PATH` set | `$WRITABLE_PATH/static/management.html` |
| Homebrew on Apple Silicon | `/opt/homebrew/etc/static/management.html` |
| Homebrew on Intel macOS | `/usr/local/etc/static/management.html` |
| Linuxbrew | `/home/linuxbrew/.linuxbrew/etc/static/management.html` |
| Release tarball (macOS or Linux amd64) | `<directory of config.yaml>/static/management.html` |
| Docker | `/CLIProxyAPI/static/management.html` (not a volume, so it is downloaded again when the container is recreated) |

### Verify

Open `http://<host>:<port>/management.html`, sign in, and open the System page. **Management UI Version** shows the fork's tag (for example `v1.26.0-rva.1`). If it shows an upstream version, see the silent-fallback cases below.

## 3. Manual install (no auto-update)

Use this for hosts that should not trust new tags automatically.

1. Download `management.html` from the fork's release and compare its checksum with the digest shown on the release page.

   On macOS:

   ```bash
   shasum -a 256 management.html
   ```

   On Linux:

   ```bash
   sha256sum management.html
   ```

2. Copy the file to the host's panel location from the table above.
3. Turn auto-update off so the backend never replaces it:

   ```yaml
   management:
     disable-auto-update-panel: true
   ```

## Trust and release integrity

Whoever can publish the fork's Latest release controls every host pointed at it. The panel runs with the management key, so treat release access like server access:

- Protect the fork owner's GitHub account with two-factor authentication or a passkey.
- Add a tag ruleset that limits creation of `v*` tags to the owner.
- Review upstream changes before tagging a release that includes them.
- A public fork needs no `GITHUB_TOKEN` on the host. If you set one to avoid rate limits, use a fine-grained token with no repository permissions.
- The release digest proves the file was not corrupted in transit. It does not prove the uploaded file is trustworthy, which is why hosts that need a pinned, reviewed panel should use the manual install.

## When a host silently shows the upstream panel

- The repository URL is not in an accepted form.
- The fork is private.
- The fork has no Latest release (drafts and prereleases do not count).
- The backend cannot reach GitHub. With a cached file it keeps that file and logs a warning; with no cached file it installs the upstream panel from `https://cpamc.router-for.me/` without a digest check.

## Staying current with upstream

Once a host points at the fork, it receives only the fork's releases, so upstream panel releases stop arriving until you publish a new fork release:

```bash
git fetch upstream
```

```bash
git rebase upstream/main
```

```bash
bun run verify
```

Then tag the next fork release from the new upstream base version (for example `v1.27.0-rva.1`) and push the tag.

## Pointing a host back at upstream

Set `management.panel-github-repository` back to `https://github.com/router-for-me/Cli-Proxy-API-Management-Center` (or remove the key), delete the cached `management.html`, and reload `/management.html` or restart the backend.

## Developing against a remote backend

Bun runs natively on macOS (Apple Silicon and Intel) and Linux amd64, and CI verifies the fork on both `ubuntu-latest` and `macos-latest`.

```bash
bun install --frozen-lockfile
```

```bash
bun run dev
```

Open `http://localhost:5173` and enter the backend address. Prefer an SSH tunnel to the backend's loopback port so `management.allow-remote` can stay `false`:

```bash
ssh -L 8317:127.0.0.1:8317 <host>
```

Then connect the UI to `http://localhost:8317`. If you do enable `allow-remote`, do it only behind TLS or an encrypted private network: an `http://` address sends the management key, and every credential the UI downloads, in cleartext.
