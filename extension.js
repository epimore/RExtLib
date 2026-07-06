"use strict";

const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const VIEW_ID = "rustExternalLibraries";
const OUTPUT_NAME = "Rust External Libraries";

let output;
let provider;
let definitionProvider;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  output = vscode.window.createOutputChannel(OUTPUT_NAME);

  provider = new RustExternalLibrariesProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("rustExternalLibraries.refresh", async () => provider.refresh(true)),
    vscode.commands.registerCommand("rustExternalLibraries.openCargoToml", openCargoToml),
    vscode.commands.registerCommand("rustExternalLibraries.openDirectory", openDirectory),
    vscode.commands.registerCommand("rustExternalLibraries.revealInExplorer", revealInExplorer),
    output
  );

  definitionProvider = new CargoTomlDependencyDefinitionProvider(provider);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [
        { scheme: "file", pattern: "**/Cargo.toml" },
        { scheme: "vscode-remote", pattern: "**/Cargo.toml" },
        { language: "toml", pattern: "**/Cargo.toml" }
      ],
      definitionProvider
    )
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/{Cargo.toml,Cargo.lock}");
  let refreshTimer;
  const scheduleRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => provider.refresh(false), 500);
  };
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);
  context.subscriptions.push(watcher);

  provider.refresh(false);
}

function deactivate() {}

class RustExternalLibrariesProvider {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    /** @type {LibNode[]} */
    this.roots = [];
    /** @type {Map<string, WorkspaceCache>} */
    this.caches = new Map();
    this.lastError = undefined;
  }

  /** @param {boolean} showMessage */
  async refresh(showMessage) {
    try {
      const folders = getWorkspaceFoldersWithCargoToml();
      this.caches.clear();
      this.roots = [];

      if (folders.length === 0) {
        this.roots = [LibNode.info("No Cargo.toml found in the current workspace.")];
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      const workspaceNodes = [];

      for (const folder of folders) {
        const cache = await loadWorkspaceCache(folder);
        this.caches.set(folder.uri.toString(), cache);
        const groups = buildGroupNodes(cache);

        if (folders.length === 1) {
          this.roots = groups;
        } else {
          workspaceNodes.push(LibNode.group(folder.name, groups, folder.uri.fsPath));
        }
      }

      if (folders.length > 1) {
        this.roots = workspaceNodes;
      }

      this.lastError = undefined;
      this._onDidChangeTreeData.fire(undefined);

      if (showMessage) {
        const total = Array.from(this.caches.values()).reduce((n, c) => n + c.packages.length, 0);
        vscode.window.showInformationMessage(`Rust External Libraries refreshed: ${total} dependency packages.`);
      }
    } catch (err) {
      this.lastError = err;
      this.roots = [LibNode.error(formatError(err))];
      this._onDidChangeTreeData.fire(undefined);
      logError("Failed to refresh Rust External Libraries", err);
      if (showMessage) {
        vscode.window.showErrorMessage(`Rust External Libraries: ${formatError(err)}`);
      }
    }
  }

  /** @param {LibNode | undefined} element */
  getChildren(element) {
    if (!element) {
      return this.roots;
    }

    if (element.children) {
      return element.children;
    }

    if ((element.kind === "crate" || element.kind === "dir" || element.kind === "rustStd") && element.fullPath) {
      return readDirectoryNodes(element.fullPath);
    }

    return [];
  }

  /** @param {LibNode} element */
  getTreeItem(element) {
    return element;
  }

  /** @param {vscode.Uri | undefined} uri */
  getCacheForUri(uri) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!uri && folders.length === 1) {
      return this.caches.get(folders[0].uri.toString());
    }

    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    if (folder) {
      const exact = this.caches.get(folder.uri.toString());
      if (exact) return exact;
    }

    if (this.caches.size === 1) {
      return Array.from(this.caches.values())[0];
    }

    return undefined;
  }
}

