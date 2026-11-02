use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

// Suppress the console window that Windows shows for child processes.
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

// ── Embedded binaries ─────────────────────────────────────────────────────
// build.rs scans src-tauri/ for files whose names start with "druid" / "solc"
// and emits their absolute paths as DRUID_BIN_PATH / SOLC_BIN_PATH env vars.
// include_bytes! bakes the raw bytes into the Rust binary at compile time,
// giving us a single self-contained executable with no external dependencies.
const DRUID_BIN: &[u8] = include_bytes!(env!("DRUID_BIN_PATH"));
const SOLC_BIN:  &[u8] = include_bytes!(env!("SOLC_BIN_PATH"));

#[cfg(target_os = "windows")] const DRUID_EXE: &str = "druid.exe";
#[cfg(target_os = "windows")] const SOLC_EXE:  &str = "solc.exe";
#[cfg(not(target_os = "windows"))] const DRUID_EXE: &str = "druid";
#[cfg(not(target_os = "windows"))] const SOLC_EXE:  &str = "solc";

// ── App state ─────────────────────────────────────────────────────────────
struct AppState {
    child:      Arc<Mutex<Option<tokio::process::Child>>>,
    druid_path: PathBuf,
    solc_path:  PathBuf,
    // Set true when *we* kill druid (stop/restart/app-exit) so the exit watcher
    // can tell a deliberate shutdown from a crash and only surface the latter.
    user_stopped: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct LogPayload { line: String, stream: String }

#[derive(Clone, Serialize)]
struct StatusPayload { status: String }

#[derive(Clone, Serialize)]
struct ErrorPayload { message: String, detail: String }

// ── Binary extraction ─────────────────────────────────────────────────────
/// Write `bytes` to `path` only when the file is absent or a different size.
/// Returns `true` when the file was (re)written, so callers can react to a new
/// or upgraded binary (e.g. re-run the one-time druid authorization).
fn extract_binary(path: &PathBuf, bytes: &[u8]) -> Result<bool, String> {
    if path.exists() {
        if let Ok(m) = fs::metadata(path) {
            if m.len() == bytes.len() as u64 { return Ok(false); }
        }
    }
    fs::write(path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).ok();
    }
    Ok(true)
}

// ── Windows: one-time druid authorization ─────────────────────────────────
// druid is an unsigned, low-reputation binary, so Smart App Control / SmartScreen
// may refuse to run it. Cleric normally spawns it with CreateProcess, which never
// shows the interactive "allow" dialog — so the user would otherwise have to find
// and run druid.exe by hand to authorize it. Instead, the first time a new druid
// build is extracted we tag it with a Mark-of-the-Web and launch it once via
// ShellExecuteEx. That surfaces the OS allow prompt; once the user allows it, the
// decision is cached against the file hash and every later CreateProcess spawn
// (with full log streaming) runs without prompting. We immediately terminate this
// priming instance — we only wanted the authorization, not a running node.
///
/// Returns `true` if druid actually started — meaning the user allowed it (or it
/// was already trusted). Returns `false` if they clicked "Don't run" / it was
/// blocked, so the caller knows to try again on the next launch.
#[cfg(windows)]
fn authorize_druid(path: &PathBuf) -> bool {
    // Attach a Mark-of-the-Web (Zone.Identifier ADS) so the shell shows the
    // SmartScreen/SAC dialog instead of silently allowing or blocking.
    let ads = format!("{}:Zone.Identifier", path.display());
    let _ = fs::write(&ads, b"[ZoneTransfer]\r\nZoneId=3\r\n");

    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::TerminateProcess;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let file: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.nShow = SW_HIDE;

    unsafe {
        // ShellExecuteExW blocks on the SmartScreen/SAC dialog. If the user allows
        // it, the node starts and we get a handle back; kill it right away. A null
        // handle means "Don't run" / blocked — report that so we retry next launch.
        if ShellExecuteExW(&mut info) != 0 && !info.hProcess.is_null() {
            TerminateProcess(info.hProcess, 0);
            CloseHandle(info.hProcess);
            true
        } else {
            false
        }
    }
}

