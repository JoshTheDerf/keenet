//! KeeNet desktop (Tauri) backend.
//!
//! A faithful port of the former `electron/main.cjs`: it exposes the exact same
//! native surface the renderer expects on `window.keeweb`, implemented here as
//! Tauri commands and re-assembled JS-side by `src/desktop/tauri-bridge.ts`.
//!
//! Security model carried over from the Electron build:
//!   * The renderer may only read/write paths the USER granted through a native
//!     dialog (`file_open` / `file_save_dialog`). Grants persist so previously
//!     used .kdbx files reopen at startup without re-prompting, but the renderer
//!     can never mint a grant for an arbitrary path.
//!   * Small secrets (OAuth tokens, WebDAV password) live in the OS keychain
//!     (Keychain / Credential Manager / Secret Service). When no keychain is
//!     available (headless Linux), they fall back to a base64-obfuscated file in
//!     the app data dir — NOT encryption, matching the old safeStorage fallback.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const KEYRING_SERVICE: &str = "KeeNet";
const MAX_PERSISTED_GRANTS: usize = 100;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

struct AppState {
    /// Resolved absolute paths the renderer may read/write.
    grants: Mutex<HashSet<PathBuf>>,
    /// App data dir (grants + secret fallback live here).
    data_dir: PathBuf,
}

// ---------------------------------------------------------------------------
// IPC payload types (shapes mirror src/types/desktop.d.ts)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct FileInfo {
    path: String,
    name: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
struct AutoTypeOp {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    key: Option<String>,
    ms: Option<u64>,
}

#[derive(Deserialize)]
struct OauthReq {
    #[serde(rename = "authUrl")]
    auth_url: String,
    #[serde(rename = "redirectUri")]
    redirect_uri: String,
    // Passed through to the renderer, which validates it; unused here.
    #[allow(dead_code)]
    state: Option<String>,
}

#[derive(Serialize, Default, Clone)]
struct OauthResult {
    code: Option<String>,
    error: Option<String>,
    state: Option<String>,
}

// ---------------------------------------------------------------------------
// Path grants
// ---------------------------------------------------------------------------

fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn grants_file(dir: &Path) -> PathBuf {
    dir.join("granted-paths.json")
}

fn load_grants(dir: &Path, set: &mut HashSet<PathBuf>) {
    if let Ok(raw) = std::fs::read_to_string(grants_file(dir)) {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(&raw) {
            for p in list {
                let pb = PathBuf::from(p);
                if pb.is_absolute() {
                    set.insert(canon(&pb));
                }
            }
        }
    }
}

fn persist_grants(state: &AppState) {
    let list: Vec<String> = {
        let guard = state.grants.lock().unwrap();
        guard
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .take(MAX_PERSISTED_GRANTS)
            .collect()
    };
    let _ = std::fs::write(
        grants_file(&state.data_dir),
        serde_json::to_string(&list).unwrap_or_default(),
    );
}

/// Record that the user granted access to `path` via a native dialog.
fn grant(state: &AppState, path: &Path) {
    {
        let mut g = state.grants.lock().unwrap();
        g.insert(canon(path));
    }
    persist_grants(state);
}

/// Resolve `path` iff it was granted via a dialog (this run or a prior one).
fn assert_granted(state: &AppState, path: &str) -> Result<PathBuf, String> {
    let resolved = canon(Path::new(path));
    let g = state.grants.lock().unwrap();
    if g.contains(&resolved) {
        Ok(resolved)
    } else {
        Err(format!(
            "Access denied: {} was not granted via a file dialog",
            resolved.display()
        ))
    }
}

// ---------------------------------------------------------------------------
// Secret storage (OS keychain with base64-file fallback)
// ---------------------------------------------------------------------------

fn fallback_file(dir: &Path) -> PathBuf {
    dir.join("secrets-fallback.json")
}

fn fallback_load(dir: &Path) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(fallback_file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn fallback_save(dir: &Path, map: &serde_json::Map<String, serde_json::Value>) {
    let _ = std::fs::write(
        fallback_file(dir),
        serde_json::to_string(map).unwrap_or_default(),
    );
}

fn secret_get_impl(state: &AppState, key: &str) -> Option<String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, key) {
        match entry.get_password() {
            Ok(v) => return Some(v),
            // Genuinely absent in the keychain — but a prior headless run may
            // have written it to the fallback file, so fall through.
            Err(keyring::Error::NoEntry) => {}
            // Backend unavailable — use the fallback.
            Err(_) => {}
        }
    }
    let map = fallback_load(&state.data_dir);
    map.get(key)
        .and_then(|v| v.as_str())
        .and_then(b64_decode)
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn secret_set_impl(state: &AppState, key: &str, value: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, key) {
        if entry.set_password(value).is_ok() {
            // Drop any stale fallback copy so reads are unambiguous.
            let mut map = fallback_load(&state.data_dir);
            if map.remove(key).is_some() {
                fallback_save(&state.data_dir, &map);
            }
            return;
        }
    }
    let mut map = fallback_load(&state.data_dir);
    map.insert(
        key.to_string(),
        serde_json::Value::String(b64_encode(value.as_bytes())),
    );
    fallback_save(&state.data_dir, &map);
}

