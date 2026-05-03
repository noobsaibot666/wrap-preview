import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, AlertCircle, CheckCircle2, Monitor, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ActivationScreenProps {
  onActivated: () => void;
  onTrialStarted?: () => void;
  mode?: 'inactive' | 'expired';
}

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  onActivated,
  onTrialStarted,
  mode = 'inactive',
}) => {
  const [email, setEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [hwid, setHwid] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const isExpired = mode === 'expired';

  // Brand Standard Lavender Accent
  const ACCENT_COLOR = '#a592ff';

  useEffect(() => {
    invoke<string>('get_hwid').then(setHwid).catch(console.error);
  }, []);

  const handleCopyId = () => {
    if (!hwid) return;
    navigator.clipboard.writeText(hwid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isFormValid = email.trim().length > 0 && licenseKey.trim().length > 0;

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || loading) return;

    setLoading(true);
    setError(null);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanKey = licenseKey.trim();

      await invoke('activate_license', { key: cleanKey, email: cleanEmail });
      setSuccess(true);
      setTimeout(onActivated, 1500);
    } catch (err: any) {
      setError(err.toString());
      setLoading(false);
    }
  };

  const handleStartTrial = async () => {
    setTrialLoading(true);
    setError(null);
    try {
      await invoke('init_trial');
      onTrialStarted?.();
    } catch (err: any) {
      setError(err.toString());
      setTrialLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      style={{ backgroundColor: '#050506' }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{
          padding: '1.2px',
          borderRadius: '24px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)',
          width: '100%',
          maxWidth: '480px'
        }}
      >
        <div 
          style={{
            backgroundColor: '#0a0a0c',
            borderRadius: '23px',
            width: '100%',
            padding: '48px 40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center'
          }}
        >
          <AnimatePresence mode="wait">
            {!success ? (
              <motion.div
                key="activation-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                style={{ width: '100%' }}
              >
                {/* Brand / App Name */}
                <div style={{ marginBottom: '32px' }}>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '20px'
                  }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5em',
                      color: '#ffffff',
                      opacity: 0.4
                    }}>
                      CineFlow Suite
                    </span>
                  </div>
                  
                  <h1 style={{
                    fontSize: '36px',
                    fontWeight: 900,
                    color: '#ffffff',
                    letterSpacing: '-0.03em',
                    marginBottom: '16px',
                    lineHeight: 1.1
                  }}>
                    {isExpired ? 'Trial Expired' : 'Activate License'}
                  </h1>
                  <p style={{
                    fontSize: '14px',
                    color: '#ffffff',
                    maxWidth: '340px',
                    margin: '0 auto',
                    fontWeight: 400,
                    lineHeight: 1.6,
                    opacity: 0.5
                  }}>
                    {isExpired
                      ? 'Your free trial has ended. Purchase a license to continue using CineFlow Suite.'
                      : 'Enter your credentials to authorize this workstation and unlock the full creative suite.'}
                  </p>
                </div>

                <form onSubmit={handleActivate} style={{ 
                  width: '100%', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center' 
                }}>
                  <div style={{ width: '100%', maxWidth: '380px' }}>
                    
                    {/* Email Field */}
                    <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <label style={{ 
                          fontSize: '10px', 
                          fontWeight: 800, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.2em', 
                          color: '#ffffff',
                          opacity: 0.6
                        }}>
                          Email Address
                        </label>
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="studio@company.com"
                        required
                        style={{
                          width: '100%',
                          backgroundColor: email.length > 0 ? 'rgba(165, 146, 255, 0.03)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${email.length > 0 ? 'rgba(165, 146, 255, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '12px',
                          padding: '18px 20px',
                          color: '#ffffff',
                          fontSize: '15px',
                          outline: 'none',
                          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = ACCENT_COLOR;
                          e.currentTarget.style.backgroundColor = 'rgba(165, 146, 255, 0.08)';
                          e.currentTarget.style.boxShadow = `0 0 30px rgba(165, 146, 255, 0.2)`;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = email.length > 0 ? 'rgba(165, 146, 255, 0.3)' : 'rgba(255,255,255,0.08)';
                          e.currentTarget.style.backgroundColor = email.length > 0 ? 'rgba(165, 146, 255, 0.03)' : 'rgba(255,255,255,0.02)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      />
                    </div>

                    {/* Serial Field */}
                    <div style={{ marginBottom: '32px', textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <label style={{ 
                          fontSize: '10px', 
                          fontWeight: 800, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.2em', 
                          color: '#ffffff',
                          opacity: 0.6
                        }}>
                          License Serial
                        </label>
                        <button 
                          type="button"
                          onClick={() => {
                            if (!email) {
                              setError('Please enter your email first to recover your key.');
                              return;
                            }
                            // Call recover API
                            fetch('https://licensing.alan-design.com/resend-key', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ email })
                            }).then(() => setError('License key recovery sent to your email.'));
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: ACCENT_COLOR,
                            fontSize: '9px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                            cursor: 'pointer',
                            opacity: 0.8
                          }}
                        >
                          Forgot Key?
                        </button>
                      </div>
                      <input
                        type="text"
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value)}
                        placeholder="CF-XXXX-XXXX-XXXX"
                        required
                        style={{
                          width: '100%',
                          backgroundColor: licenseKey.length > 0 ? 'rgba(165, 146, 255, 0.03)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${licenseKey.length > 0 ? 'rgba(165, 146, 255, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '12px',
                          padding: '18px 20px',
                          color: '#ffffff',
                          fontSize: '15px',
                          letterSpacing: '0.05em',
                          outline: 'none',
                          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = ACCENT_COLOR;
                          e.currentTarget.style.backgroundColor = 'rgba(165, 146, 255, 0.08)';
                          e.currentTarget.style.boxShadow = `0 0 30px rgba(165, 146, 255, 0.2)`;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = licenseKey.length > 0 ? 'rgba(165, 146, 255, 0.3)' : 'rgba(255,255,255,0.08)';
                          e.currentTarget.style.backgroundColor = licenseKey.length > 0 ? 'rgba(165, 146, 255, 0.03)' : 'rgba(255,255,255,0.02)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      />
                    </div>

                    {error && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                          width: '100%',
                          backgroundColor: 'rgba(248,113,113,0.05)',
                          border: '1px solid rgba(248,113,113,0.2)',
                          borderRadius: '12px',
                          padding: '16px',
                          marginBottom: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          color: '#f87171',
                          fontSize: '11px',
                          fontWeight: 600,
                          textAlign: 'left'
                        }}
                      >
                        <AlertCircle size={16} />
                        <span>{error}</span>
                      </motion.div>
                    )}

                    <button
                      disabled={!isFormValid || loading}
                      type="submit"
                      style={{
                        width: '100%',
                        padding: '24px',
                        backgroundColor: isFormValid ? ACCENT_COLOR : '#1a1a1c',
                        color: isFormValid ? '#ffffff' : 'rgba(255,255,255,0.2)',
                        borderRadius: '14px',
                        border: 'none',
                        fontWeight: 900,
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.25em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        cursor: (!isFormValid || loading) ? 'default' : 'pointer',
                        opacity: loading ? 0.5 : 1,
                        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: isFormValid ? `0 20px 50px rgba(124, 58, 237, 0.4)` : 'none'
                      }}
                      onMouseEnter={(e) => { 
                        if(isFormValid && !loading) {
                          e.currentTarget.style.filter = 'brightness(1.1)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }
                      }}
                      onMouseLeave={(e) => { 
                        if(isFormValid && !loading) {
                          e.currentTarget.style.filter = 'brightness(1)';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }
                      }}
                    >
                      {loading ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <>
                          <span>Activate Suite</span>
                          <ArrowRight size={18} />
                        </>
                      )}
                    </button>

                    {/* Start Free Trial — only on first visit, not after expiry */}
                    {!isExpired && (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          margin: '20px 0 16px',
                        }}>
                          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                            Or
                          </span>
                          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                        </div>
                        <button
                          type="button"
                          onClick={handleStartTrial}
                          disabled={trialLoading}
                          style={{
                            width: '100%',
                            padding: '18px',
                            backgroundColor: 'transparent',
                            border: '1px solid rgba(165, 146, 255, 0.2)',
                            borderRadius: '14px',
                            color: ACCENT_COLOR,
                            fontWeight: 800,
                            fontSize: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.2em',
                            cursor: trialLoading ? 'default' : 'pointer',
                            opacity: trialLoading ? 0.5 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            transition: 'all 0.3s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!trialLoading) e.currentTarget.style.borderColor = 'rgba(165, 146, 255, 0.5)';
                          }}
                          onMouseLeave={(e) => {
                            if (!trialLoading) e.currentTarget.style.borderColor = 'rgba(165, 146, 255, 0.2)';
                          }}
                        >
                          {trialLoading
                            ? <Loader2 size={15} className="animate-spin" />
                            : 'Start 14-Day Free Trial'}
                        </button>
                        <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '10px', textAlign: 'center', lineHeight: 1.5 }}>
                          No account required · Limited features · Trial cannot be reset
                        </p>
                      </div>
                    )}
                  </div>
                </form>

                {/* Footer Metadata */}
                <div style={{ 
                  marginTop: '32px', 
                  paddingTop: '20px', 
                  borderTop: '1px solid rgba(255,255,255,0.03)',
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '24px'
                }}>
                  <div 
                    onClick={handleCopyId}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '10px', 
                      opacity: copied ? 1 : 0.3,
                      cursor: hwid ? 'pointer' : 'default',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => { if(hwid) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { if(hwid && !copied) e.currentTarget.style.opacity = '0.3'; }}
                  >
                    {copied ? <Check size={14} color="#10b981" /> : <Monitor size={14} color="#ffffff" />}
                    <span style={{ 
                      fontSize: '10px', 
                      color: copied ? '#10b981' : '#ffffff', 
                      fontWeight: 700, 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.15em' 
                    }}>
                      {copied ? 'Copied' : `Workstation ID: ${hwid || 'Detecting...'}`}
                    </span>
                  </div>
                  <button 
                    onClick={() => window.open('https://alan-design.com/buy', '_blank')}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      padding: 0, 
                      fontSize: '10px', 
                      color: ACCENT_COLOR, 
                      fontWeight: 700, 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.15em',
                      opacity: 0.8,
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                  >
                    Buy License
                  </button>
                  <button 
                    onClick={() => window.open('https://alan-design.com/support', '_blank')}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      padding: 0, 
                      fontSize: '10px', 
                      color: '#ffffff', 
                      fontWeight: 700, 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.15em',
                      opacity: 0.3,
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.3'}
                  >
                    Support
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="success-state"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ padding: '40px 0' }}
              >
                <div style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: 'rgba(16,185,129,0.05)',
                  border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 32px auto'
                }}>
                  <CheckCircle2 size={40} color="#10b981" />
                </div>
                <h2 style={{ fontSize: '32px', fontWeight: 900, color: '#ffffff', marginBottom: '12px' }}>
                  Authenticated
                </h2>
                <p style={{ 
                  fontSize: '11px', 
                  color: '#ffffff', 
                  fontWeight: 800, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.3em',
                  opacity: 0.5
                }}>
                  Welcome back, Alan
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
