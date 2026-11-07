mod files;
mod menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            menu::install(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::read_directory,
            files::list_workspace_files,
            files::read_text_file,
            files::write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
