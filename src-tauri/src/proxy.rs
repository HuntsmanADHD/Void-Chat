use std::sync::OnceLock;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::runtime::Runtime;
use tokio_socks::tcp::Socks5Stream;

use crate::tor::SOCKS_PORT;

/// Where the frontend dials to send traffic at a remote onion. Picked
/// well above the usual ephemeral range so it can't collide with the
/// relay (3001), Vite (5173), or Tor's own listeners (19050/19051).
pub const PROXY_PORT: u16 = 11811;

/// Where the v3 hidden service exposes the relay. Matches the
/// `HiddenServicePort 80 ...` line in our torrc.
const HIDDEN_SERVICE_VIRT_PORT: u16 = 80;

/// Cap on how much of the initial HTTP request to buffer before we have
/// the headers parsed. The relay's auth + control headers are small;
/// 16KiB is generous and still bounds memory in the bad case of a peer
/// sending no `\r\n\r\n` ever.
const HEADER_BUFFER_CAP: usize = 16 * 1024;

/// Maximum number of v3-onion characters we accept in the path. 56 is the
/// exact length; we accept up to ~70 to allow a `.onion` suffix or a
/// future protocol bump and reject anything obviously malformed.
const MAX_ONION_HOSTLIKE_LEN: usize = 80;

/// Process-wide tokio runtime. The proxy needs an async runtime; Tauri
/// runs its own but we can't borrow it for arbitrary listeners, so
/// stand up a small multi-thread runtime once at startup.
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("voidchat-proxy")
            .enable_all()
            .build()
            .expect("could not build proxy tokio runtime")
    })
}

/// Spawn the forward proxy listener. Returns immediately; the listener
/// runs forever inside the proxy runtime.
pub fn start() -> std::io::Result<()> {
    let rt = runtime();
    let handle = rt.handle().clone();
    handle.spawn(async {
        match TcpListener::bind(("127.0.0.1", PROXY_PORT)).await {
            Ok(listener) => {
                log::info!("[onion-proxy] listening on 127.0.0.1:{PROXY_PORT}");
                accept_loop(listener).await;
            }
            Err(e) => {
                log::error!("[onion-proxy] could not bind 127.0.0.1:{PROXY_PORT}: {e}");
            }
        }
    });
    Ok(())
}

async fn accept_loop(listener: TcpListener) {
    loop {
        match listener.accept().await {
            Ok((socket, peer)) => {
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(socket).await {
                        // Most errors here are "browser closed mid-stream"
                        // or "onion unreachable" — neither is exceptional
                        // enough to print every time, so debug-level only.
                        log::debug!("[onion-proxy] {peer}: {e}");
                    }
                });
            }
            Err(e) => {
                log::warn!("[onion-proxy] accept failed: {e}");
                // Brief backoff so we don't busy-loop on a permanently
                // broken socket.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}

/// Parse `/o/<onion>/<rest>` and return (onion, rewritten_request_line).
///
/// The proxy's contract with the frontend is:
///     GET /o/<onion>/api/communities HTTP/1.1
/// gets rewritten to
///     GET /api/communities HTTP/1.1
/// before being sent at <onion>:80 through SOCKS5.
fn split_request_line(line: &str) -> Option<(String, String)> {
    // Format: "METHOD SP PATH SP HTTP/1.1"
    let mut parts = line.splitn(3, ' ');
    let method = parts.next()?;
    let path = parts.next()?;
    let version = parts.next()?;

    let stripped = path.strip_prefix("/o/")?;
    let slash = stripped.find('/')?;
    let onion_raw = &stripped[..slash];
    if onion_raw.is_empty() || onion_raw.len() > MAX_ONION_HOSTLIKE_LEN {
        return None;
    }
    let onion = if onion_raw.ends_with(".onion") {
        onion_raw.to_string()
    } else {
        format!("{onion_raw}.onion")
    };

    let rest = &stripped[slash..]; // includes leading '/'
    let rewritten = format!("{method} {rest} {version}");
    Some((onion, rewritten))
}

/// Rewrite the Host header to point at the onion. The relay validates
/// nothing about Host (other than CORS, which we handle separately), but
/// some HTTP intermediaries care, and it keeps the wire format honest.
fn rewrite_host_header(headers: &str, onion: &str) -> String {
    let mut out = String::with_capacity(headers.len());
    let mut replaced = false;
    for line in headers.split("\r\n") {
        if line.is_empty() {
            out.push_str("\r\n");
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("host:") {
            out.push_str(&format!("Host: {onion}"));
            replaced = true;
        } else {
            out.push_str(line);
        }
        out.push_str("\r\n");
    }
    if !replaced {
        out.push_str(&format!("Host: {onion}\r\n"));
    }
    out
}

async fn handle_connection(mut client: TcpStream) -> std::io::Result<()> {
    // 1) Read the first request's headers. We need them to extract the
    //    onion from the path. Cap the buffer so a misbehaving client
    //    can't OOM us by never sending \r\n\r\n.
    let mut header_buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 2048];
    let header_end = loop {
        if header_buf.len() >= HEADER_BUFFER_CAP {
            return Err(std::io::Error::other("request headers exceed cap"));
        }
        let n = client.read(&mut tmp).await?;
        if n == 0 {
            return Err(std::io::Error::other("client closed before sending headers"));
        }
        header_buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_double_crlf(&header_buf) {
            break pos + 4; // include the \r\n\r\n
        }
    };

    // 2) Split out the request line + headers + any body bytes that
    //    arrived alongside.
    let (head_bytes, leftover_body) = header_buf.split_at(header_end);
    let head_str = std::str::from_utf8(head_bytes)
        .map_err(|_| std::io::Error::other("non-utf8 request head"))?;
    let mut lines = head_str.splitn(2, "\r\n");
    let request_line = lines.next().unwrap_or("");
    let header_block = lines.next().unwrap_or("");

    let (onion, rewritten_line) = split_request_line(request_line)
        .ok_or_else(|| std::io::Error::other("path must be /o/<onion>/..."))?;

    // 3) Open SOCKS5 → onion:80 via Tor.
    let socks_addr = format!("127.0.0.1:{}", SOCKS_PORT);
    let target = (onion.as_str(), HIDDEN_SERVICE_VIRT_PORT);
    let upstream = Socks5Stream::connect(socks_addr.as_str(), target)
        .await
        .map_err(|e| std::io::Error::other(format!("SOCKS5 connect to {onion} failed: {e}")))?;
    let mut upstream = upstream.into_inner();

    // 4) Send the rewritten request line, host-fixed headers, then any
    //    body bytes that came in with the head.
    upstream.write_all(rewritten_line.as_bytes()).await?;
    upstream.write_all(b"\r\n").await?;
    let new_headers = rewrite_host_header(header_block, &onion);
    upstream.write_all(new_headers.as_bytes()).await?;
    if !leftover_body.is_empty() {
        upstream.write_all(leftover_body).await?;
    }

    // 5) After this point the protocol can be anything — HTTP/1.1
    //    request/response chunks, a WebSocket frame stream after a 101
    //    Upgrade, whatever the relay speaks. Just become a transparent
    //    bidirectional byte pump until one side closes.
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}
