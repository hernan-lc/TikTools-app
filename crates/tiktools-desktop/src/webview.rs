use std::{
    borrow::Cow,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use percent_encoding::percent_decode_str;
use url::Url;
use wry::http::{header::CONTENT_TYPE, Request, Response, StatusCode};

#[derive(Clone)]
pub enum FrontendSource {
    DevelopmentServer(Url),
    EmbeddedAssets { root: Arc<PathBuf> },
}

impl FrontendSource {
    pub fn from_environment() -> Result<Self, String> {
        for variable in ["TIKTOOLS_DEV_URL", "TIKTOOLS_FRONTEND_URL"] {
            if let Some(value) = env::var_os(variable) {
                let value = value.to_string_lossy();
                let url = Url::parse(&value)
                    .map_err(|error| format!("{variable} is not a URL: {error}"))?;
                if !matches!(url.scheme(), "http" | "https") {
                    return Err(format!("{variable} must use http or https"));
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
            .body(Cow::Owned(bytes))
            .expect("asset response builder should accept static headers")
    }
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
        let _ = fs::remove_dir_all(root);
    }
}
