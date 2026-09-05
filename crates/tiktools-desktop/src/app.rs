use std::{env, sync::Arc};

use tiktools_core::{ipc::IpcRouter, AppCore};
use tokio::runtime::Builder;
use winit::event_loop::EventLoop;

use crate::window::DesktopApp;
use crate::{event::DesktopEvent, platform, single_instance, webview::FrontendSource};

pub fn run(log_path: std::path::PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(archive) = install_plugin_argument()? {
        return install_plugin(archive, replace_plugin_argument());
    }
    let mut instance = match single_instance::acquire()? {
        Ok(instance) => instance,
        Err(single_instance::InstanceRole::Secondary) => return Ok(()),
    };
    // Validate the executable-relative packaged frontend before opening the
    // database, scanning plugins, or constructing the live client.
    let source = FrontendSource::from_environment().map_err(std::io::Error::other)?;
    platform::initialize()?;
    let runtime = Builder::new_multi_thread().enable_all().build()?;
    let mut event_loop_builder = EventLoop::<DesktopEvent>::with_user_event();
    platform::configure_event_loop(&mut event_loop_builder);
    let event_loop = event_loop_builder.build()?;
    let proxy = event_loop.create_proxy();
    let emitter = crate::event::shared_emitter(proxy.clone());
    let media = Arc::new(crate::media::DesktopMediaHost::default());
    let core = Arc::new(AppCore::with_media_host(emitter, media));
    let router = Arc::new(IpcRouter::new(core.clone()));
    instance.start_listener(proxy.clone());
    let mut app = DesktopApp::new(
        core,
        router,
        source,
        runtime.handle().clone(),
        proxy,
        log_path,
    );
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn install_plugin_argument() -> Result<Option<std::path::PathBuf>, Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--install-plugin" {
            let archive = args.next().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "--install-plugin requires a .plugin path",
                )
            })?;
            return Ok(Some(archive.into()));
        }
    }
    Ok(None)
}

fn replace_plugin_argument() -> bool {
    env::args().any(|argument| argument == "--replace")
}

#[cfg(feature = "plugin-install")]
fn install_plugin(
    archive: std::path::PathBuf,
    replace_existing: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    struct NullEmitter;
    impl tiktools_core::HostEmitter for NullEmitter {
        fn emit(&self, _message: tiktools_core::ipc::messages::HostMessage) {}
    }

    let core = AppCore::new(Arc::new(NullEmitter));
    let installed = core.install_plugin(archive, replace_existing)?;
    println!(
        "Installed {}@{} in {}",
        installed.manifest.id,
        installed.manifest.version,
        installed.directory.display()
    );
    Ok(())
}

#[cfg(not(feature = "plugin-install"))]
fn install_plugin(
    _archive: std::path::PathBuf,
    _replace_existing: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "plugin installation was disabled in this build",
    )
    .into())
}