class LibNode extends vscode.TreeItem {
  /**
   * @param {string} label
   * @param {string} kind
   * @param {string | undefined} fullPath
   * @param {LibNode[] | undefined} children
   * @param {object | undefined} extra
   */
  constructor(label, kind, fullPath, children, extra) {
    const collapsibleState = kind === "file" || kind === "info" || kind === "error"
      ? vscode.TreeItemCollapsibleState.None
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(label, collapsibleState);

    this.kind = kind;
    this.fullPath = fullPath;
    this.children = children;
    this.extra = extra ?? {};
    this.contextValue = kind;

    if (fullPath) {
      this.resourceUri = vscode.Uri.file(fullPath);
      this.tooltip = fullPath;
    }

    if (kind === "file" && fullPath) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [vscode.Uri.file(fullPath)]
      };
    }

    if (kind === "crate") {
      this.description = this.extra.version ? String(this.extra.version) : undefined;
      this.tooltip = `${label}\n${fullPath ?? ""}`;
    }

    if (kind === "info") {
      this.iconPath = new vscode.ThemeIcon("info");
    } else if (kind === "error") {
      this.iconPath = new vscode.ThemeIcon("error");
    } else if (kind === "group") {
      this.iconPath = new vscode.ThemeIcon("library");
    } else if (kind === "rustStd") {
      this.iconPath = new vscode.ThemeIcon("symbol-namespace");
    }
  }

  /** @param {string} label @param {LibNode[]} children @param {string | undefined} fullPath */
  static group(label, children, fullPath) {
    return new LibNode(label, "group", fullPath, children);
  }

  /** @param {string} message */
  static info(message) {
    return new LibNode(message, "info");
  }

  /** @param {string} message */
  static error(message) {
    return new LibNode(message, "error");
  }
}

/**
 * @typedef {Object} WorkspaceCache
 * @property {vscode.WorkspaceFolder} folder
 * @property {any} metadata
 * @property {any[]} packages
 * @property {Map<string, any>} packageById
 * @property {Map<string, any[]>} packagesByName
 * @property {Map<string, string>} aliasToPackageName
 * @property {string | undefined} rustStdPath
 */

/** @returns {vscode.WorkspaceFolder[]} */
function getWorkspaceFoldersWithCargoToml() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.filter(folder => fs.existsSync(path.join(folder.uri.fsPath, "Cargo.toml")));
}

/** @param {vscode.WorkspaceFolder} folder @returns {Promise<WorkspaceCache>} */
async function loadWorkspaceCache(folder) {
  const metadata = await execFileJson("cargo", ["metadata", "--format-version=1"], folder.uri.fsPath);
  const workspaceMemberIds = new Set(metadata.workspace_members ?? []);

  const packages = (metadata.packages ?? [])
    .filter(pkg => pkg && pkg.source !== null && !workspaceMemberIds.has(pkg.id));

  const packageById = new Map();
  const packagesByName = new Map();
  const aliasToPackageName = new Map();

  for (const pkg of metadata.packages ?? []) {
    packageById.set(pkg.id, pkg);
    if (!packagesByName.has(pkg.name)) {
      packagesByName.set(pkg.name, []);
    }
    packagesByName.get(pkg.name).push(pkg);

    for (const dep of pkg.dependencies ?? []) {
      if (dep.rename && dep.name) {
        aliasToPackageName.set(dep.rename, dep.name);
      }
    }
  }

  const rustStdPath = await findRustStdPath(folder.uri.fsPath);

  return {
    folder,
    metadata,
    packages,
    packageById,
    packagesByName,
    aliasToPackageName,
    rustStdPath
  };
}

/** @param {WorkspaceCache} cache @returns {LibNode[]} */
function buildGroupNodes(cache) {
  const registry = [];
  const git = [];
  const pathDeps = [];

  const sorted = [...cache.packages].sort(comparePackages);

  for (const pkg of sorted) {
    const manifestPath = normalizeCargoPath(pkg.manifest_path);
    const crateDir = path.dirname(manifestPath);
    const node = new LibNode(
      pkg.name,
      "crate",
      crateDir,
      undefined,
      {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        manifestPath,
        source: pkg.source
      }
    );

    if (String(pkg.source).startsWith("registry+")) {
      registry.push(node);
    } else if (String(pkg.source).startsWith("git+")) {
      git.push(node);
    } else {
      pathDeps.push(node);
    }
  }

  const groups = [];
  if (registry.length) groups.push(LibNode.group(`registry (${registry.length})`, registry));
  if (git.length) groups.push(LibNode.group(`git (${git.length})`, git));
  if (pathDeps.length) groups.push(LibNode.group(`path (${pathDeps.length})`, pathDeps));

  if (cache.rustStdPath) {
    groups.push(new LibNode("rust-std", "rustStd", cache.rustStdPath));
  } else {
    groups.push(LibNode.info("rust-std not found. Run: rustup component add rust-src"));
  }

  if (groups.length === 0) {
    groups.push(LibNode.info("No external Cargo dependencies found."));
  }

  return groups;
}

