/** サイドバー上端に横並びで置く（VS Code の workbench.activityBar.location: top） */
export function ActivityBar() {
  return (
    <nav className="wb-activitybar" aria-label="Activity Bar">
      <button
        type="button"
        className="wb-activity-item"
        data-active="true"
        title="Explorer"
        aria-current="page"
      >
        <i className="codicon codicon-files" />
      </button>
    </nav>
  );
}
