use serde_json::{json, Value};
use std::path::Path;
use tauri_plugin_store::StoreExt;

pub mod commands;
pub mod downloads;
pub mod lessons;
pub mod notes_pdf;

pub(crate) const SETTINGS_FILE: &str = "settings.json";
pub(crate) const INTRO_SEEN_KEY: &str = "has_seen_intro";
pub(crate) const ACCENT_KEY: &str = "accent_color";
pub(crate) const COMPLETED_KEY: &str = "completed_lessons";

pub(crate) fn normalize_accent(accent: &str) -> Option<String> {
    if accent.eq_ignore_ascii_case("auto") {
        return Some("auto".to_string());
    }
    let is_hex = accent.len() == 7
        && accent.starts_with('#')
        && accent[1..].chars().all(|c| c.is_ascii_hexdigit());
    is_hex.then(|| accent.to_ascii_lowercase())
}

pub(crate) fn read_accent_from<R: tauri::Runtime, P: AsRef<Path>>(
    app: &tauri::AppHandle<R>,
    file: P,
) -> Result<Option<String>, String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    Ok(store
        .get(ACCENT_KEY)
        .and_then(|v| v.as_str().map(str::to_string)))
}

pub(crate) fn write_accent_to<R: tauri::Runtime, P: AsRef<Path>>(
    app: &tauri::AppHandle<R>,
    file: P,
    accent: &str,
) -> Result<(), String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    store.set(ACCENT_KEY, json!(accent));
    store.save().map_err(|e| e.to_string())
}

pub(crate) fn completed_keys(map: &serde_json::Map<String, Value>) -> Vec<String> {
    let mut keys: Vec<String> = map
        .iter()
        .filter(|(_, done)| done.as_bool() == Some(true))
        .map(|(key, _)| key.clone())
        .collect();
    keys.sort();
    keys
}

pub(crate) fn toggle_completed(
    map: &mut serde_json::Map<String, Value>,
    course: &str,
    id: u32,
    completed: bool,
) -> Vec<String> {
    let key = format!("{course}:{id}");
    if completed {
        map.insert(key, Value::Bool(true));
    } else {
        map.remove(&key);
    }
    completed_keys(map)
}

pub(crate) fn completed_lessons_from<R: tauri::Runtime, P: AsRef<Path>>(
    app: &tauri::AppHandle<R>,
    file: P,
) -> Result<Vec<String>, String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    let map = store
        .get(COMPLETED_KEY)
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    Ok(completed_keys(&map))
}

pub(crate) fn set_completed_in<R: tauri::Runtime, P: AsRef<Path>>(
    app: &tauri::AppHandle<R>,
    file: P,
    course: &str,
    id: u32,
    completed: bool,
) -> Result<Vec<String>, String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    let mut map = store
        .get(COMPLETED_KEY)
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let keys = toggle_completed(&mut map, course, id, completed);
    store.set(COMPLETED_KEY, Value::Object(map));
    store.save().map_err(|e| e.to_string())?;
    Ok(keys)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_m3::init())
        .plugin(downloads::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::has_seen_intro,
            commands::set_intro_seen,
            commands::get_accent,
            commands::set_accent,
            commands::get_completed_lessons,
            commands::set_lesson_completed,
            lessons::get_lessons,
            lessons::get_lesson,
            lessons::search_lessons,
            lessons::get_lesson_notes,
            lessons::save_notes,
            commands::save_lesson_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_setting_is_validated() {
        assert_eq!(normalize_accent("auto"), Some("auto".to_string()));
        assert_eq!(normalize_accent("#2E7D32"), Some("#2e7d32".to_string()));
        assert_eq!(normalize_accent("green"), None);
        assert_eq!(normalize_accent("#12345"), None);
        assert_eq!(normalize_accent("#12345G"), None);
    }

    #[test]
    fn completed_lessons_persist_and_toggle() {
        let mut map = serde_json::Map::new();

        assert!(completed_keys(&map).is_empty());

        let keys = toggle_completed(&mut map, "rust", 1, true);
        assert_eq!(keys, vec!["rust:1"]);

        let keys = toggle_completed(&mut map, "c++", 14, true);
        assert_eq!(keys, vec!["c++:14", "rust:1"]);

        let keys = toggle_completed(&mut map, "rust", 1, false);
        assert_eq!(keys, vec!["c++:14"]);
        assert_eq!(completed_keys(&map), vec!["c++:14"]);
    }
}
