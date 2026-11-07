import "./quickInput.css";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type QuickInputItem = {
  id: string;
  label: string;
  labelMatches?: number[];
  description?: string;
  descriptionMatches?: number[];
  icon?: ReactNode;
  keybinding?: string[];
};

type Props = {
  value: string;
  placeholder: string;
  items: QuickInputItem[];
  emptyMessage: string | null;
  onValueChange: (value: string) => void;
  onSelect: (item: QuickInputItem) => void;
  onClose: () => void;
};

function Highlighted({ text, matches }: { text: string; matches?: number[] }) {
  if (!matches?.length) return text;
  const matched = new Set(matches);
  const chunks: { text: string; isMatch: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const isMatch = matched.has(i);
    const last = chunks[chunks.length - 1];
    if (last?.isMatch === isMatch) last.text += text[i];
    else chunks.push({ text: text[i], isMatch });
  }
  return chunks.map((chunk, index) =>
    chunk.isMatch ? (
      <span key={index} className="qi-match">
        {chunk.text}
      </span>
    ) : (
      chunk.text
    ),
  );
}

export function QuickInput(props: Props) {
  const { value, placeholder, items, emptyMessage, onValueChange, onSelect, onClose } = props;
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 開く前にフォーカスがあった場所へ、閉じるときに戻す
  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(value.length, value.length);
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
    // 開いた時に一度だけ
  }, []);

  const handleKeyDown = (event: KeyboardEvent) => {
    // 日本語入力の確定や候補選択のキーを、リストの操作として受け取らない
    if (event.nativeEvent.isComposing) return;
    const move = (delta: number) => {
      if (items.length > 0) setActiveIndex((activeIndex + delta + items.length) % items.length);
      event.preventDefault();
    };
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Enter":
        event.preventDefault();
        if (items[activeIndex]) onSelect(items[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  };

  return (
    <div className="qi-backdrop" onMouseDown={onClose}>
      <div
        className="qi-widget"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="qi-input"
          value={value}
          placeholder={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls="qi-list"
          aria-activedescendant={items[activeIndex] ? `qi-item-${activeIndex}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setActiveIndex(0);
            onValueChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        <div id="qi-list" className="qi-list" role="listbox">
          {items.map((item, index) => (
            <div
              key={item.id}
              id={`qi-item-${index}`}
              ref={
                index === activeIndex ? (row) => row?.scrollIntoView({ block: "nearest" }) : undefined
              }
              className="qi-row"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
            >
              {item.icon}
              <span className="qi-label">
                <Highlighted text={item.label} matches={item.labelMatches} />
              </span>
              {item.description && (
                <span className="qi-description">
                  <Highlighted text={item.description} matches={item.descriptionMatches} />
                </span>
              )}
              {item.keybinding && (
                <span className="qi-keybinding">
                  {item.keybinding.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
              )}
            </div>
          ))}
          {items.length === 0 && emptyMessage && <div className="qi-empty">{emptyMessage}</div>}
        </div>
      </div>
    </div>
  );
}
