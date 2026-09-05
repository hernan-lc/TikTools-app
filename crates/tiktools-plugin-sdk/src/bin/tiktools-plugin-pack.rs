//! Build a checksummed plugin archive without requiring a JavaScript toolchain.

use std::{
    collections::BTreeMap,
    env,
    error::Error,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tiktools_plugin_api::manifest::{is_safe_relative_path, PluginManifest};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const USAGE: &str =
    "Usage: tiktools-plugin-pack --manifest <plugin.json> --entry <built-entry> --output <plugin.plugin>";

struct Options {
    manifest: PathBuf,
    entry: PathBuf,
    output: PathBuf,
}

fn main() -> Result<(), Box<dyn Error>> {
    let options = match parse_args()? {
        Some(options) => options,
        None => {
            println!("{USAGE}");
            return Ok(());
        }
    };
    package(options)
}

fn parse_args() -> Result<Option<Options>, Box<dyn Error>> {
    let mut manifest = None;
    let mut entry = None;
    let mut output = None;
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        let target = match argument.as_str() {
            "--help" | "-h" => return Ok(None),
            "--manifest" => &mut manifest,
            "--entry" => &mut entry,
            "--output" => &mut output,
            value => return Err(invalid(format!("unknown argument {value}\n{USAGE}"))),
        };
        let value = args
            .next()
            .ok_or_else(|| invalid(format!("{argument} requires a value\n{USAGE}")))?;
        *target = Some(PathBuf::from(value));
    }
    Ok(Some(Options {
        manifest: manifest.ok_or_else(|| invalid(format!("--manifest is required\n{USAGE}")))?,
        entry: entry.ok_or_else(|| invalid(format!("--entry is required\n{USAGE}")))?,
        output: output.ok_or_else(|| invalid(format!("--output is required\n{USAGE}")))?,
    }))
}

fn package(options: Options) -> Result<(), Box<dyn Error>> {
    if options
        .output
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("plugin"))
    {
        return Err(invalid("output must use the .plugin extension"));
    }

    let manifest_path = fs::canonicalize(&options.manifest)?;
    let package_directory = manifest_path
        .parent()
        .ok_or_else(|| invalid("manifest has no parent directory"))?;
    let manifest_value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let manifest = PluginManifest::from_value(manifest_value.clone())?;
    manifest.validate_compatibility()?;

    let entry_metadata = fs::symlink_metadata(&options.entry)?;
    if !entry_metadata.is_file() || entry_metadata.file_type().is_symlink() {
        return Err(invalid("entry must be a regular, non-symlink file"));
    }
    let entry_bytes = fs::read(&options.entry)?;
    let staged_entry = staged_entry_name(&manifest.entry);

    let mut files = BTreeMap::new();
    let mut manifest_value = manifest_value;
    manifest_value
        .as_object_mut()
        .ok_or_else(|| invalid("manifest must be a JSON object"))?
        .insert(
            "entry".to_owned(),
            serde_json::Value::String(staged_entry.clone()),
        );
    let mut manifest_bytes = serde_json::to_vec_pretty(&manifest_value)?;
    manifest_bytes.push(b'\n');
    insert_file(&mut files, "plugin.json", manifest_bytes)?;
    insert_file(&mut files, &staged_entry, entry_bytes)?;

    for directory in ["assets", "dist", "locales"] {
        let source = package_directory.join(directory);
        if source.exists() {
            collect_directory(&source, directory, &mut files)?;
        }
    }

    let checksums = files
        .iter()
        .map(|(path, bytes)| (path.clone(), sha256(bytes)))
        .collect::<BTreeMap<_, _>>();
    let mut checksums_bytes = serde_json::to_vec_pretty(&checksums)?;
    checksums_bytes.push(b'\n');
    insert_file(&mut files, "checksums.json", checksums_bytes)?;

    let output = absolutize(&options.output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = output.with_extension("plugin.tmp");
    let _ = fs::remove_file(&temporary);
    write_archive(&temporary, &manifest.id, &files)?;
    if output.exists() {
        fs::remove_file(&output)?;
    }
    fs::rename(&temporary, &output)?;
    println!("Created {}", output.display());
    Ok(())
}

fn collect_directory(
    directory: &Path,
    archive_prefix: &str,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), Box<dyn Error>> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(invalid(format!(
                "asset tree contains a symlink: {}",
                path.display()
            )));
        }
        if metadata.is_dir() {
            let relative = path
                .strip_prefix(directory)
                .map_err(|error| invalid(error.to_string()))?;
            let prefix = format!(
                "{}/{}",
                archive_prefix,
                relative.to_string_lossy().replace('\\', "/")
            );
            collect_directory(&path, &prefix, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(directory)
                .map_err(|error| invalid(error.to_string()))?;
            let archive_path = format!(
                "{}/{}",
                archive_prefix,
                relative.to_string_lossy().replace('\\', "/")
            );
            insert_file(files, &archive_path, fs::read(path)?)?;
        } else {
            return Err(invalid(format!(
                "unsupported asset entry: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn insert_file(
    files: &mut BTreeMap<String, Vec<u8>>,
    path: &str,
    bytes: Vec<u8>,
) -> Result<(), Box<dyn Error>> {
    if !is_safe_relative_path(path) {
        return Err(invalid(format!("unsafe package path: {path}")));
    }
    if files.insert(path.to_owned(), bytes).is_some() {
        return Err(invalid(format!("duplicate package path: {path}")));
    }
    Ok(())
}

fn write_archive(
    path: &Path,
    plugin_id: &str,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), Box<dyn Error>> {
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (relative, bytes) in files {
        writer.start_file(format!("{plugin_id}/{relative}"), options)?;
        writer.write_all(bytes)?;
    }
    writer.finish()?;
    Ok(())
}

fn staged_entry_name(entry: &str) -> String {
    if cfg!(target_os = "windows") && !entry.to_ascii_lowercase().ends_with(".exe") {
        format!("{entry}.exe")
    } else {
        entry.to_owned()
    }
}

fn absolutize(path: &Path) -> Result<PathBuf, Box<dyn Error>> {
    if path.is_absolute() {
        Ok(path.to_owned())
    } else {
        Ok(env::current_dir()?.join(path))
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(io::Error::new(io::ErrorKind::InvalidInput, message.into()))
}
