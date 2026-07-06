# Rust Cargo External Libraries

A small VSCode extension that adds a **Rust External Libraries** tree to the Explorer panel.

It is designed for Rust projects, including Remote-WSL workspaces.

## Features

- Runs `cargo metadata --format-version=1`.
- Shows all Cargo packages where `source != null`.
- Groups dependencies by `registry`, `git`, and `path`.
- Expands dependency source directories directly from Cargo's real cache/checkouts.
- Opens files by clicking in the tree.
- Refreshes when `Cargo.toml` or `Cargo.lock` changes.
- Shows `rust-std` when `rust-src` is installed.
- Supports `Ctrl+Click` / `F12` from dependency names in `Cargo.toml` to dependency source.

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

Open a Rust workspace containing `Cargo.toml`. In Explorer, open:

```text
Rust External Libraries
```

Then expand:

```text
registry
  tokio 1.x.x
    src
      lib.rs
```

In `Cargo.toml`, use `Ctrl+Click` or `F12` on dependency names such as:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
bytes = "1"
```

The extension prefers `src/lib.rs` when available; otherwise it opens the dependency `Cargo.toml`.

## Notes

This extension does not modify your project and does not create symlinks. It only reads Cargo metadata and opens files from Cargo's dependency cache.

## Configuration

```json
{
  "rustExternalLibraries.includeHiddenFiles": false,
  "rustExternalLibraries.includeTargetDir": false,
  "rustExternalLibraries.maxDirectoryEntries": 500,
  "rustExternalLibraries.preferLibRsForCargoTomlDefinition": true
}
```
