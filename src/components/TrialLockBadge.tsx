import React from 'react';
import { Lock } from 'lucide-react';

const TrialLockBadge: React.FC = () => (
  <div style={{
    position: 'absolute',
    top: '10px',
    right: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    backgroundColor: 'rgba(10, 10, 12, 0.85)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px',
    padding: '4px 10px 4px 7px',
    backdropFilter: 'blur(8px)',
    zIndex: 2,
    pointerEvents: 'none',
  }}>
    <Lock size={9} color="rgba(255,255,255,0.35)" />
    <span style={{
      fontSize: '9px',
      fontWeight: 700,
      letterSpacing: '0.14em',
      color: 'rgba(255,255,255,0.35)',
      textTransform: 'uppercase',
    }}>
      Full License
    </span>
  </div>
);

export default TrialLockBadge;
