# Releasing IHOP

## First npm release

1. Confirm the package name is available and authenticate with an npm account
   that has two-factor authentication enabled.
2. Run:

   ```sh
   npm whoami
   npm run release:check
   npm publish --access public
   ```

3. Verify:

   ```sh
   npm view ihop version
   npx --yes ihop@latest --version
   ```

4. Create and push the matching git tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. Create a GitHub release from the tag using the matching changelog notes.

## Trusted publishing

After the package exists on npm:

1. Add `wmoralesdev/ihop` and `.github/workflows/publish.yml` as an npm trusted
   publisher.
2. Create a protected GitHub environment named `npm`.
3. Trigger **Publish to npm** manually from GitHub Actions for later releases.

The workflow uses GitHub OIDC and npm provenance, so it does not need a
long-lived npm token.

## Later releases

1. Move changelog entries from **Unreleased** into the new version.
2. Run `npm version patch`, `minor`, or `major`.
3. Push the commit and tag with `git push --follow-tags`.
4. Trigger the publish workflow and select the appropriate npm distribution
   tag.
