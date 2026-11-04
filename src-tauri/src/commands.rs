use crate::lessons;
use crate::{
    completed_lessons_from, normalize_accent, read_accent_from, set_completed_in, write_accent_to,
    INTRO_SEEN_KEY, SETTINGS_FILE,
};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub async fn greet(name: String) -> String {
    format!("Привет, {}! Добро пожаловать в NeoLang", name)
}

#[tauri::command]
pub fn has_seen_intro(app: tauri::AppHandle) -> Result<bool, String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get(INTRO_SEEN_KEY)
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
pub fn set_intro_seen(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(INTRO_SEEN_KEY, serde_json::Value::Bool(true));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_accent(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_accent_from(&app, SETTINGS_FILE)
}

#[tauri::command]
pub async fn set_accent(app: tauri::AppHandle, accent: String) -> Result<String, String> {
    let accent = normalize_accent(&accent)
        .ok_or_else(|| "Акцент должен быть «auto» или цветом в формате #RRGGBB".to_string())?;
    write_accent_to(&app, SETTINGS_FILE, &accent)?;
    Ok(accent)
}

#[tauri::command]
pub async fn get_completed_lessons(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    completed_lessons_from(&app, SETTINGS_FILE)
}

#[tauri::command]
pub async fn set_lesson_completed(
    app: tauri::AppHandle,
    course: String,
    id: u32,
    completed: bool,
) -> Result<Vec<String>, String> {
    let lesson = lessons::find_lesson(&course, id).ok_or_else(|| {
        format!(
            "Урок с id {id} не найден в курсе {}",
            lessons::course_title(&course)
        )
    })?;
    set_completed_in(&app, SETTINGS_FILE, &lesson.course, id, completed)
}

#[tauri::command]
pub async fn save_lesson_pdf(
    app: tauri::AppHandle,
    course: String,
    id: u32,
) -> Result<String, String> {
    let lesson = lessons::find_lesson(&course, id)
        .ok_or_else(|| format!("Урок с id {id} не найден в курсе {course}"))?;
    let bytes = crate::notes_pdf::pdf_for(&lesson)?;

    let file_name = pdf_file_name(course.as_str(), id);

    // На Android общедоступная папка «Загрузки» доступна только через
    // MediaStore — файл сохраняет нативный плагин.
    #[cfg(target_os = "android")]
    {
        let plugin = app.state::<crate::downloads::Downloads>();
        return plugin.save(file_name, bytes).await;
    }

    // На iOS папка Documents приложения видна в «Файлах» благодаря
    // UIFileSharingEnabled в Info.plist.
    #[cfg(target_os = "ios")]
    {
        let dir = app
            .path()
            .document_dir()
            .map_err(|e| format!("Не удалось определить папку «Документы»: {e}"))?
            .join("NeoLang");
        write_pdf_to(&dir, &file_name, &bytes)?;
        return Ok(format!("Документы/NeoLang/{file_name}"));
    }

    // На компьютере сохраняем в «Загрузки», а если её нет — в «Документы».
    #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
    {
        let dir = app
            .path()
            .download_dir()
            .or_else(|_| app.path().document_dir())
            .map_err(|e| format!("Не удалось определить папку для сохранения: {e}"))?;
        let file_path = write_pdf_to(&dir, &file_name, &bytes)?;
        return Ok(file_path.to_string_lossy().to_string());
    }

    #[allow(unreachable_code)]
    Err("Сохранение PDF не поддерживается на этой платформе".to_string())
}

fn pdf_file_name(course: &str, id: u32) -> String {
    let safe_course: String = course
        .replace('+', "plus")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{safe_course}-{id:02}.pdf")
}

#[cfg(not(target_os = "android"))]
fn write_pdf_to(
    dir: &std::path::Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<std::path::PathBuf, String> {
    use std::io::Write;

    std::fs::create_dir_all(dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let file_path = dir.join(file_name);
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("Не удалось создать файл: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("Не удалось записать PDF: {e}"))?;
    Ok(file_path)
}

