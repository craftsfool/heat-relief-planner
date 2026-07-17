import { useEffect, useLayoutEffect, useRef, useState } from "react";

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export function useFloatingPanel({ active, minWidth = 220, minHeight = 140 }) {
  const panelRef = useRef(null);
  const operationRef = useRef(null);
  const [frame, setFrame] = useState({ x: null, y: null, width: null, height: null });

  const startOperation = (type) => (event) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    const boundary = panel?.offsetParent;
    if (!panel || !boundary) return;

    const panelRect = panel.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const start = {
      type,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: panelRect.left - boundaryRect.left,
      y: panelRect.top - boundaryRect.top,
      width: panelRect.width,
      height: panelRect.height,
      boundaryWidth: boundaryRect.width,
      boundaryHeight: boundaryRect.height,
    };
    operationRef.current = start;
    setFrame({ x: start.x, y: start.y, width: start.width, height: start.height });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const updateOperation = (event) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - operation.clientX;
    const deltaY = event.clientY - operation.clientY;

    if (operation.type === "drag") {
      setFrame({
        x: clamp(operation.x + deltaX, 4, Math.max(4, operation.boundaryWidth - operation.width - 4)),
        y: clamp(operation.y + deltaY, 4, Math.max(4, operation.boundaryHeight - operation.height - 4)),
        width: operation.width,
        height: operation.height,
      });
      return;
    }

    const maximumWidth = Math.max(140, operation.boundaryWidth - operation.x - 4);
    const maximumHeight = Math.max(100, operation.boundaryHeight - operation.y - 4);
    const minimumWidth = Math.min(minWidth, maximumWidth);
    const minimumHeight = Math.min(minHeight, maximumHeight);
    setFrame({
      x: operation.x,
      y: operation.y,
      width: clamp(operation.width + deltaX, minimumWidth, maximumWidth),
      height: clamp(operation.height + deltaY, minimumHeight, maximumHeight),
    });
  };

  const endOperation = (event) => {
    if (operationRef.current?.pointerId !== event.pointerId) return;
    operationRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    window.addEventListener("pointermove", updateOperation);
    window.addEventListener("pointerup", endOperation);
    window.addEventListener("pointercancel", endOperation);
    return () => {
      window.removeEventListener("pointermove", updateOperation);
      window.removeEventListener("pointerup", endOperation);
      window.removeEventListener("pointercancel", endOperation);
    };
  }, [minHeight, minWidth]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const boundary = panel?.offsetParent;
    if (!active || !panel || !boundary || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      const boundaryRect = boundary.getBoundingClientRect();
      setFrame((current) => {
        if (current.x === null) return current;
        const width = Math.min(current.width, Math.max(140, boundaryRect.width - 8));
        const height = Math.min(current.height, Math.max(100, boundaryRect.height - 8));
        return {
          x: clamp(current.x, 4, Math.max(4, boundaryRect.width - width - 4)),
          y: clamp(current.y, 4, Math.max(4, boundaryRect.height - height - 4)),
          width,
          height,
        };
      });
    });
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [active]);

  const style = frame.x === null ? undefined : {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    right: "auto",
    bottom: "auto",
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  };

  return {
    panelRef,
    style,
    hasCustomFrame: frame.x !== null,
    dragHandleProps: {
      onPointerDown: startOperation("drag"),
      onPointerCancel: endOperation,
    },
    resizeHandleProps: {
      onPointerDown: startOperation("resize"),
      onPointerCancel: endOperation,
    },
  };
}