/** @param {string} dir @returns {LibNode[]} */
function readDirectoryNodes(dir) {
  const config = vscode.workspace.getConfiguration("rustExternalLibraries");
  const includeHidden = config.get("includeHiddenFiles", false);
  const includeTargetDir = config.get("includeTargetDir", false);
  const maxEntries = config.get("maxDirectoryEntries", 500);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return [LibNode.error(formatError(err))];
  }

  const nodes = entries
    .filter(e => shouldShowEntry(e.name, includeHidden, includeTargetDir))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, maxEntries)
    .map(e => {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        return new LibNode(e.name, "dir", fullPath);
      }
      return new LibNode(e.name, "file", fullPath);
    });

  if (entries.length > maxEntries) {
    nodes.push(LibNode.info(`Only first ${maxEntries} entries are shown. Increase rustExternalLibraries.maxDirectoryEntries if needed.`));
  }

  return nodes;
}

/** @param {string} name @param {boolean} includeHidden @param {boolean} includeTargetDir */
function shouldShowEntry(name, includeHidden, includeTargetDir) {
  if (!includeHidden && name.startsWith(".")) return false;
  if (!includeTargetDir && name === "target") return false;
  if (name === "node_modules") return false;
  return true;
}

/** @param {any} a @param {any} b */
function comparePackages(a, b) {
  const n = String(a.name).localeCompare(String(b.name));
  if (n !== 0) return n;
  return String(a.version).localeCompare(String(b.version));
}

/** @param {string} command @param {string[]} args @param {string} cwd @returns {Promise<any>} */
function execFileJson(command, args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr ? `${err.message}\n${stderr}` : err.message;
        reject(new Error(msg));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        reject(new Error(`Failed to parse ${command} output as JSON: ${parseErr.message}`));
      }
    });
  });
}

/** @param {string} cwd @returns {Promise<string | undefined>} */
function findRustStdPath(cwd) {
  return new Promise(resolve => {
    cp.execFile("rustc", ["--print", "sysroot"], { cwd }, (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }
      const sysroot = String(stdout).trim();
      const stdPath = path.join(sysroot, "lib", "rustlib", "src", "rust", "library");
      resolve(fs.existsSync(stdPath) ? stdPath : undefined);
    });
  });
}

/** @param {string} p */
function normalizeCargoPath(p) {
  if (!p) return p;
  // cargo metadata normally returns native absolute paths in WSL/Linux/macOS/Windows.
  return p;
}

class CargoTomlDependencyDefinitionProvider {
  /** @param {RustExternalLibrariesProvider} externalProvider */
  constructor(externalProvider) {
    this.externalProvider = externalProvider;
  }

  /**
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @returns {vscode.ProviderResult<vscode.Definition>}
   */
  provideDefinition(document, position) {
    if (path.basename(document.uri.fsPath) !== "Cargo.toml") {
      return undefined;
    }

    const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_\-\.]+/);
    if (!range) return undefined;

    const word = document.getText(range);
    if (!word || isTomlKeyword(word)) return undefined;

    const line = document.lineAt(position.line).text;
    const section = findTomlSection(document, position.line);

    if (!isDependencyContext(section, line)) {
      return undefined;
    }

    const cache = this.externalProvider.getCacheForUri(document.uri);
    if (!cache) return undefined;

    const candidates = resolveDependencyNameCandidates(word, line, section, cache);

    for (const name of candidates) {
      const pkgs = cache.packagesByName.get(name);
      if (!pkgs || pkgs.length === 0) continue;

      const external = pkgs.filter(p => p.source !== null);
      const pkg = chooseBestPackage(external.length ? external : pkgs);
      if (!pkg) continue;

      const manifestPath = normalizeCargoPath(pkg.manifest_path);
      const crateDir = path.dirname(manifestPath);
      const target = getPreferredDefinitionTarget(crateDir, manifestPath);
      return new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0));
    }

    return undefined;
  }
}

/** @param {vscode.TextDocument} document @param {number} lineNo */
function findTomlSection(document, lineNo) {
  for (let i = lineNo; i >= 0; i--) {
    const text = document.lineAt(i).text.trim();
    const m = text.match(/^\[\[?([^\]]+)\]\]?$/);
    if (m) return m[1].trim();
  }
  return "";
}

