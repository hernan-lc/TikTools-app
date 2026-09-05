use std::{
    borrow::Cow,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use percent_encoding::percent_decode_str;
use url::Url;
use wry::http::{header::CONTENT_TYPE, Request, Response, StatusCode};

const PACKAGED_ASSET_SCHEME: &str = "tiktools";
const PACKAGED_ASSET_HOST: &str = "app";
const WINDOWS_PACKAGED_ASSET_HOST: &str = "tiktools.localhost";
/// Wry serves custom protocols on Windows through WebView2, which cannot
/// handle arbitrary schemes. It rewrites `{scheme}://{rest}` to
/// `http://{scheme}.{rest}` (see `custom_protocol_workaround` in wry), so
/// `tiktools://app/index.html` reaches the WebView as
/// `http://tiktools.app/index.html`.
const WINDOWS_WORKAROUND_HOST: &str = "tiktools.app";
const PACKAGED_CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "base-uri 'none'; ",
    "object-src 'none'; ",
    "frame-ancestors 'none'; ",
    "frame-src 'none'; ",
    "form-action 'none'; ",
    "script-src 'self'; ",
    "style-src 'self' 'unsafe-inline'; ",
    "img-src 'self' data: https:; ",
    "font-src 'self' data: https:; ",
    "media-src 'self' blob:; ",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* http://[::1]:* ",
    "ws://localhost:* ws://127.0.0.1:* ws://[::1]:* https: wss:"
);

#[derive(Clone)]
pub enum FrontendSource {
    DevelopmentServer(Url),
    EmbeddedAssets { root: Arc<PathBuf> },
}

impl FrontendSource {
    pub fn from_environment() -> Result<Self, String> {
        for variable in ["TIKTOOLS_DEV_URL", "TIKTOOLS_FRONTEND_URL"] {
            if let Some(value) = env::var_os(variable) {
                if !cfg!(debug_assertions) {
                    return Err(format!(
                        "{variable} is only supported in debug builds; release builds use packaged assets"
                    ));
                }
                let value = value.to_string_lossy();
                let url = Url::parse(&value)
                    .map_err(|error| format!("{variable} is not a URL: {error}"))?;
                if !matches!(url.scheme(), "http" | "https") {
                    return Err(format!("{variable} must use http or https"));
                }
                if !is_loopback_url(&url) {
                    return Err(format!(
                        "{variable} must point to localhost, 127.0.0.1, or ::1"
                    ));
                }
                if !url.username().is_empty() || url.password().is_some() {
                    return Err(format!("{variable} cannot contain embedded credentials"));
                }
                return Ok(Self::DevelopmentServer(url));
            }
        }

        let mut candidates = vec![
            env::var_os("TIKTOOLS_WEB_ROOT").map(PathBuf::from),
            env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|directory| directory.join("web"))),
            env::current_exe().ok().and_then(|path| {
                path.parent()
                    .map(|directory| directory.join("dist").join("web"))
            }),
        ];
        // The checkout-local output is useful while iterating with `cargo run`,
        // but production asset lookup must remain relative to the executable or
        // an explicit TIKTOOLS_WEB_ROOT setting.
        if cfg!(debug_assertions) {
            candidates.push(env::current_dir().ok().map(|path| path.join("dist/web")));
        }
        let root = candidates
            .into_iter()
            .flatten()
            .map(make_absolute)
            .find(|path| path.join("index.html").is_file())
            .ok_or_else(|| {
                "embedded frontend assets were not found; run `bun run build:web` or set TIKTOOLS_DEV_URL"
                    .to_owned()
            })?;
        Ok(Self::EmbeddedAssets {
            root: Arc::new(root),
        })
    }

    pub fn url(&self) -> Url {
        match self {
            Self::DevelopmentServer(url) => url.clone(),
            Self::EmbeddedAssets { .. } => Url::parse("tiktools://app/index.html")
                .expect("static TikTools asset URL should be valid"),
        }
    }

    pub fn asset_server(&self) -> Option<AssetServer> {
        match self {
            Self::DevelopmentServer(_) => None,
            Self::EmbeddedAssets { root } => Some(AssetServer { root: root.clone() }),
        }
    }

    /// Returns whether a navigation remains inside the frontend origin that
    /// was selected for this window. The IPC bridge is only safe while this
    /// policy holds, so every navigation and new-window request is checked by
    /// the desktop layer.
    pub fn allows_navigation(&self, raw_url: &str) -> bool {
        let Ok(url) = Url::parse(raw_url) else {
            return false;
        };
        match self {
            Self::DevelopmentServer(expected) => same_origin(expected, &url),
            Self::EmbeddedAssets { .. } => {
                (url.scheme() == PACKAGED_ASSET_SCHEME
                    && url.host_str() == Some(PACKAGED_ASSET_HOST))
                    || (url.scheme() == "http"
                        && (url.host_str() == Some(WINDOWS_PACKAGED_ASSET_HOST)
                            || url.host_str() == Some(WINDOWS_WORKAROUND_HOST)))
            }
        }
    }
}

