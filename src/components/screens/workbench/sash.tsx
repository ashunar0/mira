import type { PointerEvent } from "react";

type Props = {
  left: number;
  onResize: (clientX: number) => void;
  onReset: () => void;
};

export function Sash({ left, onResize, onReset }: Props) {
  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onResize(event.clientX);
  };
  return (
    <div
      className="wb-sash"
      style={{ left: left - 2 }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      // ドラッグでテキストの範囲選択が始まらないようにする
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={handleMove}
      onDoubleClick={onReset}
    />
  );
}
