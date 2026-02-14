---
name: git-release
description: Create a new release for gmail-sender-info. Generates a date-based version, bumps manifest.json, commits, tags, pushes, and creates a GitHub release.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Bash(date *), Read, Grep, Edit
---

# Create Release

Create a release for **gmail-sender-info** using a date-based version.

## Generate version

1. Run `date +"%Y.%-m%d.%-H.%M"` to produce the version string (e.g. `2026.214.12.30`). The format is `YYYY.MDD.H.MM` — Chrome requires 1-4 dot-separated integers, each 0-65535. Use this as the version for all subsequent steps.

## Pre-flight checks

2. Verify the working tree is clean (`git status`). Abort if there are uncommitted changes.
3. Verify you are on the `main` branch. Abort if not.
4. Pull latest from origin to ensure you're up to date.

## Version bump

5. Read `manifest.json` and update the `"version"` field to the generated version.
6. Commit the version bump: `chore: release <version>`

## Tag and push

7. Create an annotated git tag: `v<version>`.
8. Push the commit and tag to origin.

## Generate release notes

9. Collect all commit messages since the previous tag (`git log <prev-tag>..HEAD --oneline`). If there is no previous tag, use all commits.
10. Group commits into categories based on their prefix:
    - **Features** — commits starting with `feature`, `feat`, `add`
    - **Fixes** — commits starting with `fix`, `bugfix`
    - **Other** — everything else
11. Create a GitHub release using `gh release create v<version>` with the generated notes. Mark it as latest.

## Post-release

12. Report the release URL to the user.
