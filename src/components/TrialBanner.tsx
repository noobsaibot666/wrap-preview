import React from 'react';
import { Zap } from 'lucide-react';

interface TrialBannerProps {
  daysRemaining: number;
  onUpgrade: () => void;
}

const TrialBanner: React.FC<TrialBannerProps> = ({ daysRemaining, onUpgrade }) => {
  const urgencyColor =
    daysRemaining <= 2 ? '#ef4444' :
    daysRemaining <= 7 ? '#f59e0b' :
    '#a592ff';

  const message =
    daysRemaining === 0 ? 'Trial ends today' :
    daysRemaining === 1 ? '1 day remaining in your trial' :
    `${daysRemaining} days remaining in your trial`;

  return (
    <div style={{
      width: '100%',
      height: '34px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      backgroundColor: 'rgba(10, 10, 12, 0.95)',
      borderBottom: `1px solid ${urgencyColor}22`,
      flexShrink: 0,
      zIndex: 9999,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Zap size={12} color={urgencyColor} fill={urgencyColor} />
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          color: urgencyColor,
          letterSpacing: '0.02em',
        }}>
          Free Trial
        </span>
        <span style={{
          fontSize: '11px',
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.01em',
        }}>
          — {message}
        </span>
      </div>

      <button
        onClick={onUpgrade}
        style={{
          padding: '4px 14px',
          backgroundColor: urgencyColor,
          border: 'none',
          borderRadius: '6px',
          color: daysRemaining <= 2 ? '#fff' : '#0a0a0c',
          fontSize: '10px',
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        Upgrade
      </button>
    </div>
  );
};

export default TrialBanner;
