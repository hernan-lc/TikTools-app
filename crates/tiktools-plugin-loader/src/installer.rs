//! Safe `.plugin` package installation.
//!
//! Installation is deliberately a data operation: no package manager is
//! invoked and no native code is compiled. The archive is extracted to a
//! private staging directory, validated, checksum-checked, and then renamed
//! into the runtime plugin directory.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};
use tiktools_plugin_api::{
    manifest::{is_safe_relative_path, ManifestError},
    PluginManifest,
};
use zip::ZipArchive;

use crate::PluginLoaderError;

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 50_000;

pub struct PluginInstaller {
    pub plugin_directory: PathBuf,
    pub staging_directory: PathBuf,
    pub replace_existing: bool,
}

#[derive(Debug, Clone)]
pub struct InstalledPluginPackage {
    pub directory: PathBuf,
    pub manifest: PluginManifest,
}

impl PluginInstaller {
    /// Reads and validates the package identity before filesystem mutation.
    /// Full extraction, checksum validation, and atomic replacement still
    /// happen in [`Self::install`]; this lightweight pass only lets the host
    /// stop a running instance belonging to the package being replaced.
    pub fn inspect_manifest(
        &self,
        archive_path: impl AsRef<Path>,
    ) -> Result<PluginManifest, PluginLoaderError> {
        let archive = canonical_archive_path(archive_path.as_ref())?;
        let file = File::open(&archive).map_err(io_error)?;
        let mut archive = ZipArchive::new(file).map_err(|error| {
            PluginLoaderError::Runtime(format!("could not inspect plugin archive: {error}"))
        })?;
        let mut manifest_bytes = None;
        for index in 0..archive.len().min(MAX_FILES) {
            let entry = archive.by_index(index).map_err(zip_error)?;
            let Some(relative) = normalized_archive_path(entry.name())? else {
                continue;
            };
            let is_manifest = relative.file_name().and_then(|name| name.to_str())
                == Some("plugin.json")
                && relative.components().count() <= 2;
            if !is_manifest {
                continue;
            }
            if manifest_bytes.is_some() {
                return Err(PluginLoaderError::Runtime(
                    "plugin archive contains multiple plugin.json manifests".to_owned(),
                ));
            }
            let mut bytes = Vec::new();
            entry
                .take(256 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            if bytes.len() > 256 * 1024 {
                return Err(PluginLoaderError::Manifest(ManifestError::TooLarge));
            }
            manifest_bytes = Some(bytes);
        }
        let bytes = manifest_bytes.ok_or_else(|| {
            PluginLoaderError::Runtime(
                "plugin archive must contain plugin.json at its root".to_owned(),
            )
        })?;
        let manifest =
            PluginManifest::from_json_str(std::str::from_utf8(&bytes).map_err(|_| {
                PluginLoaderError::Runtime("plugin manifest is not UTF-8".to_owned())
            })?)
            .map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
        manifest
            .validate_compatibility()
            .map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
        Ok(manifest)
    }

    pub fn install(
        &self,
        archive_path: impl AsRef<Path>,
    ) -> Result<InstalledPluginPackage, PluginLoaderError> {
        let archive = canonical_archive_path(archive_path.as_ref())?;
        let archive_size = fs::metadata(&archive).map_err(io_error)?.len();
        if archive_size > MAX_ARCHIVE_BYTES {
            return Err(PluginLoaderError::Runtime(
                "plugin package exceeds the 512 MB limit".to_owned(),
            ));
        }

        fs::create_dir_all(&self.plugin_directory).map_err(io_error)?;
        fs::create_dir_all(&self.staging_directory).map_err(io_error)?;
        let staging = self.staging_path();
        fs::create_dir_all(&staging).map_err(io_error)?;
        let result = self.install_into_staging(&archive, &staging);
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    fn install_into_staging(
        &self,
        archive_path: &Path,
        staging: &Path,
    ) -> Result<InstalledPluginPackage, PluginLoaderError> {
        let file = File::open(archive_path).map_err(io_error)?;
        let mut archive = ZipArchive::new(file).map_err(|error| {
            PluginLoaderError::Runtime(format!("could not inspect plugin archive: {error}"))
        })?;
        if archive.is_empty() || archive.len() > MAX_FILES {
            return Err(PluginLoaderError::Runtime(
                "plugin archive contains an invalid number of entries".to_owned(),
            ));
        }
        let mut extracted_bytes = 0_u64;
        let mut extracted_paths = BTreeSet::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(zip_error)?;
            let Some(relative) = normalized_archive_path(entry.name())? else {
                // Some ZIP writers (including bsdtar) include the archive's
                // current-directory marker as `./`. It is not package data.
                continue;
            };
            if !extracted_paths.insert(relative.clone()) {
                return Err(PluginLoaderError::Runtime(format!(
                    "plugin archive contains a duplicate path: {}",
                    entry.name()
                )));
            }
            let destination = staging.join(&relative);
            if entry.is_dir() {
                fs::create_dir_all(&destination).map_err(io_error)?;
                continue;
            }
            extracted_bytes = extracted_bytes.saturating_add(entry.size());
            if extracted_bytes > MAX_EXTRACTED_BYTES {
                return Err(PluginLoaderError::Runtime(
                    "plugin archive expands beyond the 2 GB limit".to_owned(),
                ));
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(io_error)?;
            }
            let mut output = File::create(&destination).map_err(io_error)?;
            io::copy(&mut entry, &mut output).map_err(io_error)?;
        }

        let root = find_package_root(staging)?;
        validate_extracted_tree(&root)?;
        let manifest_path = root.join("plugin.json");
        let manifest_text = fs::read_to_string(&manifest_path).map_err(io_error)?;
        let manifest = PluginManifest::from_json_str(&manifest_text)
            .map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
        manifest
            .validate_compatibility()
            .map_err(|error| PluginLoaderError::Runtime(error.to_string()))?;
        verify_checksums(&root, &manifest)?;
        if root.join("signature.json").is_file() {
            return Err(PluginLoaderError::Runtime(
                "signed plugin packages require a configured signature verifier".to_owned(),
            ));
        }

        let target = self.plugin_directory.join(&manifest.id);
        if target.parent() != Some(self.plugin_directory.as_path()) {
            return Err(PluginLoaderError::Runtime(
                "plugin installation target escaped the plugin directory".to_owned(),
            ));
        }
        if target.exists() && !self.replace_existing {
            return Err(PluginLoaderError::Runtime(format!(
                "plugin is already installed: {}",
                manifest.id
            )));
        }

        let backup =
            self.plugin_directory
                .join(format!(".{}.previous-{}", manifest.id, unique_suffix()));
        let mut moved_existing = false;
        if target.exists() {
            fs::rename(&target, &backup).map_err(io_error)?;
            moved_existing = true;
        }
        if let Err(error) = fs::rename(&root, &target) {
            if moved_existing && !target.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(io_error(error));
        }
        if moved_existing {
            fs::remove_dir_all(&backup).map_err(io_error)?;
        }
        let result = InstalledPluginPackage {
            directory: target,
            manifest,
        };
        let _ = fs::remove_dir_all(staging);
        Ok(result)
    }

    fn staging_path(&self) -> PathBuf {
        self.staging_directory
            .join(format!("plugin-{}-{}", std::process::id(), unique_suffix()))
    }
}

fn canonical_archive_path(path: &Path) -> Result<PathBuf, PluginLoaderError> {
    let archive = fs::canonicalize(path).map_err(io_error)?;
    if archive
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("plugin"))
        != Some(true)
    {
        return Err(PluginLoaderError::Runtime(
            "plugin packages must use the .plugin extension".to_owned(),
        ));
    }
    if !archive.is_file() {
        return Err(PluginLoaderError::Runtime(
            "plugin package is not a regular file".to_owned(),
        ));
    }
    let archive_size = fs::metadata(&archive).map_err(io_error)?.len();
    if archive_size > MAX_ARCHIVE_BYTES {
        return Err(PluginLoaderError::Runtime(
            "plugin package exceeds the 512 MB limit".to_owned(),
        ));
    }
    Ok(archive)
}

