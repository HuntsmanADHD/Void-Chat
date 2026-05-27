//! Build the relay sidecar binary and stage it under `binaries/` with
//! Tauri's required `<name>-<target-triple>` naming. `tauri.conf.json`
//! lists it under `bundle.externalBin`, which makes Tauri:
//!   - copy it next to the app binary in dev runs, and
//!   - bundle it into the installer on `tauri build`.
//!
//! Why this lives in build.rs:
//!   - keeps `cargo build` of src-tauri self-sufficient: one command
//!     produces a ready-to-run Tauri binary with the relay already
//!     staged. No separate "build relay first" step for the dev to
//!     remember.
//!   - the rerun-if-changed lines below scope the rebuild to relay
//!     source + manifest, so editing src-tauri code alone doesn't
//!     re-invoke cargo on the relay crate.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    stage_relay_sidecar();
    tauri_build::build();
}

fn stage_relay_sidecar() {
    let target = env::var("TARGET").expect("cargo did not set TARGET");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let relay_manifest = manifest_dir
        .parent()
        .expect("src-tauri has no parent")
        .join("relay")
        .join("Cargo.toml");

    println!("cargo:rerun-if-changed={}", relay_manifest.display());
    let relay_src = relay_manifest.parent().unwrap().join("src");
    println!("cargo:rerun-if-changed={}", relay_src.display());
    println!("cargo:rerun-if-env-changed=VOIDCHAT_SKIP_RELAY_BUILD");

    // Escape hatch: CI matrices or release pipelines that build the
    // relay separately (cross-compile, signed builds) can set
    // VOIDCHAT_SKIP_RELAY_BUILD=1 and drop the binary into
    // binaries/voidchat-relay-<triple> themselves.
    if env::var("VOIDCHAT_SKIP_RELAY_BUILD").is_ok() {
        println!("cargo:warning=VOIDCHAT_SKIP_RELAY_BUILD set — assuming sidecar already staged");
        return;
    }

    // Match the parent build's profile so debug builds spawn debug
    // relays (faster to rebuild) and release builds spawn release
    // relays (small + fast).
    let profile = env::var("PROFILE").unwrap_or_else(|_| "release".to_string());
    let mut cmd = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".to_string()));
    cmd.arg("build")
        .arg("--manifest-path")
        .arg(&relay_manifest)
        .arg("--target")
        .arg(&target);
    if profile == "release" {
        cmd.arg("--release");
    }
    let status = cmd.status().expect("failed to invoke cargo for relay");
    if !status.success() {
        panic!("relay build failed (cargo build exited with {status})");
    }

    let bin_name = if target.contains("windows") {
        "voidchat-relay.exe"
    } else {
        "voidchat-relay"
    };
    let built = relay_manifest
        .parent()
        .unwrap()
        .join("target")
        .join(&target)
        .join(&profile)
        .join(bin_name);
    assert!(
        built.exists(),
        "expected relay binary at {}",
        built.display()
    );

    let binaries_dir = manifest_dir.join("binaries");
    std::fs::create_dir_all(&binaries_dir).expect("create binaries dir");
    // Tauri sidecar naming: <name>-<target-triple> (with .exe on Windows).
    let staged_name = if target.contains("windows") {
        format!("voidchat-relay-{target}.exe")
    } else {
        format!("voidchat-relay-{target}")
    };
    let staged = binaries_dir.join(&staged_name);
    copy_if_changed(&built, &staged);
}

fn copy_if_changed(src: &Path, dst: &Path) {
    if dst.exists() {
        let s_meta = std::fs::metadata(src).ok();
        let d_meta = std::fs::metadata(dst).ok();
        if let (Some(s), Some(d)) = (s_meta, d_meta) {
            if let (Ok(sm), Ok(dm)) = (s.modified(), d.modified()) {
                if sm <= dm {
                    return;
                }
            }
        }
    }
    std::fs::copy(src, dst).expect("copy relay binary to binaries/");
}
