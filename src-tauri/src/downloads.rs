//! Сохранение пользовательских файлов в общедоступные папки.
//!
//! На Android нельзя писать напрямую в общую папку «Загрузки»: с Android 10
//! действует scoped storage. Поэтому файл передаётся нативному плагину,
//! который кладёт его в `Downloads/NeoLang` через MediaStore.
//!
//! На iOS общедоступная папка приложения — это его `Documents`. Чтобы она была
//! видна в приложении «Файлы», в `src-tauri/Info.plist` включён общий доступ
//! к документам (`UIFileSharingEnabled`).

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    file_name: String,
    mime_type: String,
    data: Vec<u8>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct SaveResponse {
    path: String,
}

#[cfg(target_os = "android")]
pub struct Downloads<R: tauri::Runtime = tauri::Wry>(PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: tauri::Runtime> Downloads<R> {
    /// Сохраняет файл в общую папку «Загрузки» на Android.
    pub async fn save(&self, file_name: String, data: Vec<u8>) -> Result<String, String> {
        let response: SaveResponse = self
            .0
            .run_mobile_plugin_async(
                "save",
                SaveRequest {
                    file_name,
                    mime_type: "application/pdf".to_string(),
                    data,
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(response.path)
    }
}

/// Плагин нужен только на Android. На остальных платформах он пустой, чтобы
/// регистрация в `lib.rs` оставалась общей для всех целей сборки.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    #[allow(unused_mut)]
    let mut builder = tauri::plugin::Builder::new("downloads");

    #[cfg(target_os = "android")]
    {
        builder = builder.setup(|app, api| {
            let handle = api
                .register_android_plugin("com.max.neolang", "DownloadsPlugin")
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;
            app.manage(Downloads(handle));
            Ok(())
        });
    }

    builder.build()
}
