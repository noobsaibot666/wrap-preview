import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";

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

  const tooltipStyle: React.CSSProperties = { position: "fixed", zIndex: 1002 };
  const offset = 16;
  
  // Basic smart placement
  if (step.placement === "bottom") {
    tooltipStyle.top = top + height + offset;
    tooltipStyle.left = left;
  } else if (step.placement === "top") {
    tooltipStyle.top = Math.max(12, top - offset - 180); // Estimate tooltip height
    tooltipStyle.left = left;
  } else if (step.placement === "left") {
    tooltipStyle.top = top;
    tooltipStyle.left = Math.max(12, left - 320 - offset);
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
      <div className="tour-overlay" onClick={onClose} />
      <div
        className="tour-highlight"
        style={{ 
          top, 
          left, 
          width, 
          height 
        }}
      />
      <div className="tour-tooltip" style={tooltipStyle} data-tour-tooltip role="dialog" aria-modal="true">
        <div className="tour-header">
          <div className="tour-header-meta">
            <span>Step {index + 1} of {steps.length}</span>
          </div>
          <button className="tour-close-btn" onClick={onClose} aria-label="Close tour">
            <X size={14} />
          </button>
        </div>
        
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px', color: '#fff' }}>{step.title}</h3>
        <p>{step.description}</p>
        
        {step.learnMore && (
          <button 
            className="btn-link" 
            style={{ fontSize: '12px', padding: 0, marginBottom: '8px', opacity: 0.8 }} 
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? "Hide details" : "Learn more..."}
          </button>
        )}
        
        {showMore && step.learnMore && (
          <ul className="tour-learn-more">
            {step.learnMore.map((item, idx) => <li key={idx}>{item}</li>)}
          </ul>
        )}

        <div className="tour-footer">
          <div style={{ display: 'flex', gap: '4px' }}>
            {steps.map((_, idx) => (
              <div key={idx} className={`tour-progress-dot ${idx === index ? 'active' : ''}`} />
            ))}
          </div>
          
          <div className="tour-actions">
            <button className="btn btn-ghost btn-xs" onClick={onClose} style={{ marginRight: '4px', opacity: 0.6 }}>Skip</button>
            <div style={{ display: "flex", gap: "6px" }}>
              <button 
                className="btn btn-secondary btn-xs" 
                onClick={back} 
                disabled={index === 0}
                style={{ padding: '4px 8px' }}
              >
                <ChevronLeft size={14} />
              </button>
              <button 
                className="btn btn-primary btn-xs" 
                onClick={next}
                style={{ padding: '4px 12px', minWidth: '70px' }}
              >
                {index + 1 >= steps.length ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Finish <Check size={14} />
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Next <ChevronRight size={14} />
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
