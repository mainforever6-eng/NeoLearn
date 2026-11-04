fn main() {
    // При кросс-сборке (например, Android) proc-macro tauri-codegen определяет
    // целевой платформы через TAURI_ENV_TARGET_TRIPLE. Tauri CLI обычно задаёт
    // её сам, но при прямом `cargo build --target ...` переменной нет — из-за
    // этого кодогенератор считает целью macOS и вставляет embed_plist.
    if std::env::var_os("TAURI_ENV_TARGET_TRIPLE").is_none() {
        if let Ok(target) = std::env::var("TARGET") {
            println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE={target}");
        }
    }

    // Генерирует tauri.settings.gradle и app/tauri.build.gradle.kts,
    // на которые ссылается Android-проект в gen/android.
    tauri_build::build()
}
