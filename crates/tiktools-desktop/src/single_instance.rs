//! Per-user single-instance coordination.
//!
//! The primary process owns an OS-backed object for its lifetime. A secondary
//! launch sends the one supported activation command and exits before any
//! desktop services are assembled.

use std::{io, sync::Arc, thread};

use winit::event_loop::EventLoopProxy;

use crate::event::{DesktopCommand, DesktopEvent};

#[cfg(unix)]
const ACTIVATION_MESSAGE: &[u8] = b"SHOW\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceRole {
    Secondary,
}

pub struct InstanceGuard {
    platform: platform::PlatformGuard,
}

impl InstanceGuard {
    pub fn start_listener(&mut self, proxy: EventLoopProxy<DesktopEvent>) {
        self.platform.start_listener(proxy);
    }
}

pub fn acquire() -> io::Result<Result<InstanceGuard, InstanceRole>> {
    platform::acquire()
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        os::unix::net::UnixListener,
        path::PathBuf,
        time::Duration,
    };

    pub struct PlatformGuard {
        socket_path: PathBuf,
        listener: Option<UnixListener>,
        stop: Arc<std::sync::atomic::AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }

    pub fn acquire() -> io::Result<Result<InstanceGuard, InstanceRole>> {
        let socket_path = socket_path();
        if let Some(parent) = socket_path.parent() {
            fs::create_dir_all(parent)?;
        }
        match UnixListener::bind(&socket_path) {
            Ok(listener) => Ok(Ok(InstanceGuard {
                platform: PlatformGuard {
                    socket_path,
                    listener: Some(listener),
                    stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    thread: None,
                },
            })),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
                if notify_existing(&socket_path) {
                    Ok(Err(InstanceRole::Secondary))
                } else {
                    // A Unix-domain socket is an OS-owned endpoint rather than
                    // a lockfile. Removing it after a failed activation
                    // connects only handles a crashed primary's stale name.
                    let _ = fs::remove_file(&socket_path);
                    let listener = UnixListener::bind(&socket_path)?;
                    Ok(Ok(InstanceGuard {
                        platform: PlatformGuard {
                            socket_path,
                            listener: Some(listener),
                            stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                            thread: None,
                        },
                    }))
                }
            }
            Err(error) => Err(error),
        }
    }

    fn socket_path() -> PathBuf {
        let root = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("TMPDIR")
                    .map(PathBuf::from)
                    .or_else(|| Some(std::env::temp_dir()))
            })
            .unwrap_or_else(std::env::temp_dir);
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_else(|_| "default".to_owned());
        let user = user
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect::<String>();
        root.join(format!("tiktools-desktop-{user}.sock"))
    }

    fn notify_existing(path: &PathBuf) -> bool {
        for _ in 0..20 {
            match std::os::unix::net::UnixStream::connect(path) {
                Ok(mut stream) => return stream.write_all(ACTIVATION_MESSAGE).is_ok(),
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
                    ) =>
                {
                    thread::sleep(Duration::from_millis(25))
                }
                Err(_) => return false,
            }
        }
        false
    }

    impl PlatformGuard {
        pub(super) fn start_listener(&mut self, proxy: EventLoopProxy<DesktopEvent>) {
            let Some(listener) = self.listener.take() else {
                return;
            };
            let stop = Arc::clone(&self.stop);
            self.thread = thread::Builder::new()
                .name("tiktools-single-instance".to_owned())
                .spawn(move || {
                    while !stop.load(std::sync::atomic::Ordering::Acquire) {
                        match listener.accept() {
                            Ok((mut stream, _)) => {
                                let mut message = [0_u8; ACTIVATION_MESSAGE.len()];
                                if stream.read_exact(&mut message).is_ok()
                                    && is_activation_message(&message)
                                    && !stop.load(std::sync::atomic::Ordering::Acquire)
                                {
                                    let _ = proxy.send_event(DesktopEvent::Command(
                                        DesktopCommand::ShowWindow,
                                    ));
                                }
                            }
                            Err(error) => {
                                tracing::debug!(%error, "single-instance listener stopped");
                                break;
                            }
                        }
                    }
                })
                .ok();
        }

        fn wake(&self) {
            let _ = std::os::unix::net::UnixStream::connect(&self.socket_path);
        }
    }

    pub(super) fn is_activation_message(message: &[u8]) -> bool {
        message == ACTIVATION_MESSAGE
    }

    impl Drop for PlatformGuard {
        fn drop(&mut self) {
            self.stop.store(true, std::sync::atomic::Ordering::Release);
            self.wake();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            let _ = fs::remove_file(&self.socket_path);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::platform::is_activation_message;

    #[test]
    fn activation_protocol_accepts_only_show() {
        assert!(is_activation_message(b"SHOW\n"));
        assert!(!is_activation_message(b"QUIT\n"));
        assert!(!is_activation_message(b"SHOW"));
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ptr, time::Duration};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, WAIT_OBJECT_0},
        System::Threading::{
            CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject,
            EVENT_MODIFY_STATE,
        },
    };

    const WAIT_TIMEOUT_MS: u32 = 100;
    const MUTEX_NAME: &str = "Local\\TikToolsDesktop.SingleInstance";
    const EVENT_NAME: &str = "Local\\TikToolsDesktop.Activate";

    pub struct PlatformGuard {
        mutex: usize,
        event: usize,
        stop: Arc<std::sync::atomic::AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }

    pub fn acquire() -> io::Result<Result<InstanceGuard, InstanceRole>> {
        let mutex_name = wide(MUTEX_NAME);
        let mutex = unsafe { CreateMutexW(ptr::null(), 1, mutex_name.as_ptr()) };
        if mutex.is_null() {
            return Err(io::Error::last_os_error());
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { CloseHandle(mutex) };
            notify_existing();
            return Ok(Err(InstanceRole::Secondary));
        }

        let event_name = wide(EVENT_NAME);
        let event = unsafe { CreateEventW(ptr::null(), 0, 0, event_name.as_ptr()) };
        if event.is_null() {
            unsafe { CloseHandle(mutex) };
            return Err(io::Error::last_os_error());
        }
        Ok(Ok(InstanceGuard {
            platform: PlatformGuard {
                mutex: mutex as usize,
                event: event as usize,
                stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                thread: None,
            },
        }))
    }

    fn notify_existing() {
        let name = wide(EVENT_NAME);
        for _ in 0..20 {
            let event = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
            if !event.is_null() {
                unsafe {
                    let _ = SetEvent(event);
                    CloseHandle(event);
                }
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    impl PlatformGuard {
        pub(super) fn start_listener(&mut self, proxy: EventLoopProxy<DesktopEvent>) {
            let event = self.event;
            let stop = Arc::clone(&self.stop);
            self.thread = thread::Builder::new()
                .name("tiktools-single-instance".to_owned())
                .spawn(move || {
                    while !stop.load(std::sync::atomic::Ordering::Acquire) {
                        let signaled = unsafe {
                            WaitForSingleObject(
                                event as windows_sys::Win32::Foundation::HANDLE,
                                WAIT_TIMEOUT_MS,
                            )
                        };
                        if signaled == WAIT_OBJECT_0
                            && !stop.load(std::sync::atomic::Ordering::Acquire)
                        {
                            let _ =
                                proxy.send_event(DesktopEvent::Command(DesktopCommand::ShowWindow));
                        }
                    }
                })
                .ok();
        }
    }

    impl Drop for PlatformGuard {
        fn drop(&mut self) {
            self.stop.store(true, std::sync::atomic::Ordering::Release);
            unsafe {
                let _ = SetEvent(self.event as windows_sys::Win32::Foundation::HANDLE);
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            unsafe {
                CloseHandle(self.event as windows_sys::Win32::Foundation::HANDLE);
                CloseHandle(self.mutex as windows_sys::Win32::Foundation::HANDLE);
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;

    pub struct PlatformGuard;

    pub fn acquire() -> io::Result<Result<InstanceGuard, InstanceRole>> {
        Ok(Ok(InstanceGuard {
            platform: PlatformGuard,
        }))
    }

    impl PlatformGuard {
        pub(super) fn start_listener(&mut self, _proxy: EventLoopProxy<DesktopEvent>) {}
    }
}
