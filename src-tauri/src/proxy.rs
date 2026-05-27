use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::runtime::Runtime;
use tokio::sync::Semaphore;
use tokio::time::timeout;
use tokio_socks::tcp::Socks5Stream;

use crate::tor::SOCKS_PORT;

/// How long we wait for SOCKS5 → onion handshake before giving up.
/// 30s is comfortable for normal Tor circuits (which usually complete
/// in 2–10s); past that the onion is likely down or our circuit is
/// broken. Without this, a stale invite link to a dead onion would
/// hang the browser tab forever and leak a file descriptor.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Cap on concurrent in-flight proxy connections. Each connection
/// holds an FD, a tokio task, and a SOCKS circuit; without a cap a
/// malicious page could trigger thousands of slow dials and exhaust
/// any of those. 256 is comfortably above any realistic peer count
/// while preventing accidental fork-bomb resource use.
const MAX_CONCURRENT_CONNECTIONS: usize = 256;

/// Per-connection lifetime cap. After this the bidirectional copy
/// returns whether or not either side has closed; the connection is
/// torn down and the semaphore slot freed. Audit pt6 H1: without
/// this, a slowloris-style onion (or peer that stops reading) pins
/// a connection forever, and 256 such victims fully exhaust the
/// concurrency cap. Ten minutes covers any realistic chat /
/// HTTP-API exchange; long-lived socket.io streams re-establish
/// transparently when the underlying connection closes.
const CONNECTION_LIFETIME: std::time::Duration = std::time::Duration::from_secs(600);

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

/// Per-session shared secret. Generated fresh at app startup, exposed
/// to the renderer via the `get_proxy_token` Tauri command. Every
/// request hitting the proxy must include this token in its path:
///
/// ```text
///     GET /o/<token>/<onion>/<rest> HTTP/1.1
/// ```
///
/// Without it the proxy returns 403. Closes the "any local process on
/// this machine can use our Tor circuit" hole — even malware sharing
/// the same uid can't reach the proxy without first stealing the
/// token from the running app's memory.
static PROXY_TOKEN: OnceLock<String> = OnceLock::new();

/// Initialize the per-session proxy token. Called from `start()`.
fn init_proxy_token() {
    PROXY_TOKEN.get_or_init(|| {
        let mut bytes = [0u8; 24]; // 192 bits — comfortably beyond brute-force
        if getrandom::getrandom(&mut bytes).is_err() {
            // Extremely unlikely (would mean the OS RNG isn't available)
            // but if it happens we'd rather panic than ship a weak token.
            panic!("[onion-proxy] OS RNG unavailable — refusing to start without a strong token");
        }
        encode_url_safe_base64(&bytes)
    });
}

pub fn proxy_token() -> &'static str {
    PROXY_TOKEN
        .get()
        .map(String::as_str)
        .unwrap_or("")
}

/// Tauri command — the frontend calls this once at boot to learn the
/// per-session proxy token. The token then prefixes every URL routed
/// through the proxy (see lib/relayBase.ts).
///
/// Note: returning the token to the renderer is safe IFF the renderer
/// is the only thing allowed to invoke this command (the default
/// Tauri capability already gates app commands to the main window).
/// We're not handing the token to arbitrary JS contexts.
#[tauri::command]
pub fn get_proxy_token() -> String {
    proxy_token().to_string()
}

/// URL-safe base64 without padding — keeps the path component clean
/// (no `+`, `/`, or `=` that would force percent-encoding in URLs).
fn encode_url_safe_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(b2 & 0x3f) as usize] as char);
        }
    }
    out
}

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

