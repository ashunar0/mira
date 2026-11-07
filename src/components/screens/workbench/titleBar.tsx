type Props = {
  title: string;
  isSidebarVisible: boolean;
  onToggleSidebar: () => void;
};

export function TitleBar({ title, isSidebarVisible, onToggleSidebar }: Props) {
  return (
    <header className="wb-titlebar" data-tauri-drag-region>
      <div className="wb-titlebar-title" data-tauri-drag-region>
        {title}
      </div>
      <div className="wb-titlebar-actions">
        <button
          type="button"
          className="wb-icon-button"
          title="Toggle Primary Side Bar (⌘B)"
          aria-pressed={isSidebarVisible}
          onClick={onToggleSidebar}
        >
          <i
            className={`codicon codicon-layout-sidebar-left${isSidebarVisible ? "" : "-off"}`}
          />
        </button>
      </div>
    </header>
  );
}