fn normalized_archive_path(name: &str) -> Result<Option<PathBuf>, PluginLoaderError> {
    let normalized = name.replace('\\', "/");
    let normalized = normalized.strip_prefix("./").unwrap_or(&normalized);
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return Ok(None);
    }
    if !is_safe_relative_path(normalized) {
        return Err(PluginLoaderError::Runtime(format!(
            "plugin archive contains unsafe path: {name}"
        )));
    }
    Ok(Some(PathBuf::from(normalized)))
}

fn find_package_root(staging: &Path) -> Result<PathBuf, PluginLoaderError> {
    if staging.join("plugin.json").is_file() {
        return Ok(staging.to_owned());
    }
    let directories: Vec<_> = fs::read_dir(staging)
        .map_err(io_error)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .collect();
    if directories.len() == 1 && directories[0].path().join("plugin.json").is_file() {
        return Ok(directories[0].path());
    }
    Err(PluginLoaderError::Runtime(
        "plugin archive must contain plugin.json at its root".to_owned(),
    ))
}

fn validate_extracted_tree(root: &Path) -> Result<(), PluginLoaderError> {
    let root = fs::canonicalize(root).map_err(io_error)?;
    let mut files = 0_usize;
    let mut bytes = 0_u64;
    visit_tree(&root, &root, &mut files, &mut bytes)
}

