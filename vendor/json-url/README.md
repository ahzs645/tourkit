# Pinned sharing distribution

`web-share.js` is a self-contained browser ESM build of the json-url web-share
entry at revision `59de32db7ade287f7cf9cd22eb19933cbabefa8b` of
https://github.com/ahzs645/json-url (version 4.4.0). It registers exactly the six
codecs used by tutorial sharing: `lz`, `gz`, `df`, `zl`, `raw` and `hgz`.

The build plugin removes the other loader registrations from upstream
`src/main/codecs/index.ts`. The selected algorithms, web-share entry, `t1` token
format and checksum are unchanged. Fixed upstream tokens for all six codecs are
tested in `share.test.ts`. Unused LZW and LZMA implementations and their packages
are excluded. This is an internal distribution for `createTutorialShareCodec`,
which passes the supported codec list explicitly; it is not a general replacement
for json-url's full public API or its default codec list.

This checked-in distribution means Studio needs no json-url checkout or build
step. Normal installation, builds and checks use these
files without an upstream checkout or codec dependency installation. The normal
build/check commands verify the artifact, notices, build lock and builder against
their SHA-256 identities in `provenance.json`.

Upstream json-url is MIT-licensed. The bundled third-party packages retain their
own MIT, BSD-3-Clause or ISC licenses; `THIRD_PARTY_NOTICES.txt` includes every
bundled package's complete license text. Both that file and `LICENSE` must travel
with the distribution. `provenance.json` records the exact dependency versions,
input hashes, notices, compiler settings, codec selection and generated checksum.
Do not edit generated JavaScript.

## Reproduce or refresh deliberately

Use Node 22 or later and the exact esbuild version recorded in
`tooling/share-codec.lock.json` (installed by the kit's development dependencies).
Supply an explicit checkout of the pinned upstream revision, or a source snapshot
whose identities match the lock, with the locked dependency versions installed
in its `node_modules`. This includes the `assert`, `events` and `util` browser
polyfills. The tool does not download or install anything.

```sh
# Verify the checked-in distribution without changing it.
node tooling/build-share-codec.mjs /path/to/json-url --check

# Produce a separate candidate for inspection.
node tooling/build-share-codec.mjs /path/to/json-url --out-dir /tmp/share-codec-candidate

# Deliberately replace the four generated distribution/provenance/notice files.
node tooling/build-share-codec.mjs /path/to/json-url
```

The lock pins upstream source identities, the compiler, dependency file contents
and a canonical dependency layout. The builder verifies these inputs, recreates
that layout in a temporary directory and applies only the registry selection.
Different npm/pnpm hoisting layouts therefore produce the same output. Upstream
source snapshots may differ only in terminal LF characters; dependency files are
checked byte for byte. A Git checkout also has to identify the pinned revision.
Missing or empty license text is an error, including for copyleft dependencies.

Changing the upstream revision, compiler or dependency files requires an explicit
review of `tooling/share-codec.lock.json` and the registry selection. Regenerate
the bundle, provenance and notices together, run `build-share-codec.mjs --check`
with the source path, and rerun the six fixed token tests plus the normal kit
checks before committing. The declaration and this README are maintained by hand.
