mod files;
mod git;
mod ignore_rules;
mod launch;
mod lsp;
mod menu;
mod search;
mod settings;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(watcher::WorkspaceWatcher::default())
        .manage(launch::PendingFolder::default())
        .manage(lsp::LanguageServers::default())
        .manage(settings::SettingsWatcher::default())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                lsp::stop_all(tauri::Manager::app_handle(webview));
            }
        })
        .setup(|app| {
            menu::install(app)?;
            settings::start_watching(app.handle());
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
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            git::git_status,
            git::git_head_text,
            search::search_workspace,
            settings::settings_paths,
            settings::read_settings,
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