// ── Druid management ──────────────────────────────────────────────────────
/// Append a log line to the capped ring buffer used for crash-dialog context.
fn push_recent(buf: &Arc<Mutex<std::collections::VecDeque<String>>>, line: &str) {
    if let Ok(mut q) = buf.lock() {
        if q.len() >= 30 { q.pop_front(); }
        q.push_back(line.to_string());
    }
}

#[tauri::command]
async fn start_druid(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let guard = state.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() { return Err("Druid is already running".into()); }
    }

    use tokio::io::{AsyncBufReadExt, BufReader};

    // Fresh run: clear the "we stopped it" flag so a crash this time is reported.
    state.user_stopped.store(false, Ordering::SeqCst);

    let mut cmd = tokio::process::Command::new(&state.druid_path);
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    #[cfg(windows)] cmd.creation_flags(NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| {
        format!("Could not start the druid node.\n\n{e}\n\nThe binary may be blocked by Windows (Smart App Control / SmartScreen) or missing.")
    })?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    let _ = app.emit("druid-status", StatusPayload { status: "running".into() });

    // Ring buffer of the most recent log lines from BOTH streams. druid may print
    // a fatal error to either stdout or stderr, so we keep both — that's exactly
    // what the user sees in the Logs page — and use it as the error dialog detail.
    let recent: Arc<Mutex<std::collections::VecDeque<String>>> =
        Arc::new(Mutex::new(std::collections::VecDeque::new()));

    // Stream stdout
    let app_out = app.clone();
    let recent_out = recent.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_recent(&recent_out, &line);
            let _ = app_out.emit("druid-log", LogPayload { line, stream: "stdout".into() });
        }
    });

    // Stream stderr; detect exit when the pipe closes.
    let app_err = app.clone();
    let child_ref = state.child.clone();
    let user_stopped = state.user_stopped.clone();
    let recent_err = recent.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_recent(&recent_err, &line);
            let _ = app_err.emit("druid-log", LogPayload { line, stream: "stderr".into() });
        }
        // The pipe closed => the process has exited.
        let _ = app_err.emit("druid-status", StatusPayload { status: "stopped".into() });
        if let Ok(mut g) = child_ref.lock() { *g = None; }

        // If we didn't stop it ourselves, the node crashed/failed to stay up —
        // surface it with the last lines it logged (from either stream).
        if !user_stopped.load(Ordering::SeqCst) {
            let detail = recent_err
                .lock()
                .map(|q| q.iter().cloned().collect::<Vec<_>>().join("\n"))
                .unwrap_or_default();
            let _ = app_err.emit("druid-error", ErrorPayload {
                message: "Druid stopped unexpectedly. It may have failed to start or crashed.".into(),
                detail,
            });
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_druid(state: State<'_, AppState>) -> Result<(), String> {
    // Mark this as a deliberate stop so the exit watcher doesn't raise an error.
    state.user_stopped.store(true, Ordering::SeqCst);
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    match guard.take() {
        Some(mut child) => child.start_kill().map_err(|e| format!("Failed to kill druid: {e}")),
        None => Err("Druid is not running".into()),
    }
}

#[tauri::command]
async fn restart_druid(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        // Deliberate kill; start_druid will clear the flag again for the new run.
        state.user_stopped.store(true, Ordering::SeqCst);
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.take() { let _ = child.start_kill(); }
    }
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    start_druid(app, state).await
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> String {
    match state.child.lock() {
        Ok(g) => if g.is_some() { "running".into() } else { "stopped".into() },
        Err(_) => "stopped".into(),
    }
}

// ── Faucet ────────────────────────────────────────────────────────────────
#[tauri::command]
async fn fund(address: String, amount: u64) -> Result<(), String> {
    let form = reqwest::multipart::Form::new()
        .text("address", address)
        .text("amount", amount.to_string());

    let res = reqwest::Client::new()
        .post("http://localhost:8545/faucet/api")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        Err(body["Error"].as_str().unwrap_or("Request failed").to_string())
    }
}

// ── Contract scanning ─────────────────────────────────────────────────────
#[derive(Serialize, Clone)]
struct ConstructorArg { name: String, arg_type: String }

#[derive(Serialize, Clone)]
struct ContractEntry {
    name: String,
    kind: String,
    constructor_args: Vec<ConstructorArg>,
}

