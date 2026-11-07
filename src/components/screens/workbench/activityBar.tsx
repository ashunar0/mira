export type SidebarView = "explorer" | "search";

const ITEMS: { view: SidebarView; title: string; icon: string }[] = [
  { view: "explorer", title: "Explorer", icon: "files" },
  { view: "search", title: "Search (⇧⌘F)", icon: "search" },
];

type Props = {
  active: SidebarView;
  onSelect: (view: SidebarView) => void;
};

/** サイドバー上端に横並びで置く（VS Code の workbench.activityBar.location: top） */
export function ActivityBar({ active, onSelect }: Props) {
  return (
    <nav className="wb-activitybar" aria-label="Activity Bar">
      {ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          className="wb-activity-item"
          data-active={item.view === active}
          title={item.title}
          aria-current={item.view === active ? "page" : undefined}
          onClick={() => onSelect(item.view)}
        >
          <i className={`codicon codicon-${item.icon}`} />
        </button>
      ))}
    </nav>
  );
}
