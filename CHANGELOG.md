# Changelog

## 0.1.1

- Support VS Code folders containing multiple parallel Cargo projects.
- Discover nested `Cargo.toml` files and resolve their Cargo workspace roots.
- Deduplicate member manifests belonging to the same Cargo workspace.
- Route Cargo.toml Ctrl+Click/F12 lookups to the nearest Cargo workspace cache.
- Isolate metadata failures between independent Cargo projects.
- Include external path dependencies in the `path` group.
- Activate when `Cargo.toml` exists below the opened workspace folder.

## 0.1.0

Initial local build.

- Cargo metadata dependency tree.
- registry/git/path grouping.
- real source directory expansion.
- file opening.
- Cargo.toml/Cargo.lock refresh.
- rust-std support.
- Cargo.toml Ctrl+Click dependency definition provider.
