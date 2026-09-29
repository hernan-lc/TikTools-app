//! Minimal Source RCON client over blocking TCP (standard library only).
//!
//! The host serializes action calls per plugin, so one short-lived
//! connection per action is the whole design: connect, authenticate,
//! execute one adapter command, read the response, close. No connection
//! pool, no background threads, no stale sockets — and a fresh auth on
//! every call means a rotated password never needs a plugin restart.
//!
//! Protocol (Valve RCON): little-endian packets of
//! `size + id + type + body + \0\0`, where `size` counts everything after
//! itself. Bodies cap at 4096 bytes; longer responses arrive split across
//! several packets, terminated here with the classic empty-packet mirror:
//! after the command we send an empty `RESPONSE_VALUE` with a second id
//! and read until that id echoes back.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const SERVERDATA_RESPONSE_VALUE: i32 = 0;
const SERVERDATA_EXECCOMMAND: i32 = 2;
const SERVERDATA_AUTH_RESPONSE: i32 = 2;
const SERVERDATA_AUTH: i32 = 3;

/// Protocol body cap per packet; larger reads are a framing violation.
const MAX_PACKET_BODY: usize = 4096;
/// Total response cap across split packets (the adapter answers one line).
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

/// RCON transport failures. Display text never includes credentials; only
/// the host:port the operator configured.
#[derive(Debug)]
pub enum RconError {
    Connect(String),
    Auth(String),
    Timeout(String),
    Protocol(String),
    Io(String),
}

impl std::fmt::Display for RconError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RconError::Connect(detail) => write!(f, "cannot reach the game server ({detail})"),
            RconError::Auth(detail) => write!(f, "RCON authentication failed ({detail})"),
            RconError::Timeout(detail) => write!(f, "RCON timed out ({detail})"),
            RconError::Protocol(detail) => write!(f, "RCON framing error ({detail})"),
            RconError::Io(detail) => write!(f, "RCON socket error ({detail})"),
        }
    }
}

impl std::error::Error for RconError {}

fn io_message(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            format!("timed out: {error}")
        }
        _ => error.to_string(),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Packet {
    id: i32,
    kind: i32,
    body: Vec<u8>,
}

fn encode_packet(id: i32, kind: i32, body: &[u8]) -> Vec<u8> {
    let size = (body.len() + 10) as u32;
    let mut packet = Vec::with_capacity(size as usize + 4);
    packet.extend_from_slice(&size.to_le_bytes());
    packet.extend_from_slice(&id.to_le_bytes());
    packet.extend_from_slice(&kind.to_le_bytes());
    packet.extend_from_slice(body);
    packet.extend_from_slice(&[0, 0]);
    packet
}

fn decode_packet(stream: &mut TcpStream) -> Result<Packet, RconError> {
    let mut size_bytes = [0u8; 4];
    stream
        .read_exact(&mut size_bytes)
        .map_err(|error| map_read_error(error, "size prefix"))?;
    let size = u32::from_le_bytes(size_bytes) as usize;
    // size covers id + type + body + two nulls (10 bytes of overhead).
    if size < 10 || size - 10 > MAX_PACKET_BODY {
        return Err(RconError::Protocol(format!(
            "packet declares {size} bytes (body cap {MAX_PACKET_BODY})"
        )));
    }
    let mut payload = vec![0u8; size];
    stream
        .read_exact(&mut payload)
        .map_err(|error| map_read_error(error, "packet payload"))?;
    if payload[size - 2..] != [0, 0] {
        return Err(RconError::Protocol("packet is not null-terminated".into()));
    }
    let id = i32::from_le_bytes(payload[0..4].try_into().expect("id slice"));
    let kind = i32::from_le_bytes(payload[4..8].try_into().expect("type slice"));
    Ok(Packet {
        id,
        kind,
        body: payload[8..size - 2].to_vec(),
    })
}

fn map_read_error(error: std::io::Error, what: &str) -> RconError {
    match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            RconError::Timeout(format!("reading {what}: {error}"))
        }
        std::io::ErrorKind::UnexpectedEof => {
            RconError::Protocol(format!("server closed the connection while reading {what}"))
        }
        _ => RconError::Io(format!("reading {what}: {error}")),
    }
}

