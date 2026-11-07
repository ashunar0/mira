mod files;
mod git;
mod ignore_rules;
mod menu;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(watcher::WorkspaceWatcher::default())
        .setup(|app| {
            menu::install(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::read_directory,
            files::list_workspace_files,
            files::read_text_file,
            files::write_text_file,
            files::create_file,
            files::create_directory,
            files::rename_path,
            files::trash_path,
            git::git_status,
            git::git_head_text,
            watcher::watch_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
