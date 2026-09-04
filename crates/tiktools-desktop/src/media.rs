//! Desktop implementations of the framework-independent media capability.
//!
//! The picker returns a path only. Audio playback streams the selected file
//! directly; no file is copied into the application or plugin directories.

use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink};
use tiktools_core::{MediaHost, MediaHostError, MediaHostFuture};
use tiktools_plugin_api::{
    AudioOverlap, AudioPlayOptions, AudioPlaybackResult, MediaKind, MediaPickerMode,
    MediaPickerOptions,
};

#[derive(Default)]
pub struct DesktopMediaHost {
    audio: Arc<Mutex<AudioState>>,
}

#[derive(Default)]
struct AudioState {
    stream: Option<OutputStream>,
    sinks: Vec<Sink>,
}

impl MediaHost for DesktopMediaHost {
    fn open_picker(&self, options: MediaPickerOptions) -> MediaHostFuture<Option<PathBuf>> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || pick_media(options))
                .await
                .map_err(|error| {
                    MediaHostError::Failed(format!("media picker task failed: {error}"))
                })?
        })
    }

    fn play_audio(
        &self,
        file: tiktools_plugin_api::MediaFileRef,
        options: AudioPlayOptions,
    ) -> MediaHostFuture<AudioPlaybackResult> {
        let audio = Arc::clone(&self.audio);
        Box::pin(async move {
            tokio::task::spawn_blocking(move || play_audio(&audio, &file, options))
                .await
                .map_err(|error| MediaHostError::Failed(format!("audio task failed: {error}")))?
        })
    }
}

fn pick_media(options: MediaPickerOptions) -> Result<Option<PathBuf>, MediaHostError> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(title) = options.title.filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }
    if let Some(directory) = options
        .initial_directory
        .as_deref()
        .map(Path::new)
        .filter(|path| path.is_dir())
    {
        dialog = dialog.set_directory(directory);
    }
    if !options.extensions.is_empty() {
        let filter_name = match options.kind {
            MediaKind::Audio => "Audio files",
            MediaKind::Video => "Video files",
            MediaKind::Image => "Image files",
            MediaKind::Other => "Supported files",
        };
        dialog = dialog.add_filter(filter_name, &options.extensions);
    }
    let selected = match options.mode {
        MediaPickerMode::File => dialog.pick_file(),
        MediaPickerMode::Directory => dialog.pick_folder(),
    };
    Ok(selected)
}

fn play_audio(
    audio: &Arc<Mutex<AudioState>>,
    file: &tiktools_plugin_api::MediaFileRef,
    options: AudioPlayOptions,
) -> Result<AudioPlaybackResult, MediaHostError> {
    let mut state = audio
        .lock()
        .map_err(|_| MediaHostError::Failed("audio state lock is poisoned".to_owned()))?;
    state.sinks.retain(|sink| !sink.empty());
    if matches!(options.overlap, AudioOverlap::Drop) && !state.sinks.is_empty() {
        return Ok(AudioPlaybackResult {
            played: false,
            reason: Some("already-playing".to_owned()),
            active_players: state.sinks.len(),
        });
    }
    if matches!(options.overlap, AudioOverlap::Restart) {
        for sink in &state.sinks {
            sink.stop();
        }
        state.sinks.clear();
    }
    if state.stream.is_none() {
        state.stream = Some(OutputStreamBuilder::open_default_stream().map_err(|error| {
            MediaHostError::Failed(format!("could not open audio output: {error}"))
        })?);
    }
    let input = File::open(&file.path).map_err(|error| {
        MediaHostError::Failed(format!("could not open {}: {error}", file.path))
    })?;
    let source = Decoder::try_from(input).map_err(|error| {
        MediaHostError::Failed(format!("could not decode {}: {error}", file.name))
    })?;
    let stream = state
        .stream
        .as_ref()
        .ok_or_else(|| MediaHostError::Failed("audio output was not initialized".to_owned()))?;
    let sink = Sink::connect_new(stream.mixer());
    sink.set_volume(options.volume.clamp(0.0, 1.0));
    sink.append(source);
    state.sinks.push(sink);
    Ok(AudioPlaybackResult {
        played: true,
        reason: None,
        active_players: state.sinks.len(),
    })
}
