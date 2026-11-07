use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter,
};

/// macOS の既定メニューは Cmd+W でウィンドウを閉じ、Cmd+Q は閉じる確認を通らずに終了する。
/// どちらも未保存の内容を失うので、自前の項目に置き換えてフロントエンドへ委ねる。
pub fn install(app: &App) -> tauri::Result<()> {
    let item = |id: &str, label: &str, accelerator: &str| {
        MenuItemBuilder::with_id(id, label)
            .accelerator(accelerator)
            .build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "mira")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit mira", "CmdOrCtrl+Q")?)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item("open-folder", "Open Folder...", "CmdOrCtrl+O")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .separator()
        .item(&item("close-tab", "Close Editor", "CmdOrCtrl+W")?)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item(
            "command-palette",
            "Command Palette...",
            "CmdOrCtrl+Shift+P",
        )?)
        .separator()
        .item(&item(
            "toggle-sidebar",
            "Toggle Primary Side Bar",
            "CmdOrCtrl+B",
        )?)
        .item(&item("toggle-diff", "Toggle Diff", "CmdOrCtrl+Shift+D")?)
        .item(&item("toggle-preview", "Toggle Markdown Preview", "CmdOrCtrl+Shift+V")?)
        .build()?;
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&item("quick-open", "Go to File...", "CmdOrCtrl+P")?)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &go_menu,
            &window_menu,
        ])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|handle, event| {
        // Undo などの標準項目は OS が処理する。自前の項目だけフロントエンドが解釈する。
        let _ = handle.emit("menu", event.id().as_ref());
    });
    Ok(())
}
