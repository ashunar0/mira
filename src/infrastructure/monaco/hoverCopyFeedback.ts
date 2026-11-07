import "./hoverCopyFeedback.css";

const FEEDBACK_MS = 1500;
const COPY_BUTTON = ".hover-copy-button";
const resetTimers = new WeakMap<Element, number>();

function showCopied(button: Element) {
  button.classList.replace("codicon-copy", "codicon-check");
  button.setAttribute("data-copied", "");
  window.clearTimeout(resetTimers.get(button));
  resetTimers.set(
    button,
    window.setTimeout(() => {
      button.classList.replace("codicon-check", "codicon-copy");
      button.removeAttribute("data-copied");
    }, FEEDBACK_MS),
  );
}

/** Monaco のホバーのコピーボタンは押しても見た目が変わらず、差し替える API もないので外から補う */
export function installHoverCopyFeedback() {
  const handle = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    const button = event.target instanceof Element ? event.target.closest(COPY_BUTTON) : null;
    if (button) showCopied(button);
  };
  document.addEventListener("click", handle, true);
  document.addEventListener("keydown", handle, true);
}
