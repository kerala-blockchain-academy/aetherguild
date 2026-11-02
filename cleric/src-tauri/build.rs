fn main() {
    tauri_build::build();

    // Locate sidecar binaries in src-tauri/ by prefix so the exact filename
    // (target-triple suffix, double-dashes, etc.) doesn't matter.
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let druid = find_bin(&dir, "druid")
        .expect("druid binary not found in src-tauri/ — place it there");
    let solc = find_bin(&dir, "solc")
        .expect("solc binary not found in src-tauri/ — place it there");

    // Emit absolute paths so include_bytes!(env!("...")) works in lib.rs.
    println!("cargo:rustc-env=DRUID_BIN_PATH={}", druid.display());
    println!("cargo:rustc-env=SOLC_BIN_PATH={}", solc.display());

    // Rebuild if either binary changes.
    println!("cargo:rerun-if-changed={}", druid.display());
    println!("cargo:rerun-if-changed={}", solc.display());
}

fn find_bin(dir: &std::path::Path, prefix: &str) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let name = e.file_name();
        let s = name.to_string_lossy().to_lowercase();
        (s.starts_with(prefix) && (s.ends_with(".exe") || !s.contains('.')))
            .then(|| e.path())
    })
}