fn secret_delete_impl(state: &AppState, key: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, key) {
        let _ = entry.delete_credential();
    }
    let mut map = fallback_load(&state.data_dir);
    if map.remove(key).is_some() {
        fallback_save(&state.data_dir, &map);
    }
}

// Minimal base64 (standard alphabet, padded) — avoids pulling a crate for the
// obfuscation-only fallback path.
fn b64_encode(input: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(A[((n >> 18) & 63) as usize] as char);
        out.push(A[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            A[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            A[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = s
        .bytes()
        .filter(|&c| c != b'=' && !c.is_ascii_whitespace())
        .collect();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let mut n = 0u32;
        let mut cnt = 0u32;
        for &c in chunk {
            n = (n << 6) | val(c)?;
            cnt += 1;
        }
        n <<= 6 * (4 - cnt);
        if cnt >= 2 {
            out.push((n >> 16) as u8);
        }
        if cnt >= 3 {
            out.push((n >> 8) as u8);
        }
        if cnt >= 4 {
            out.push(n as u8);
        }
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// Auto-type
// ---------------------------------------------------------------------------

fn map_key(k: &str) -> Option<enigo::Key> {
    use enigo::Key;
    Some(match k.to_ascii_uppercase().as_str() {
        "TAB" => Key::Tab,
        "ENTER" => Key::Return,
        "SPACE" => Key::Space,
        "UP" => Key::UpArrow,
        "DOWN" => Key::DownArrow,
        "LEFT" => Key::LeftArrow,
        "RIGHT" => Key::RightArrow,
        "HOME" => Key::Home,
        "END" => Key::End,
        "DELETE" => Key::Delete,
        "BACKSPACE" => Key::Backspace,
        "ESC" | "ESCAPE" => Key::Escape,
        "PGUP" => Key::PageUp,
        "PGDN" => Key::PageDown,
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn file_open(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<FileInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Open KeePass database")
        .add_filter("KeePass database", &["kdbx"])
        .add_filter("All files", &["*"])
        .blocking_pick_file();
    let Some(fp) = picked else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    grant(&state, &path);
    Ok(Some(FileInfo {
        path: path.to_string_lossy().to_string(),
        name,
        data,
    }))
}

#[tauri::command]
fn file_read(state: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    let p = assert_granted(&state, &path)?;
    std::fs::read(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_write(state: State<'_, AppState>, path: String, data: Vec<u8>) -> Result<(), String> {
    let p = assert_granted(&state, &path)?;
    std::fs::write(p, &data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_save_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    suggested_name: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Save KeePass database")
        .set_file_name(&suggested_name)
        .add_filter("KeePass database", &["kdbx"])
        .blocking_save_file();
    let Some(fp) = picked else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    grant(&state, &path);
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn clipboard_copy(
    app: AppHandle,
    text: String,
    clear_after_ms: Option<u64>,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text.clone())
        .map_err(|e| e.to_string())?;
    if let Some(ms) = clear_after_ms {
        if ms > 0 {
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                // Only clear if the clipboard still holds what we wrote.
                if let Ok(cur) = handle.clipboard().read_text() {
                    if cur == text {
                        let _ = handle.clipboard().write_text(String::new());
                    }
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn autotype_available() -> bool {
    enigo::Enigo::new(&enigo::Settings::default()).is_ok()
}

#[tauri::command]
fn autotype_run(ops: Vec<AutoTypeOp>) -> Result<(), String> {
    use enigo::{Direction::Click, Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    // Give the previously focused window a moment to regain focus.
    std::thread::sleep(std::time::Duration::from_millis(200));
    for op in ops {
        match op.kind.as_str() {
            "text" => {
                if let Some(t) = op.text {
                    enigo.text(&t).map_err(|e| e.to_string())?;
                }
            }
            "key" => {
                if let Some(k) = op.key {
                    if let Some(key) = map_key(&k) {
                        enigo.key(key, Click).map_err(|e| e.to_string())?;
                    }
                }
            }
            "delay" => {
                if let Some(ms) = op.ms {
                    std::thread::sleep(std::time::Duration::from_millis(ms));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
fn secret_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    Ok(secret_get_impl(&state, &key))
}

#[tauri::command]
fn secret_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    secret_set_impl(&state, &key, &value);
    Ok(())
}

#[tauri::command]
fn secret_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    secret_delete_impl(&state, &key);
    Ok(())
}

#[tauri::command]
fn window_minimize_to_tray(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn window_toggle(app: AppHandle) {
    toggle_window(&app);
}

#[tauri::command]
async fn oauth_authorize(app: AppHandle, req: OauthReq) -> Result<OauthResult, String> {
    let auth_url: tauri::Url = req.auth_url.parse().map_err(|_| "invalid_request".to_string())?;
    let redirect = req.redirect_uri.clone();

    // Close any stale sign-in window first.
    if let Some(w) = app.get_webview_window("oauth") {
        let _ = w.close();
    }

    let (tx, rx) = std::sync::mpsc::channel::<OauthResult>();
    let nav_tx = tx.clone();
    let nav_redirect = redirect.clone();

    let win = WebviewWindowBuilder::new(&app, "oauth", WebviewUrl::External(auth_url))
        .title("Sign in")
        .inner_size(600.0, 720.0)
        .focused(true)
        .on_navigation(move |url| {
            let s = url.as_str();
            if s.starts_with(&nav_redirect) {
                // The redirect target (e.g. https://localhost/…) has nothing to
                // load — capture the code off the URL and block navigation.
                let _ = nav_tx.send(parse_redirect(s));
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    // If the user closes the window before completing, resolve as cancelled.
    let close_tx = tx.clone();
    win.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            let _ = close_tx.send(OauthResult {
                error: Some("cancelled".into()),
                ..Default::default()
            });
        }
    });

    // Wait (off the main thread) for whichever handler fires first.
    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv().unwrap_or(OauthResult {
            error: Some("cancelled".into()),
            code: None,
            state: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(w) = app.get_webview_window("oauth") {
        let _ = w.close();
    }
    Ok(result)
}

fn parse_redirect(u: &str) -> OauthResult {
    let mut res = OauthResult::default();
    if let Ok(parsed) = tauri::Url::parse(u) {
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => res.code = Some(v.into_owned()),
                "error" => res.error = Some(v.into_owned()),
                "state" => res.state = Some(v.into_owned()),
                _ => {}
            }
        }
        // Some providers return the params in the URL fragment instead.
        if let Some(frag) = parsed.fragment() {
            for pair in frag.split('&') {
                let mut it = pair.splitn(2, '=');
                if let (Some(k), Some(v)) = (it.next(), it.next()) {
                    match k {
                        "code" if res.code.is_none() => res.code = Some(v.to_string()),
                        "error" if res.error.is_none() => res.error = Some(v.to_string()),
                        "state" if res.state.is_none() => res.state = Some(v.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }
    res
}

// ---------------------------------------------------------------------------
// Window / tray / menu / shortcuts
// ---------------------------------------------------------------------------

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = w.hide();
        } else {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn emit_to_main(app: &AppHandle, event: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit(event, ());
    }
}

fn toggle_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let m = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let m = Modifiers::CONTROL | Modifiers::SHIFT;
    Shortcut::new(Some(m), Code::KeyK)
}

fn autotype_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let m = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let m = Modifiers::CONTROL | Modifiers::SHIFT;
    Shortcut::new(Some(m), Code::KeyA)
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let is_mac = cfg!(target_os = "macos");
    let mut mb = MenuBuilder::new(app);

    if is_mac {
        let app_menu = SubmenuBuilder::new(app, "KeeNet")
            .about(None)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        mb = mb.item(&app_menu);
    }

    let file = {
        let b = SubmenuBuilder::new(app, "File")
            .item(&MenuItemBuilder::with_id("open", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
            .item(&MenuItemBuilder::with_id("new", "New").accelerator("CmdOrCtrl+N").build(app)?)
            .item(&MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
            .separator()
            .item(&MenuItemBuilder::with_id("lock", "Lock").accelerator("CmdOrCtrl+L").build(app)?)
            .separator();
        if is_mac { b.close_window() } else { b.quit() }.build()?
    };

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("generate", "Generate Password…")
                .accelerator("CmdOrCtrl+G")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    mb = mb.item(&file).item(&edit).item(&view).item(&window);
    mb.build()
}

/// Menu clicks are forwarded to the renderer as `menu-action` (parity with the
/// Electron build). Predefined items (quit/copy/…) are handled natively.
fn on_menu_event(app: &AppHandle, id: &str) {
    if matches!(id, "open" | "new" | "save" | "lock" | "generate" | "settings") {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("menu-action", id);
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray_show", "Show / Hide").build(app)?;
    let lock = MenuItemBuilder::with_id("tray_lock", "Lock").build(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&lock)
        .separator()
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("KeeNet")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => toggle_window(app),
            "tray_lock" => emit_to_main(app, "lock"),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        // Focus the existing window instead of launching a second instance.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            toggle_window_show(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &toggle_shortcut() {
                        toggle_window(app);
                    } else if shortcut == &autotype_shortcut() {
                        emit_to_main(app, "auto-type-request");
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            // App data dir + persisted grants.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&data_dir);
            let mut grants = HashSet::new();
            load_grants(&data_dir, &mut grants);
            app.manage(AppState {
                grants: Mutex::new(grants),
                data_dir,
            });

            // Menu + tray.
            let menu = build_app_menu(&handle)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()));
            build_tray(&handle)?;

            // Global shortcuts.
            let gs = handle.global_shortcut();
            let _ = gs.register(toggle_shortcut());
            let _ = gs.register(autotype_shortcut());

            // Close-to-tray: hide the main window instead of quitting.
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_open,
            file_read,
            file_write,
            file_save_dialog,
            clipboard_copy,
            autotype_available,
            autotype_run,
            secret_get,
            secret_set,
            secret_delete,
            window_minimize_to_tray,
            window_toggle,
            oauth_authorize
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_window_show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