/** @param {string} section @param {string} line */
function isDependencyContext(section, line) {
  const s = section.trim();
  if (s === "dependencies" || s === "dev-dependencies" || s === "build-dependencies" || s === "workspace.dependencies") {
    return true;
  }

  if (/^target\..*\.dependencies$/.test(s) || /^target\..*\.dev-dependencies$/.test(s) || /^target\..*\.build-dependencies$/.test(s)) {
    return true;
  }

  if (/^(dependencies|dev-dependencies|build-dependencies|workspace\.dependencies)\.[A-Za-z0-9_\-\.]+$/.test(s)) {
    return true;
  }

  if (/^target\..*\.(dependencies|dev-dependencies|build-dependencies)\.[A-Za-z0-9_\-\.]+$/.test(s)) {
    return true;
  }

  return /(^|\s)(version|package|path|git|features|optional|default-features)\s*=/.test(line) || /^\s*[A-Za-z0-9_\-\.]+\s*=/.test(line);
}

/** @param {string} word @param {string} line @param {string} section @param {WorkspaceCache} cache */
function resolveDependencyNameCandidates(word, line, section, cache) {
  const set = new Set();

  const packageName = extractPackageNameFromLine(line);
  if (packageName) set.add(packageName);

  const sectionDep = extractDependencyNameFromSection(section);
  if (sectionDep) set.add(sectionDep);

  if (cache.aliasToPackageName.has(word)) {
    set.add(cache.aliasToPackageName.get(word));
  }

  set.add(word);

  if (cache.aliasToPackageName.has(sectionDep)) {
    set.add(cache.aliasToPackageName.get(sectionDep));
  }

  return Array.from(set).filter(Boolean);
}

/** @param {string} line */
function extractPackageNameFromLine(line) {
  const m = line.match(/\bpackage\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : undefined;
}

/** @param {string} section */
function extractDependencyNameFromSection(section) {
  const m = section.match(/(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)\.([A-Za-z0-9_\-\.]+)$/);
  return m ? m[1] : undefined;
}

/** @param {any[]} pkgs */
function chooseBestPackage(pkgs) {
  if (!pkgs || pkgs.length === 0) return undefined;
  const sorted = [...pkgs].sort((a, b) => String(b.version).localeCompare(String(a.version)));
  return sorted[0];
}

/** @param {string} crateDir @param {string} manifestPath */
function getPreferredDefinitionTarget(crateDir, manifestPath) {
  const config = vscode.workspace.getConfiguration("rustExternalLibraries");
  const preferLibRs = config.get("preferLibRsForCargoTomlDefinition", true);

  if (preferLibRs) {
    const libRs = path.join(crateDir, "src", "lib.rs");
    if (fs.existsSync(libRs)) return libRs;

    const mainRs = path.join(crateDir, "src", "main.rs");
    if (fs.existsSync(mainRs)) return mainRs;
  }

  return manifestPath;
}

/** @param {string} word */
function isTomlKeyword(word) {
  return new Set([
    "version", "features", "default", "default-features", "optional", "package", "path", "git", "branch", "tag", "rev",
    "registry", "workspace", "true", "false"
  ]).has(word);
}

/** @param {LibNode | undefined} node */
function openCargoToml(node) {
  const manifestPath = node?.extra?.manifestPath;
  if (manifestPath && fs.existsSync(manifestPath)) {
    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(manifestPath));
  }
}

/** @param {LibNode | undefined} node */
function openDirectory(node) {
  if (!node?.fullPath) return;
  const stat = safeStat(node.fullPath);
  const dir = stat?.isDirectory() ? node.fullPath : path.dirname(node.fullPath);
  vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir), { forceNewWindow: true });
}

/** @param {LibNode | undefined} node */
function revealInExplorer(node) {
  if (!node?.fullPath) return;
  vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(node.fullPath));
}

/** @param {string} p */
function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

/** @param {string} message @param {any} err */
function logError(message, err) {
  if (!output) return;
  output.appendLine(`[${new Date().toISOString()}] ${message}`);
  output.appendLine(formatError(err));
  output.appendLine("");
}

/** @param {any} err */
function formatError(err) {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  return String(err);
}

module.exports = { activate, deactivate };
