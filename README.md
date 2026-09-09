# Rust Cargo External Libraries

A small VSCode extension that adds a **Rust External Libraries** tree to the Explorer panel.

It is designed for Rust projects, Cargo workspaces, multi-project folders, and Remote-WSL workspaces.

## Features

- Discovers `Cargo.toml` files recursively below each VS Code workspace folder.
- Resolves each manifest to its Cargo workspace root with `cargo locate-project --workspace`.
- Supports a parent folder containing multiple parallel Rust/Cargo projects.
- Deduplicates Cargo workspace members so one Cargo workspace is shown only once.
- Runs `cargo metadata --format-version=1 --manifest-path ...` for each discovered Cargo workspace.
- Groups external dependencies by `registry`, `git`, and `path`.
- Expands dependency source directories directly from Cargo's real cache/checkouts.
- Opens files by clicking in the tree.
- Refreshes when `Cargo.toml` or `Cargo.lock` changes.
- Shows `rust-std` when `rust-src` is installed.
- Supports `Ctrl+Click` / `F12` from dependency names in `Cargo.toml` to dependency source.
- Isolates metadata failures so one broken Cargo project does not hide other projects.

## Requirements

Inside the VSCode extension host environment, these commands must be available:

```bash
cargo --version
rustc --version
```

For standard library source:

```bash
rustup component add rust-src
```

For WSL projects, install/run this extension in the WSL extension host.

## Usage

You can open a Rust project directly:

```text
gmv/
  Cargo.toml
```

You can also open a parent folder containing multiple parallel Rust projects:

```text
rust/
  gmv/
    Cargo.toml
  gmv-center/
    Cargo.toml
  demo/
    Cargo.toml
```

In that case, **Rust External Libraries** groups dependencies by Cargo project/workspace:

```text
Rust External Libraries
  gmv
    registry
    git
    path
    rust-std
  gmv-center
    registry
    git
    path
    rust-std
```

For a normal Cargo workspace, member manifests are deduplicated and shown as one workspace:

```text
gmv/
  Cargo.toml
  guard/
    Cargo.toml
  session/
    Cargo.toml
```

In `Cargo.toml`, use `Ctrl+Click` or `F12` on dependency names such as:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
bytes = "1"
```

The extension prefers `src/lib.rs` when available; otherwise it opens the dependency `Cargo.toml`.

## Notes

This extension does not modify your Rust projects and does not create symlinks. It only discovers Cargo projects, reads Cargo metadata, and opens files from Cargo's dependency cache or path dependencies.

## Configuration

```json
{
  "rustExternalLibraries.includeHiddenFiles": false,
  "rustExternalLibraries.includeTargetDir": false,
  "rustExternalLibraries.maxDirectoryEntries": 500,
  "rustExternalLibraries.preferLibRsForCargoTomlDefinition": true
}
```