fn visit_tree(
    root: &Path,
    directory: &Path,
    files: &mut usize,
    bytes: &mut u64,
) -> Result<(), PluginLoaderError> {
    for entry in fs::read_dir(directory).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(PluginLoaderError::Runtime(
                "plugin archive contains a symbolic link".to_owned(),
            ));
        }
        if metadata.is_dir() {
            visit_tree(root, &path, files, bytes)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(PluginLoaderError::Runtime(
                "plugin archive contains an unsupported entry".to_owned(),
            ));
        }
        if !path.starts_with(root) {
            return Err(PluginLoaderError::Runtime(
                "plugin archive contains a path traversal entry".to_owned(),
            ));
        }
        *files = files.saturating_add(1);
        *bytes = bytes.saturating_add(metadata.len());
        if *files > MAX_FILES {
            return Err(PluginLoaderError::Runtime(
                "plugin archive contains too many files".to_owned(),
            ));
        }
        if *bytes > MAX_EXTRACTED_BYTES {
            return Err(PluginLoaderError::Runtime(
                "plugin archive expands beyond the 2 GB limit".to_owned(),
            ));
        }
    }
    Ok(())
}

fn verify_checksums(root: &Path, manifest: &PluginManifest) -> Result<(), PluginLoaderError> {
    let checksum_path = root.join("checksums.json");
    let checksums_text = fs::read_to_string(&checksum_path).map_err(|_| {
        PluginLoaderError::Runtime(format!("plugin {} is missing checksums.json", manifest.id))
    })?;
    let checksums: BTreeMap<String, String> =
        serde_json::from_str(&checksums_text).map_err(|error| {
            PluginLoaderError::Runtime(format!("checksums.json is invalid: {error}"))
        })?;
    if checksums.is_empty() {
        return Err(PluginLoaderError::Runtime(format!(
            "plugin {} has no checksums",
            manifest.id
        )));
    }
    for (relative, expected) in &checksums {
        if !is_safe_relative_path(relative)
            || expected.len() != 64
            || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(PluginLoaderError::Runtime(format!(
                "invalid checksum entry: {relative}"
            )));
        }
        let path = root.join(relative);
        if !path.is_file() {
            return Err(PluginLoaderError::Runtime(format!(
                "checksum target is not a file: {relative}"
            )));
        }
        let digest = digest_file(&path)?;
        if !digest.eq_ignore_ascii_case(expected) {
            return Err(PluginLoaderError::Runtime(format!(
                "checksum mismatch in {}: {relative}",
                manifest.id
            )));
        }
    }
    for relative in all_files(root)? {
        if matches!(relative.as_str(), "checksums.json" | "signature.json") {
            continue;
        }
        if !checksums.contains_key(&relative) {
            return Err(PluginLoaderError::Runtime(format!(
                "plugin checksum is missing for {relative}"
            )));
        }
    }
    Ok(())
}

fn all_files(root: &Path) -> Result<Vec<String>, PluginLoaderError> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    Ok(files)
}

fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), PluginLoaderError> {
    for entry in fs::read_dir(directory).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| PluginLoaderError::Runtime(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            files.push(relative);
        }
    }
    Ok(())
}

fn digest_file(path: &Path) -> Result<String, PluginLoaderError> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn io_error(error: io::Error) -> PluginLoaderError {
    PluginLoaderError::Runtime(error.to_string())
}

