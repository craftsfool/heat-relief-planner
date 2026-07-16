import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const HOLD_MS = 700;

export function HoldActionButton({
  className = "",
  idleIcon: IdleIcon,
  holdIcon: HoldIcon,
  idleLabel,
  holdLabel,
  workingLabel,
  completeLabel,
  errorLabel,
  title,
  ariaLabel,
  onClick,
  onHold,
}) {
  const [state, setState] = useState("idle");
  const holdTimer = useRef(null);
  const feedbackTimer = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => () => {
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(feedbackTimer.current);
  }, []);

  const cancelHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setState((current) => current === "holding" ? "idle" : current);
  };

  const runHeldAction = async () => {
    setState("working");
    try {
      await onHold();
      setState("complete");
      feedbackTimer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      console.error(error);
      setState("error");
      feedbackTimer.current = window.setTimeout(() => setState("idle"), 2200);
    }
  };

  const startHold = (event) => {
    if (state === "working") return;
    window.clearTimeout(feedbackTimer.current);
    suppressClick.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setState("holding");
    holdTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      runHeldAction();
    }, HOLD_MS);
  };

  const handleClick = (event) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (event.shiftKey && state !== "working") {
      runHeldAction();
      return;
    }
    if (state !== "working") {
      window.clearTimeout(feedbackTimer.current);
      setState("idle");
      onClick();
    }
  };

  const cancelPointerHold = () => {
    cancelHold();
    suppressClick.current = false;
  };

  const label = state === "holding"
    ? holdLabel
    : state === "working"
      ? workingLabel
      : state === "complete"
        ? completeLabel
        : state === "error"
          ? errorLabel
          : idleLabel;
  const Icon = state === "holding"
    ? HoldIcon
    : state === "working"
      ? LoaderCircle
      : state === "complete"
        ? Check
        : IdleIcon;

  return (
    <button
      className={`icon-text-button hold-action-button ${className} is-${state}`}
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={state === "working"}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelPointerHold}
      onContextMenu={(event) => event.preventDefault()}
      onClick={handleClick}
    >
      <Icon className={state === "working" ? "spin" : ""} size={16} />
      {label}
    </button>
  );
}