/// Spawn the forward proxy listener.
///
/// `bind()` is done synchronously via `std::net::TcpListener` so a
/// port-already-in-use error propagates as a real `Err` to the caller
/// (lib.rs surfaces it via the `proxy://status` event). The previous
/// "bind inside the spawned task" pattern silently swallowed bind
/// failures.
///
/// Why not `runtime.block_on(tokio::net::TcpListener::bind(...))`:
/// that would block the Tauri setup thread on a different runtime,
/// risking a cold-start deadlock between the two runtimes' worker
/// pools. The std bind avoids the runtime crossing — we hand the
/// resulting raw socket to tokio inside the spawned task via
/// `TcpListener::from_std`.
pub fn start() -> std::io::Result<()> {
    init_proxy_token();
    // Bind BOTH IPv4 and IPv6 loopback. WebKit-family browsers (which
    // Tauri uses on every platform — WKWebView on macOS, WebKitGTK on
    // Linux, WebView2 on Windows) resolve `localhost` to both and
    // typically try `::1` first. If we only listen on 127.0.0.1, the
    // browser gets "connection refused" on the IPv6 attempt and
    // surfaces a network failure to JS that LOOKS like a CORS error
    // (the browser synthesizes "Status: 400" + "not allowed by ACAO"
    // when it can't get a real response). curl falls back to IPv4
    // gracefully; browsers often don't. Audit: cross-host join from a
    // Fedora VM was hitting this exact failure mode end-to-end.
    //
    // Keep this loopback-only (no 0.0.0.0 / [::]) — same trust
    // boundary as before. Each listener gets SO_REUSEADDR so a
    // Ctrl+C / restart doesn't lose the bind to TIME_WAIT. The IPv6
    // listener gets IPV6_V6ONLY so it doesn't try to claim IPv4 (we
    // have a separate IPv4 listener for that).
    let v4 = bind_loopback("127.0.0.1:0".replace(":0", &format!(":{PROXY_PORT}")), false)?;
    let v6 = bind_loopback(format!("[::1]:{PROXY_PORT}"), true).ok();
    log::info!(
        "[onion-proxy] listening on 127.0.0.1:{PROXY_PORT}{}",
        if v6.is_some() { " and [::1]" } else { " (IPv6 bind failed; IPv4 only)" }
    );
    let rt = runtime();
    rt.handle().spawn(async move {
        match TcpListener::from_std(v4) {
            Ok(listener) => {
                tokio::spawn(accept_loop(listener));
            }
            Err(e) => log::error!("[onion-proxy] failed to adopt IPv4 listener: {e}"),
        }
        if let Some(l) = v6 {
            match TcpListener::from_std(l) {
                Ok(listener) => {
                    tokio::spawn(accept_loop(listener));
                }
                Err(e) => log::error!("[onion-proxy] failed to adopt IPv6 listener: {e}"),
            }
        }
    });
    Ok(())
}