#[derive(Serialize, Clone)]
struct SolFile { filename: String, path: String, contracts: Vec<ContractEntry> }

#[tauri::command]
fn scan_contracts(folder: String) -> Result<Vec<SolFile>, String> {
    let mut results = Vec::new();
    for path in collect_sol_files(std::path::Path::new(&folder)) {
        let source = fs::read_to_string(&path).unwrap_or_default();
        results.push(SolFile {
            filename: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
            path: path.to_string_lossy().to_string(),
            contracts: parse_contracts(&source),
        });
    }
    Ok(results)
}

fn parse_contracts(source: &str) -> Vec<ContractEntry> {
    const KINDS: &[&str] = &["abstract contract", "interface", "library", "contract"];
    let mut out: Vec<ContractEntry> = Vec::new();
    let mut contract_stack: Vec<(usize, i32)> = Vec::new();
    let mut brace_depth: i32 = 0;

    for line in source.lines() {
        let t = line.trim();
        if t.starts_with("//") || t.starts_with("*") || t.starts_with("/*") { continue; }

        let mut found_decl = false;
        for &kind in KINDS {
            if let Some(rest) = t.strip_prefix(kind) {
                if rest.starts_with(|c: char| c.is_whitespace()) {
                    let name: String = rest.trim_start().chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                    if !name.is_empty() {
                        let idx = out.len();
                        out.push(ContractEntry { kind: kind.to_string(), name, constructor_args: Vec::new() });
                        contract_stack.push((idx, brace_depth + 1));
                        found_decl = true;
                        break;
                    }
                }
            }
        }

        if !found_decl {
            if let Some(current_idx) = contract_stack.last().map(|(i, _)| *i) {
                if let Some(pos) = t.find("constructor") {
                    let after = t[pos + "constructor".len()..].trim_start();
                    if after.starts_with('(') {
                        out[current_idx].constructor_args = parse_param_list(&collect_paren_content(after));
                    }
                }
            }
        }

        for ch in t.chars() {
            match ch {
                '{' => {
                    brace_depth += 1;
                }
                '}' => {
                    brace_depth -= 1;
                    while let Some(&(_, entered_at)) = contract_stack.last() {
                        if brace_depth < entered_at { contract_stack.pop(); } else { break; }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn collect_paren_content(s: &str) -> String {
    let mut depth = 0i32;
    let mut result = String::new();
    for ch in s.chars() {
        match ch {
            '(' => { depth += 1; if depth > 1 { result.push(ch); } }
            ')' => { depth -= 1; if depth == 0 { break; } result.push(ch); }
            _ => { if depth > 0 { result.push(ch); } }
        }
    }
    result
}

fn parse_param_list(params: &str) -> Vec<ConstructorArg> {
    let params = params.trim();
    if params.is_empty() { return Vec::new(); }
    let mut out = Vec::new();
    for part in params.split(',') {
        let part = part.trim();
        if part.is_empty() { continue; }
        let tokens: Vec<&str> = part.split_whitespace().collect();
        if tokens.len() >= 2 {
            let name = tokens.last().unwrap_or(&"").to_string();
            let type_tokens: Vec<&str> = tokens[..tokens.len()-1].iter()
                .filter(|&&t| !matches!(t, "memory" | "storage" | "calldata" | "payable"))
                .copied().collect();
            let arg_type = type_tokens.join(" ");
            if !name.is_empty() && !arg_type.is_empty() {
                out.push(ConstructorArg { name, arg_type });
            }
        } else if tokens.len() == 1 {
            out.push(ConstructorArg { name: String::new(), arg_type: tokens[0].to_string() });
        }
    }
    out
}

fn collect_sol_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return files };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() { files.extend(collect_sol_files(&path)); }
        else if path.extension().and_then(|e| e.to_str()) == Some("sol") { files.push(path); }
    }
    files
}

// ── File I/O ──────────────────────────────────────────────────────────────
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

// ── Solidity compilation via embedded solc ────────────────────────────────
#[derive(Serialize, Clone)]
struct CompiledContract { abi: String, bytecode: String }

#[tauri::command]
async fn compile_contract(
    state: State<'_, AppState>,
    sources: HashMap<String, String>,
    contract_name: String,
) -> Result<CompiledContract, String> {
    let sources_json: serde_json::Map<String, serde_json::Value> = sources.iter()
        .map(|(k, v)| (k.clone(), serde_json::json!({ "content": v })))
        .collect();

    let input = serde_json::json!({
        "language": "Solidity",
        "sources": sources_json,
        "settings": { "outputSelection": { "*": { "*": ["abi", "evm.bytecode.object"] } } }
    });

    let input_str = serde_json::to_string(&input).map_err(|e| e.to_string())?;

    let tmp = std::env::temp_dir().join("cleric_solc_input.json");
    fs::write(&tmp, &input_str).map_err(|e| e.to_string())?;
    let stdin_file = fs::File::open(&tmp).map_err(|e| e.to_string())?;

    let mut cmd = std::process::Command::new(&state.solc_path);
    cmd.arg("--standard-json").stdin(stdin_file);
    #[cfg(windows)] cmd.creation_flags(NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("failed to run solc: {e}"))?;

    let _ = fs::remove_file(&tmp);

    let stdout = String::from_utf8_lossy(&out.stdout);
    if stdout.is_empty() {
        return Err(format!("solc produced no output: {}", String::from_utf8_lossy(&out.stderr)));
    }

    let result: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("bad solc output: {e}"))?;

    let errors: Vec<String> = result["errors"].as_array().unwrap_or(&vec![]).iter()
        .filter(|e| e["severity"].as_str() == Some("error"))
        .map(|e| e["formattedMessage"].as_str().unwrap_or("unknown error").to_string())
        .collect();

    if !errors.is_empty() { return Err(errors.join("\n").trim().to_string()); }

    let contracts = result["contracts"].as_object().ok_or("no contracts in solc output")?;
    for file_contracts in contracts.values() {
        if let Some(contract) = file_contracts.get(&contract_name) {
            let abi = serde_json::to_string(&contract["abi"]).map_err(|e| e.to_string())?;
            let bytecode = contract["evm"]["bytecode"]["object"].as_str().unwrap_or("").to_string();
            if bytecode.is_empty() {
                return Err(format!("empty bytecode for '{contract_name}' — abstract or interface?"));
            }
            return Ok(CompiledContract { abi, bytecode });
        }
    }

    Err(format!("contract '{contract_name}' not found in compilation output"))
}

// ── Entry point ───────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Extract embedded binaries to the per-user app data directory.
            // This runs on every launch but only writes when the file is new/changed.
            let bin_dir = app.path().app_local_data_dir()?.join("bin");
            fs::create_dir_all(&bin_dir)?;

            let druid_path = bin_dir.join(DRUID_EXE);
            let solc_path  = bin_dir.join(SOLC_EXE);

            let druid_written = extract_binary(&druid_path, DRUID_BIN)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            extract_binary(&solc_path, SOLC_BIN)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            // Surface the OS allow prompt for druid until the user accepts it once,
            // so later CreateProcess spawns run unprompted. We keep retrying across
            // launches (not just on first extract) because a "Don't run" leaves the
            // binary unauthorized — gating only on a fresh write would strand the
            // user with no way to get the dialog back. A marker records success,
            // keyed to the binary's size so a new druid build re-triggers it.
            // (solc is widely trusted by reputation and needs no such step.)
            #[cfg(windows)]
            {
                let marker = bin_dir.join(".druid-authorized");
                let expected = DRUID_BIN.len().to_string();
                let authorized = fs::read_to_string(&marker)
                    .map(|s| s.trim() == expected)
                    .unwrap_or(false);
                if (druid_written || !authorized) && authorize_druid(&druid_path) {
                    let _ = fs::write(&marker, &expected);
                }
            }
            #[cfg(not(windows))]
            let _ = druid_written;

            app.manage(AppState {
                child: Arc::new(Mutex::new(None)),
                druid_path,
                solc_path,
                user_stopped: Arc::new(AtomicBool::new(false)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_druid,
            stop_druid,
            restart_druid,
            get_status,
            fund,
            scan_contracts,
            compile_contract,
            read_file,
            write_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.user_stopped.store(true, Ordering::SeqCst);
                let mut guard = match state.child.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };
                if let Some(mut child) = guard.take() {
                    let _ = child.start_kill();
                }
            }
        });
}
