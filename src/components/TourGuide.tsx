import { useEffect, useMemo, useState } from "react";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
  learnMore?: string[];
}

interface TourGuideProps {
  run: boolean;
  steps: TourStep[];
  onComplete: () => void;
  onClose: () => void;
}

export function TourGuide({ run, steps, onComplete, onClose }: TourGuideProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [showMore, setShowMore] = useState(false);

  const step = useMemo(() => steps[index], [steps, index]);

  useEffect(() => {
    if (!run) {
      setIndex(0);
      setRect(null);
      setShowMore(false);
      return;
    }
    const updateRect = () => {
      const el = document.querySelector(step?.target) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      setRect(el.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [run, step]);

  useEffect(() => {
    if (!run) return;
    if (!step) {
      onComplete();
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      const next = index + 1;
      if (next >= steps.length) onComplete();
      else setIndex(next);
    }
  }, [run, step, index, steps, onComplete]);

  if (!run || !step || !rect) return null;

  const margin = 8;
  const top = rect.top - margin;
  const left = rect.left - margin;
  const width = rect.width + margin * 2;
  const height = rect.height + margin * 2;

  const tooltipStyle: React.CSSProperties = { position: "fixed", zIndex: 1002, maxWidth: 320 };
  const offset = 12;
  if (step.placement === "bottom") {
    tooltipStyle.top = top + height + offset;
    tooltipStyle.left = left;
  } else if (step.placement === "top") {
    tooltipStyle.top = Math.max(12, top - 160);
    tooltipStyle.left = left;
  } else if (step.placement === "left") {
    tooltipStyle.top = top;
    tooltipStyle.left = Math.max(12, left - 340);
  } else {
    tooltipStyle.top = top;
    tooltipStyle.left = left + width + offset;
  }

  const next = () => {
    setShowMore(false);
    if (index + 1 >= steps.length) onComplete();
    else setIndex(index + 1);
  };
  const back = () => {
    setShowMore(false);
    setIndex((v) => Math.max(0, v - 1));
  };

  return (
    <>
      <div className="tour-overlay" />
      <div
        className="tour-highlight"
        style={{ top, left, width, height }}
      />
      <div className="tour-tooltip" style={tooltipStyle} data-tour-tooltip>
        <div className="tour-header">
          <strong>{step.title}</strong>
          <span>{index + 1}/{steps.length}</span>
        </div>
        <p>{step.description}</p>
        {step.learnMore && (
          <button className="btn-link" onClick={() => setShowMore((v) => !v)}>
            {showMore ? "Hide details" : "Learn more"}
          </button>
        )}
        {showMore && step.learnMore && (
          <ul style={{ margin: "8px 0 10px 18px", color: "var(--text-muted)", fontSize: 12 }}>
            {step.learnMore.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
        <div className="tour-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Skip</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={back} disabled={index === 0}>Back</button>
            <button className="btn btn-primary btn-sm" onClick={next}>{index + 1 >= steps.length ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