/// Bind a loopback TCP listener with `SO_REUSEADDR` set so the next
/// process startup doesn't collide with sockets still in TIME_WAIT.
/// For IPv6, also set `IPV6_V6ONLY` so the listener doesn't try to
/// shadow the separate IPv4 listener via dual-stack mapping.
fn bind_loopback(addr_str: String, v6_only: bool) -> std::io::Result<std::net::TcpListener> {
    use std::net::SocketAddr;
    use std::str::FromStr;

    let addr = SocketAddr::from_str(&addr_str)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("addr parse: {e}")))?;

    #[cfg(unix)]
    {
        use std::os::fd::FromRawFd;
        let domain = if addr.is_ipv6() { libc::AF_INET6 } else { libc::AF_INET };
        // SAFETY: socket()/setsockopt()/bind()/listen() are standard
        // POSIX. We own the fd until we hand it to TcpListener.
        let fd = unsafe { libc::socket(domain, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // RAII guard so an early return after this point still closes the fd.
        struct FdGuard(libc::c_int);
        impl Drop for FdGuard {
            fn drop(&mut self) {
                unsafe { libc::close(self.0); }
            }
        }
        let guard = FdGuard(fd);

        let on: libc::c_int = 1;
        let r = unsafe {
            libc::setsockopt(
                fd, libc::SOL_SOCKET, libc::SO_REUSEADDR,
                &on as *const _ as *const libc::c_void,
                std::mem::size_of_val(&on) as libc::socklen_t,
            )
        };
        if r != 0 { return Err(std::io::Error::last_os_error()); }

        if addr.is_ipv6() && v6_only {
            let r = unsafe {
                libc::setsockopt(
                    fd, libc::IPPROTO_IPV6, libc::IPV6_V6ONLY,
                    &on as *const _ as *const libc::c_void,
                    std::mem::size_of_val(&on) as libc::socklen_t,
                )
            };
            if r != 0 { return Err(std::io::Error::last_os_error()); }
        }

        // Build the sockaddr structures by hand and bind.
        let bind_r = match addr {
            SocketAddr::V4(v4) => {
                let sa = libc::sockaddr_in {
                    sin_family: libc::AF_INET as libc::sa_family_t,
                    sin_port: v4.port().to_be(),
                    sin_addr: libc::in_addr { s_addr: u32::from(*v4.ip()).to_be() },
                    sin_zero: [0; 8],
                };
                unsafe {
                    libc::bind(
                        fd,
                        &sa as *const _ as *const libc::sockaddr,
                        std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
                    )
                }
            }
            SocketAddr::V6(v6) => {
                let sa = libc::sockaddr_in6 {
                    sin6_family: libc::AF_INET6 as libc::sa_family_t,
                    sin6_port: v6.port().to_be(),
                    sin6_flowinfo: 0,
                    sin6_addr: libc::in6_addr { s6_addr: v6.ip().octets() },
                    sin6_scope_id: v6.scope_id(),
                };
                unsafe {
                    libc::bind(
                        fd,
                        &sa as *const _ as *const libc::sockaddr,
                        std::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t,
                    )
                }
            }
        };
        if bind_r != 0 { return Err(std::io::Error::last_os_error()); }

        let listen_r = unsafe { libc::listen(fd, 128) };
        if listen_r != 0 { return Err(std::io::Error::last_os_error()); }

        // Defuse the guard — TcpListener takes ownership now.
        let raw = guard.0;
        std::mem::forget(guard);
        let listener = unsafe { std::net::TcpListener::from_raw_fd(raw) };
        listener.set_nonblocking(true)?;
        Ok(listener)
    }
    #[cfg(not(unix))]
    {
        let _ = v6_only;
        let listener = std::net::TcpListener::bind(addr)?;
        listener.set_nonblocking(true)?;
        Ok(listener)
    }
}

async fn accept_loop(listener: TcpListener) {
    // Concurrency cap — every connection takes a permit; new connections
    // block until an in-flight one drops. Prevents an attacker page
    // from issuing thousands of slow `fetch()` calls and exhausting our
    // SOCKS circuits / file descriptors.
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
    loop {
        match listener.accept().await {
            Ok((socket, peer)) => {
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => {
                        // Semaphore closed — should never happen unless
                        // the proxy is shutting down.
                        log::warn!("[onion-proxy] semaphore closed, exiting accept loop");
                        return;
                    }
                };
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(socket).await {
                        // Most errors here are "browser closed mid-stream"
                        // or "onion unreachable" — neither is exceptional
                        // enough to print every time, so debug-level only.
                        log::debug!("[onion-proxy] {peer}: {e}");
                    }
                    drop(permit); // explicit for clarity
                });
            }
            Err(e) => {
                log::warn!("[onion-proxy] accept failed: {e}");
                // Brief backoff so we don't busy-loop on a permanently
                // broken socket.
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

/// Parse `/o/<token>/<onion>/<rest>` and return (onion, rewritten_request_line).
///
/// The proxy's contract with the frontend is:
///     GET /o/<token>/<onion>/api/communities HTTP/1.1
/// gets rewritten to
///     GET /api/communities HTTP/1.1
/// before being sent at <onion>:80 through SOCKS5.
///
/// `<token>` must equal this session's `PROXY_TOKEN`. Requests with a
/// missing, wrong, or short token are rejected — that's how we keep
/// other local processes from using the Tor circuit attributed to us.
/// Token comparison is constant-time to avoid timing oracles.
fn split_request_line(line: &str) -> Option<(String, String)> {
    // Format: "METHOD SP PATH SP HTTP/1.1"
    let mut parts = line.splitn(3, ' ');
    let method = parts.next()?;
    let path = parts.next()?;
    let version = parts.next()?;

    // Audit pt6 H9: method whitelist. The renderer's CSP + the relay's
    // route definitions limit methods on the legitimate path, but a
    // compromised renderer (or future XSS regression) could otherwise
    // send arbitrary methods to remote .onion relays. Restrict to the
    // set this app actually uses; anything else gets rejected at the
    // proxy boundary instead of hoping CSP catches it.
    if !matches!(method, "GET" | "POST" | "DELETE" | "OPTIONS") {
        return None;
    }

    let stripped = path.strip_prefix("/o/")?;
    // First segment is the auth token.
    let token_end = stripped.find('/')?;
    let supplied_token = &stripped[..token_end];
    let expected = PROXY_TOKEN.get()?.as_str();
    if !constant_time_eq(supplied_token.as_bytes(), expected.as_bytes()) {
        return None;
    }

    let after_token = &stripped[token_end + 1..];
    let onion_end = after_token.find('/')?;
    let onion_raw = &after_token[..onion_end];
    if onion_raw.is_empty() || onion_raw.len() > MAX_ONION_HOSTLIKE_LEN {
        return None;
    }
    let onion = if onion_raw.ends_with(".onion") {
        onion_raw.to_string()
    } else {
        format!("{onion_raw}.onion")
    };

    let rest = &after_token[onion_end..]; // includes leading '/'
    let rewritten = format!("{method} {rest} {version}");
    Some((onion, rewritten))
}

/// Constant-time byte comparison. `a == b` would short-circuit on first
/// mismatch and leak the position via timing; this iterates the full
/// max length so wall-clock cost is identical for any input. Lengths
/// being different is itself a fast reject — which is fine, the token
/// has a fixed length and that fact is public.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// HTTP header carrying a per-proxy-connection circuit token. Used by
/// the relay solely as a rate-limit bucket key. Audit pt6 H2: every
/// cross-host visitor reaches the relay from `127.0.0.1` (proxy → relay
/// on loopback), so without a per-circuit hint they all share the
/// single `127.0.0.1` rate bucket — one flooder DoSes everyone
/// including the local user. With this header, each proxy circuit gets
/// its own bucket; the local renderer (which has no proxy in front of
/// it and thus no token) gets its own bucket too.
///
/// The relay TRUSTS this header for keying but NOT for IP attribution.
/// Strip any client-supplied value first so a cross-host attacker
/// can't pre-stuff the header to share a bucket with the local user.
pub const PROXY_CIRCUIT_HEADER: &str = "X-Voidchat-Proxy-Circuit";

/// Rewrite the Host header to point at the onion + inject the
/// per-circuit token (and strip any client-supplied one). Drops any
/// headers outside a small allowlist before forwarding upstream.
///
/// Audit pt6 H9: previously every header was passed through verbatim
/// (minus Host). A compromised renderer (or future XSS regression)
/// could send arbitrary headers to a remote .onion relay — auth
/// tokens it wasn't supposed to see, fake forwarding hints, etc. The
/// allowlist below is the small set the relay actually reads; anything
/// else gets dropped at the boundary.
fn rewrite_host_header(headers: &str, onion: &str, circuit_token: &str) -> String {
    let mut out = String::with_capacity(headers.len());
    let mut host_replaced = false;
    for line in headers.split("\r\n") {
        if line.is_empty() {
            out.push_str("\r\n");
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("host:") {
            out.push_str(&format!("Host: {onion}"));
            host_replaced = true;
            out.push_str("\r\n");
            continue;
        }
        if lower.starts_with(&format!("{}:", PROXY_CIRCUIT_HEADER.to_ascii_lowercase())) {
            // Drop any client-supplied circuit header so a malicious
            // visitor can't pre-stuff it to alias the local-renderer
            // bucket. Our own header (injected below) is the only
            // value the relay should ever see.
            continue;
        }
        if is_header_allowed(&lower) {
            out.push_str(line);
            out.push_str("\r\n");
        }
        // else: drop silently — header outside the allowlist
    }
    if !host_replaced {
        out.push_str(&format!("Host: {onion}\r\n"));
    }
    out.push_str(&format!("{PROXY_CIRCUIT_HEADER}: {circuit_token}\r\n"));
    out
}

/// HTTP headers the proxy forwards upstream. Anything else gets
/// stripped (see audit pt6 H9). Lower-cased prefix match against
/// "<name>:" — the caller has already lower-cased the line.
fn is_header_allowed(lower_line: &str) -> bool {
    // Headers the relay actually reads / cares about:
    //   - content-type / content-length: standard JSON request body
    //   - x-community-password: relay's auth gate for private
    //     communities AND delete-tokens (audit pt6 C2)
    // CORS preflight: must pass through so the relay's CORS layer
    // sees an OPTIONS as a preflight and responds with ACAO. Without
    // these the browser silently fails every cross-host fetch.
    //   - access-control-request-method
    //   - access-control-request-headers
    // Modern browser fetch metadata: not load-bearing for the relay,
    // but stripping them breaks fetch in some webviews that expect
    // their own headers to come back unchanged. Cheap to allow.
    //   - sec-fetch-*
    //   - dnt
    // Transport / socket.io:
    //   - connection / upgrade / sec-websocket-*: WebSocket handshake
    //   - accept / accept-encoding / user-agent: standard fetch
    //   - origin / referer: needed for the relay's CORS check
    //   - cookie: socket.io may set its sid cookie; passing through
    //     keeps the cross-host session sticky
    //   - if-modified-since / if-none-match: cache validation
    const ALLOWED_PREFIXES: &[&str] = &[
        "content-type:",
        "content-length:",
        "x-community-password:",
        "access-control-request-method:",
        "access-control-request-headers:",
        "accept:",
        "accept-encoding:",
        "accept-language:",
        "user-agent:",
        "origin:",
        "referer:",
        "cookie:",
        "connection:",
        "upgrade:",
        "sec-websocket-key:",
        "sec-websocket-version:",
        "sec-websocket-protocol:",
        "sec-websocket-extensions:",
        "sec-fetch-mode:",
        "sec-fetch-site:",
        "sec-fetch-dest:",
        "sec-fetch-user:",
        "dnt:",
        "if-modified-since:",
        "if-none-match:",
        "pragma:",
        "cache-control:",
    ];
    ALLOWED_PREFIXES.iter().any(|p| lower_line.starts_with(p))
}

/// Mint a fresh per-connection circuit token. 16 bytes hex = 32 chars,
/// plenty of entropy for an HTTP header value. Lives only for the
/// proxy connection's lifetime; the relay doesn't persist anything
/// keyed on it beyond the rate-window TTL.
fn mint_circuit_token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    let mut out = String::with_capacity(32);
    for b in &bytes {
        out.push_str(&format!("{b:02x}"));
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

    // 3) Open SOCKS5 → onion:80 via Tor. Bounded by CONNECT_TIMEOUT —
    //    a dead onion would otherwise hang the dial indefinitely (and
    //    a misbehaving page could pile up many slow dials, exhausting
    //    file descriptors).
    let socks_addr = format!("127.0.0.1:{}", SOCKS_PORT);
    let target = (onion.as_str(), HIDDEN_SERVICE_VIRT_PORT);
    let upstream = match timeout(
        CONNECT_TIMEOUT,
        Socks5Stream::connect(socks_addr.as_str(), target),
    )
    .await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return Err(std::io::Error::other(format!(
                "SOCKS5 connect to {onion} failed: {e}"
            )));
        }
        Err(_) => {
            return Err(std::io::Error::other(format!(
                "SOCKS5 connect to {onion} timed out after {}s",
                CONNECT_TIMEOUT.as_secs()
            )));
        }
    };
    let mut upstream = upstream.into_inner();

    // 4) Send the rewritten request line, host-fixed headers, then any
    //    body bytes that came in with the head. Mint a per-connection
    //    circuit token so the relay can rate-limit this visitor in
    //    their own bucket (see PROXY_CIRCUIT_HEADER docs above).
    let circuit_token = mint_circuit_token();
    upstream.write_all(rewritten_line.as_bytes()).await?;
    upstream.write_all(b"\r\n").await?;
    let new_headers = rewrite_host_header(header_block, &onion, &circuit_token);
    upstream.write_all(new_headers.as_bytes()).await?;
    if !leftover_body.is_empty() {
        upstream.write_all(leftover_body).await?;
    }

    // 5) After this point the protocol can be anything — HTTP/1.1
    //    request/response chunks, a WebSocket frame stream after a 101
    //    Upgrade, whatever the relay speaks. Just become a transparent
    //    bidirectional byte pump until one side closes.
    //
    //    Audit pt6 H1: a per-connection lifetime cap. Without it, a
    //    slowloris-style onion (or any peer that stops reading) would
    //    pin a connection forever; with MAX_CONCURRENT_CONNECTIONS =
    //    256 an attacker could exhaust the semaphore and fully DoS
    //    cross-host comms for the session. Ten minutes is generous
    //    for any realistic chat / API exchange and a long-running
    //    socket.io stream restarts cleanly when it expires.
    match tokio::time::timeout(
        CONNECTION_LIFETIME,
        tokio::io::copy_bidirectional(&mut client, &mut upstream),
    )
    .await
    {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(std::io::Error::other(format!(
            "proxy connection to {onion} exceeded {}s lifetime cap",
            CONNECTION_LIFETIME.as_secs()
        ))),
    }
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}