fn send_packet(stream: &mut TcpStream, id: i32, kind: i32, body: &[u8]) -> Result<(), RconError> {
    let packet = encode_packet(id, kind, body);
    stream
        .write_all(&packet)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                RconError::Timeout(format!("writing packet: {error}"))
            }
            _ => RconError::Io(format!("writing packet: {error}")),
        })
}

/// Per-operation socket timeouts. The connect budget stays small so a dead
/// server fails fast; auth and exec share the larger configured budget.
#[derive(Debug, Clone, Copy)]
pub struct RconTimeouts {
    pub connect: Duration,
    pub io: Duration,
}

/// Executes one command on a fresh connection: connect, authenticate,
/// execute, reassemble the split-packet response, close.
///
/// The raw response text is returned verbatim (lossy UTF-8); protocol
/// interpretation (`TT_OK`/`TT_ERR`) happens in [`crate::command`], which
/// is also where a missing confirmation becomes an explicit unknown
/// outcome instead of a claimed success.
pub fn execute(
    host: &str,
    port: u16,
    password: &str,
    command: &str,
    timeouts: RconTimeouts,
) -> Result<String, RconError> {
    let address = format!("{host}:{port}");
    let socket = address
        .to_socket_addrs()
        .map_err(|error| RconError::Connect(format!("cannot resolve `{address}`: {error}")))?
        .next()
        .ok_or_else(|| RconError::Connect(format!("cannot resolve `{address}`")))?;
    let mut stream = TcpStream::connect_timeout(&socket, timeouts.connect)
        .map_err(|error| RconError::Connect(format!("`{address}`: {}", io_message(error))))?;
    stream
        .set_read_timeout(Some(timeouts.io))
        .map_err(|error| RconError::Io(format!("read timeout: {error}")))?;
    stream
        .set_write_timeout(Some(timeouts.io))
        .map_err(|error| RconError::Io(format!("write timeout: {error}")))?;

    // Auth: id -1 on any reply means rejected; AUTH_RESPONSE with our id
    // means accepted. Servers may emit an empty RESPONSE_VALUE first.
    send_packet(&mut stream, 1, SERVERDATA_AUTH, password.as_bytes())?;
    loop {
        let packet = decode_packet(&mut stream)?;
        if packet.id == -1 {
            return Err(RconError::Auth("server rejected the password".into()));
        }
        if packet.id == 1 && packet.kind == SERVERDATA_AUTH_RESPONSE {
            break;
        }
    }

    // Exec plus an empty mirror packet: responses for id 2 accumulate
    // until id 3 echoes back, however the server splits the body.
    send_packet(&mut stream, 2, SERVERDATA_EXECCOMMAND, command.as_bytes())?;
    send_packet(&mut stream, 3, SERVERDATA_RESPONSE_VALUE, &[])?;
    let mut response = Vec::new();
    loop {
        let packet = decode_packet(&mut stream)?;
        if packet.id == 3 {
            break;
        }
        if packet.id == 2 {
            if response.len() + packet.body.len() > MAX_RESPONSE_BYTES {
                return Err(RconError::Protocol(format!(
                    "response exceeds {MAX_RESPONSE_BYTES} bytes"
                )));
            }
            response.extend_from_slice(&packet.body);
        }
    }
    Ok(String::from_utf8_lossy(&response).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// Spawns a scripted fake server on loopback; the script reads raw
    /// request packets and writes raw replies, then the listener drops.
    fn fake_server(
        script: impl FnOnce(TcpStream) + Send + 'static,
    ) -> (thread::JoinHandle<()>, u16) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        let port = listener.local_addr().expect("port").port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("one client");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("timeout");
            script(stream);
        });
        (handle, port)
    }

    fn read_request(stream: &mut TcpStream) -> Packet {
        decode_packet(stream).expect("request decodes")
    }

    fn timeouts() -> RconTimeouts {
        RconTimeouts {
            connect: Duration::from_secs(2),
            io: Duration::from_secs(2),
        }
    }

    #[test]
    fn auth_then_exec_round_trip() {
        let (handle, port) = fake_server(|mut stream| {
            let auth = read_request(&mut stream);
            assert_eq!(auth.kind, SERVERDATA_AUTH);
            assert_eq!(auth.body, b"secret");
            send_packet(&mut stream, 1, SERVERDATA_AUTH_RESPONSE, &[]).expect("auth ok");
            let exec = read_request(&mut stream);
            assert_eq!(exec.kind, SERVERDATA_EXECCOMMAND);
            assert_eq!(exec.body, b"tt_status r1");
            let _mirror = read_request(&mut stream);
            send_packet(
                &mut stream,
                2,
                SERVERDATA_RESPONSE_VALUE,
                b"TT_OK|r1|map=ok",
            )
            .expect("reply");
            send_packet(&mut stream, 3, SERVERDATA_RESPONSE_VALUE, &[]).expect("mirror");
        });
        let body = execute("127.0.0.1", port, "secret", "tt_status r1", timeouts()).expect("exec");
        assert_eq!(body, "TT_OK|r1|map=ok");
        handle.join().expect("server");
    }

    #[test]
    fn split_responses_reassemble_before_the_mirror() {
        let (handle, port) = fake_server(|mut stream| {
            let _auth = read_request(&mut stream);
            send_packet(&mut stream, 1, SERVERDATA_AUTH_RESPONSE, &[]).expect("auth ok");
            let _exec = read_request(&mut stream);
            let _mirror = read_request(&mut stream);
            send_packet(&mut stream, 2, SERVERDATA_RESPONSE_VALUE, b"TT_OK|").expect("part 1");
            send_packet(&mut stream, 2, SERVERDATA_RESPONSE_VALUE, b"r9|x=1").expect("part 2");
            send_packet(&mut stream, 3, SERVERDATA_RESPONSE_VALUE, &[]).expect("mirror");
        });
        let body = execute("127.0.0.1", port, "secret", "tt_status r9", timeouts()).expect("exec");
        assert_eq!(body, "TT_OK|r9|x=1");
        handle.join().expect("server");
    }

    #[test]
    fn wrong_password_reports_auth_not_io() {
        let (handle, port) = fake_server(|mut stream| {
            let _auth = read_request(&mut stream);
            send_packet(&mut stream, -1, SERVERDATA_AUTH_RESPONSE, &[]).expect("auth deny");
        });
        let error =
            execute("127.0.0.1", port, "wrong", "tt_status r1", timeouts()).expect_err("must fail");
        assert!(matches!(error, RconError::Auth(_)), "got {error:?}");
        assert!(!error.to_string().contains("wrong"));
        handle.join().expect("server");
    }

    #[test]
    fn silent_server_surfaces_timeout() {
        let (handle, port) = fake_server(|mut stream| {
            let _auth = read_request(&mut stream);
            thread::sleep(Duration::from_secs(5));
        });
        let error = execute(
            "127.0.0.1",
            port,
            "secret",
            "tt_status r1",
            RconTimeouts {
                connect: Duration::from_secs(2),
                io: Duration::from_millis(200),
            },
        )
        .expect_err("must time out");
        assert!(matches!(error, RconError::Timeout(_)), "got {error:?}");
        handle.join().expect("server");
    }

    #[test]
    fn garbage_framing_is_a_protocol_error() {
        let (handle, port) = fake_server(|mut stream| {
            let _auth = read_request(&mut stream);
            // Declares a 1MB body: over the cap, must be rejected outright.
            stream
                .write_all(&1_000_000u32.to_le_bytes())
                .expect("write");
        });
        let error = execute("127.0.0.1", port, "secret", "tt_status r1", timeouts())
            .expect_err("must fail");
        assert!(matches!(error, RconError::Protocol(_)), "got {error:?}");
        handle.join().expect("server");
    }

    #[test]
    fn closed_port_reports_connect() {
        // Port 1 on loopback refuses (or is unreachable) without hanging.
        let error =
            execute("127.0.0.1", 1, "secret", "tt_status r1", timeouts()).expect_err("must fail");
        assert!(matches!(error, RconError::Connect(_)), "got {error:?}");
    }

    #[test]
    fn packets_round_trip() {
        let bytes = encode_packet(7, SERVERDATA_EXECCOMMAND, b"hello");
        // size(4) + id(4) + type(4) + body(5) + nulls(2)
        assert_eq!(bytes.len(), 4 + 4 + 4 + 5 + 2);
        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 15);
    }
}
