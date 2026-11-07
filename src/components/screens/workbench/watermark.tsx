const SHORTCUTS = [
  ["Open Folder", "⌘", "O"],
  ["Save", "⌘", "S"],
  ["Close Editor", "⌘", "W"],
  ["Toggle Side Bar", "⌘", "B"],
];

export function Watermark() {
  return (
    <div className="wb-watermark">
      <dl>
        {SHORTCUTS.map(([label, ...keys]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
