# Changesets

This folder is managed by [Changesets](https://changesets.dev) (v3). Each Markdown file here
describes one user-facing change: which packages it affects, the semver bump, and the text that
ends up in `CHANGELOG.md`.

## Adding a changeset

Run `pnpm changeset` in a branch that changes published behaviour, pick the bump and write a
short summary in English (it is copied into the changelog verbatim). Commit the generated file
together with the change. Changes that do not affect published packages (tests, tooling, docs,
the playground) do not need one.

## How versions move

- `@ganttlane/core`, `@ganttlane/dom` and `@ganttlane/react` form a **fixed** group: they are
  always released together with the same version, even if only one of them changed.
- Private workspace packages (the playground, internal fixtures) are never versioned or
  published (`privatePackages` in `config.json`).
- `pnpm version-packages` consumes the pending changesets, bumps versions, writes changelogs and
  refreshes the lockfile. `pnpm release` builds and publishes whatever is not on npm yet.

In CI both steps run from `.github/workflows/release.yml` (a "Version Packages" pull request,
then publishing with npm provenance once it is merged). See "Releasing" in the root `README.md`.

## First publish

Publishing stays off until the repository variable `RELEASE_ENABLED` is `'true'`; the checklist is
at the top of `.github/workflows/release.yml`. One step of it is done by hand:

- npm trusted publishers can only be configured for packages that exist, so publish `0.0.0`
  placeholders once from a maintainer machine (an npm account with 2FA):
  `pnpm build && pnpm -r --filter "./packages/*" publish --access public --no-git-checks`.