fn zip_error(error: zip::result::ZipError) -> PluginLoaderError {
    PluginLoaderError::Runtime(format!("could not read plugin archive: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::*;

    fn temp_root() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let count = COUNTER.fetch_add(1, Ordering::AcqRel);
        std::env::temp_dir().join(format!(
            "tiktools-plugin-installer-{}-{}-{count}",
            std::process::id(),
            suffix
        ))
    }

    fn digest_bytes(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn write_archive(path: &Path, files: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, bytes) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    fn demo_package(manifest: &[u8], entry: &[u8]) -> (Vec<u8>, Vec<u8>, String) {
        let checksums = format!(
            r#"{{"plugin.json":"{}","index.js":"{}"}}"#,
            digest_bytes(manifest),
            digest_bytes(entry)
        );
        (manifest.to_vec(), entry.to_vec(), checksums)
    }

    #[test]
    fn rejects_archive_path_traversal() {
        assert!(normalized_archive_path("../../outside").is_err());
        assert!(normalized_archive_path("plugin\\..\\outside").is_err());
        assert!(normalized_archive_path("./plugin.json").unwrap().is_some());
        assert!(normalized_archive_path("./").unwrap().is_none());
    }

    #[test]
    fn installs_checksum_checked_package_atomically() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("demo.plugin");
        let manifest = br#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"1.0.0","runtime":"process","entry":"index.js"}"#;
        let entry = br#"{"ready":true}"#;
        let checksums = format!(
            r#"{{"plugin.json":"{}","index.js":"{}"}}"#,
            digest_bytes(manifest),
            digest_bytes(entry)
        );

        let file = File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("plugin.json", options).unwrap();
        writer.write_all(manifest).unwrap();
        writer.start_file("index.js", options).unwrap();
        writer.write_all(entry).unwrap();
        writer.start_file("checksums.json", options).unwrap();
        writer.write_all(checksums.as_bytes()).unwrap();
        writer.finish().unwrap();

        let installed = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: false,
        }
        .install(&archive_path)
        .unwrap();

        assert_eq!(installed.manifest.id, "demo");
        assert_eq!(installed.directory, root.join("plugins/demo"));
        assert!(installed.directory.join("plugin.json").is_file());
        assert!(installed.directory.join("index.js").is_file());
        assert!(!root.join("staging").join("plugin.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_wrong_extension() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("demo.zip");
        let manifest = br#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"1.0.0","runtime":"process","entry":"index.js"}"#;
        let entry = br#"{"ready":true}"#;
        let (_, _, checksums) = demo_package(manifest, entry);
        write_archive(
            &archive_path,
            &[
                ("plugin.json", manifest),
                ("index.js", entry),
                ("checksums.json", checksums.as_bytes()),
            ],
        );

        let result = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: false,
        }
        .install(&archive_path);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains(".plugin extension"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_manifest_and_cleans_staging() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("demo.plugin");
        write_archive(&archive_path, &[("index.js", b"{}")]);

        let staging = root.join("staging");
        let result = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: staging.clone(),
            replace_existing: false,
        }
        .install(&archive_path);
        assert!(result.is_err());
        assert!(!root.join("plugins/demo").exists());
        // Staging extracts are removed on failure; only the staging root may remain.
        let leftover: Vec<_> = fs::read_dir(&staging)
            .map(|entries| entries.filter_map(Result::ok).collect())
            .unwrap_or_default();
        assert!(leftover.is_empty(), "staging was not cleaned: {leftover:?}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_traversal_entries() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("evil.plugin");
        let manifest = br#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"1.0.0","runtime":"process","entry":"index.js"}"#;
        let entry = br#"{}"#;
        let (_, _, checksums) = demo_package(manifest, entry);
        write_archive(
            &archive_path,
            &[
                ("plugin.json", manifest),
                ("../evil.txt", b"evil"),
                ("index.js", entry),
                ("checksums.json", checksums.as_bytes()),
            ],
        );

        let result = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: false,
        }
        .install(&archive_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("unsafe path"));
        assert!(!root.join("plugins/demo").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_plugin_requires_replace_flag() {
        let root = temp_root();
        fs::create_dir_all(&root).unwrap();
        let manifest_v1 = br#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"1.0.0","runtime":"process","entry":"index.js"}"#.as_slice();
        let manifest_v2 = br#"{"schemaVersion":2,"id":"demo","name":"Demo","version":"2.0.0","runtime":"process","entry":"index.js"}"#.as_slice();
        let entry = br#"{"ready":true}"#.as_slice();
        let (_, _, checksums_v1) = demo_package(manifest_v1, entry);
        let (_, _, checksums_v2) = demo_package(manifest_v2, entry);

        let first = root.join("demo-v1.plugin");
        write_archive(
            &first,
            &[
                ("plugin.json", manifest_v1),
                ("index.js", entry),
                ("checksums.json", checksums_v1.as_bytes()),
            ],
        );
        PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: false,
        }
        .install(&first)
        .unwrap();

        let second = root.join("demo-v2.plugin");
        write_archive(
            &second,
            &[
                ("plugin.json", manifest_v2),
                ("index.js", entry),
                ("checksums.json", checksums_v2.as_bytes()),
            ],
        );
        let without_replace = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: false,
        }
        .install(&second);
        let message = without_replace.unwrap_err().to_string();
        assert!(message.contains("already installed"), "{message}");
        // The original install is untouched until replacement is confirmed.
        let installed_manifest = fs::read_to_string(root.join("plugins/demo/plugin.json")).unwrap();
        assert!(installed_manifest.contains("1.0.0"));

        let replaced = PluginInstaller {
            plugin_directory: root.join("plugins"),
            staging_directory: root.join("staging"),
            replace_existing: true,
        }
        .install(&second)
        .unwrap();
        assert_eq!(replaced.manifest.version, "2.0.0");
        let installed_manifest = fs::read_to_string(root.join("plugins/demo/plugin.json")).unwrap();
        assert!(installed_manifest.contains("2.0.0"));

        fs::remove_dir_all(root).unwrap();
    }
}
