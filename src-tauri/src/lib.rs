mod files;
mod git;
mod ignore_rules;
mod launch;
mod menu;
mod search;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(watcher::WorkspaceWatcher::default())
        .manage(launch::PendingFolder::default())
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
            launch::take_pending_folder,
            git::git_status,
            git::git_head_text,
            search::search_workspace,
            watcher::watch_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                launch::handle_opened(app, &urls);
            }
        });
}