#[derive(Clone)]
pub struct AssetServer {
    root: Arc<PathBuf>,
}

impl AssetServer {
    pub fn respond(&self, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
        let path = match requested_path(request.uri().path()) {
            Ok(path) => path,
            Err(error) => return error_response(StatusCode::BAD_REQUEST, error),
        };
        let root = match fs::canonicalize(self.root.as_path()) {
            Ok(root) => root,
            Err(error) => {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        };
        let candidate = root.join(&path);
        let canonical = match fs::canonicalize(&candidate) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return error_response(StatusCode::NOT_FOUND, "asset not found".to_owned());
            }
            Err(error) => {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        };
        if !canonical.starts_with(&root) || !canonical.is_file() {
            return error_response(
                StatusCode::FORBIDDEN,
                "asset path escapes frontend root".to_owned(),
            );
        }
        let bytes = match fs::read(&canonical) {
            Ok(bytes) => bytes,
            Err(error) => {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        };
        Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, content_type(&canonical))
            .header("content-security-policy", PACKAGED_CONTENT_SECURITY_POLICY)
            .body(Cow::Owned(bytes))
            .expect("asset response builder should accept static headers")
    }
}

fn same_origin(expected: &Url, actual: &Url) -> bool {
    expected.scheme() == actual.scheme()
        && expected.host() == actual.host()
        && expected.port_or_known_default() == actual.port_or_known_default()
        && actual.username().is_empty()
        && actual.password().is_none()
}

fn is_loopback_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

fn requested_path(raw: &str) -> Result<PathBuf, String> {
    let decoded = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "asset URL is not valid UTF-8".to_owned())?;
    let decoded = decoded.trim_start_matches('/');
    let decoded = if decoded.is_empty() {
        "index.html"
    } else {
        decoded
    };
    if decoded.contains('\\') || decoded.contains('\0') || decoded.starts_with('/') {
        return Err("invalid asset path".to_owned());
    }
    let path = Path::new(decoded);
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::RootDir
        )
    }) {
        return Err("asset path traversal is not allowed".to_owned());
    }
    Ok(path.to_owned())
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, message: String) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(message.into_bytes()))
        .expect("error response builder should accept static headers")
}

fn make_absolute(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    #[test]
    fn rejects_asset_traversal() {
        assert!(requested_path("/../secret").is_err());
        assert!(requested_path("/%2e%2e/secret").is_err());
        assert_eq!(requested_path("/").unwrap(), PathBuf::from("index.html"));
    }

    #[test]
    fn serves_files_from_the_runtime_asset_root() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("tiktools-assets-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("index.html"), "ok").unwrap();
        let server = AssetServer {
            root: Arc::new(root.clone()),
        };
        let response = server.respond(
            Request::builder()
                .uri("/index.html")
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), b"ok");
        assert_eq!(
            response
                .headers()
                .get("content-security-policy")
                .and_then(|value| value.to_str().ok()),
            Some(PACKAGED_CONTENT_SECURITY_POLICY)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn development_frontend_is_limited_to_loopback() {
        let localhost = FrontendSource::DevelopmentServer(
            Url::parse("http://127.0.0.1:3000").expect("valid URL"),
        );
        assert!(localhost.allows_navigation("http://127.0.0.1:3000/settings"));
        assert!(!localhost.allows_navigation("http://127.0.0.1:3001/settings"));
        assert!(!localhost.allows_navigation("https://example.com/"));

        let packaged = FrontendSource::EmbeddedAssets {
            root: Arc::new(PathBuf::from("/tmp/tiktools-web")),
        };
        assert!(packaged.allows_navigation("tiktools://app/index.html"));
        assert!(packaged.allows_navigation("tiktools://app/assets/app.js"));
        assert!(packaged.allows_navigation("http://tiktools.localhost/index.html"));
        assert!(packaged.allows_navigation("http://tiktools.app/index.html"));
        assert!(packaged.allows_navigation("http://tiktools.app/assets/app.js"));
        assert!(!packaged.allows_navigation("https://example.com/"));
    }
}
