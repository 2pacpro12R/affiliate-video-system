import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import brief from './data/brief.json';
import tool from './data/tool.json';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

// Scene boundaries (frames at 30fps, 35s = 1050 frames)
const SCENES = {
  HOOK:     [0,   150],   // 0s - 5s
  PROBLEM:  [150, 330],   // 5s - 11s
  SOLUTION: [330, 510],   // 11s - 17s
  DEMO:     [510, 720],   // 17s - 24s
  BENEFITS: [720, 900],   // 24s - 30s
  CTA:      [900, 1050],  // 30s - 35s
};

const hex2rgb = (hex) => {
  const h = String(hex || '#22C55E').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c+c).join('') : h.padEnd(6,'0').slice(0,6);
  return {
    r: parseInt(full.slice(0,2), 16),
    g: parseInt(full.slice(2,4), 16),
    b: parseInt(full.slice(4,6), 16),
  };
};

const rgba = (hex, a) => {
  const {r,g,b} = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

const sceneProgress = (frame, start, end) =>
  interpolate(frame, [start, end], [0, 1], CLAMP);

const sceneOpacity = (frame, start, end, fadeLen = 12) =>
  interpolate(frame, [start, start+fadeLen, end-fadeLen, end], [0, 1, 1, 0], CLAMP);

const getList = (val, fallback, limit) => {
  if (!Array.isArray(val) || val.length === 0) return fallback.slice(0, limit);
  return val.map(i => String(i||'').trim()).filter(Boolean).slice(0, limit);
};

// ─── NOISE TEXTURE SVG (subtle grain) ───────────────────────────────────────
const NoiseOverlay = () => (
  <AbsoluteFill style={{ opacity: 0.04, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
      </filter>
      <rect width="100%" height="100%" filter="url(#noise)" opacity="1"/>
    </svg>
  </AbsoluteFill>
);

// ─── FLOATING ORBS BACKGROUND ───────────────────────────────────────────────
const OrbBackground = ({ frame, color, variant = 'dark' }) => {
  const orb1Y = Math.sin(frame / 60) * 40;
  const orb2Y = Math.cos(frame / 80) * 30;
  const orb3X = Math.sin(frame / 50) * 25;

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {/* Base gradient */}
      <AbsoluteFill style={{
        background: variant === 'light'
          ? `linear-gradient(160deg, #F8FAFF 0%, #EEF2FF 50%, #F0FDF4 100%)`
          : `linear-gradient(160deg, #070A14 0%, #0D1425 50%, #080E1C 100%)`,
      }}/>

      {/* Orb 1 - main brand color */}
      <div style={{
        position: 'absolute',
        top: 200 + orb1Y,
        left: -100,
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: rgba(color, 0.18),
        filter: 'blur(120px)',
      }}/>

      {/* Orb 2 - lighter accent */}
      <div style={{
        position: 'absolute',
        bottom: 300 + orb2Y,
        right: -80,
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: rgba(color, 0.12),
        filter: 'blur(100px)',
      }}/>

      {/* Orb 3 - center subtle */}
      <div style={{
        position: 'absolute',
        top: '40%',
        left: 200 + orb3X,
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: rgba(color, 0.08),
        filter: 'blur(80px)',
      }}/>

      {/* Grid lines */}
      <AbsoluteFill style={{
        backgroundImage: `
          linear-gradient(${rgba(color, 0.04)} 1px, transparent 1px),
          linear-gradient(90deg, ${rgba(color, 0.04)} 1px, transparent 1px)
        `,
        backgroundSize: '80px 80px',
      }}/>

      <NoiseOverlay />
    </AbsoluteFill>
  );
};

// ─── PILL BADGE ──────────────────────────────────────────────────────────────
const Pill = ({ children, color, style = {} }) => (
  <div style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 22px',
    borderRadius: 999,
    border: `1px solid ${rgba(color, 0.35)}`,
    background: rgba(color, 0.12),
    backdropFilter: 'blur(10px)',
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color,
    ...style,
  }}>
    {children}
  </div>
);

// ─── SCENE 1: HOOK ──────────────────────────────────────────────────────────
const HookScene = ({ frame, color, toolName, hook }) => {
  const [start, end] = SCENES.HOOK;
  const opacity = sceneOpacity(frame, start, end);
  const progress = sceneProgress(frame, start, end);

  const words = String(hook || '').split(/\s+/).filter(Boolean);

  return (
    <AbsoluteFill style={{ opacity }}>
      <OrbBackground frame={frame} color={color} />

      {/* Big center number / attention grabber */}
      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 60px',
        gap: 40,
      }}>
        {/* Top badge */}
        <div style={{
          opacity: interpolate(frame, [start+5, start+20], [0,1], CLAMP),
          transform: `translateY(${interpolate(frame, [start+5, start+20], [20,0], CLAMP)}px)`,
        }}>
          <Pill color={color}>🔥 Trending Tool</Pill>
        </div>

        {/* Main hook text — word by word */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '12px 16px',
          maxWidth: 900,
        }}>
          {words.map((word, i) => {
            const wordSpring = spring({
              frame: frame - start - i * 5,
              fps: 30,
              config: { damping: 14, stiffness: 180, mass: 0.6 },
            });
            const isAccent = i === words.length - 1 || i === 0;
            return (
              <span key={i} style={{
                fontSize: words.length > 6 ? 72 : 88,
                fontWeight: 900,
                letterSpacing: -3,
                lineHeight: 1,
                fontFamily: '"Georgia", serif',
                color: isAccent ? color : '#FFFFFF',
                opacity: interpolate(wordSpring, [0, 0.2, 1], [0, 1, 1], CLAMP),
                transform: `scale(${interpolate(wordSpring, [0, 0.7, 1], [0.6, 1.08, 1], CLAMP)}) translateY(${interpolate(wordSpring, [0, 1], [30, 0], CLAMP)}px)`,
                display: 'inline-block',
                textShadow: isAccent ? `0 0 60px ${rgba(color, 0.6)}` : 'none',
              }}>
                {word}
              </span>
            );
          })}
        </div>

        {/* Tool name */}
        <div style={{
          opacity: interpolate(frame, [start+40, start+60], [0,1], CLAMP),
          fontSize: 32,
          color: rgba('#FFFFFF', 0.5),
          letterSpacing: 4,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>
          {toolName}
        </div>

        {/* Scroll indicator */}
        <div style={{
          position: 'absolute',
          bottom: 80,
          opacity: interpolate(frame, [start+80, start+100, end-30, end], [0,1,1,0], CLAMP),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 2,
            height: interpolate(frame - start, [80, 150], [0, 60], CLAMP),
            background: `linear-gradient(to bottom, ${color}, transparent)`,
          }}/>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }}/>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── SCENE 2: PROBLEMS ──────────────────────────────────────────────────────
const ProblemScene = ({ frame, color, problems }) => {
  const [start, end] = SCENES.PROBLEM;
  const opacity = sceneOpacity(frame, start, end);

  return (
    <AbsoluteFill style={{ opacity }}>
      <OrbBackground frame={frame} color="#FF4444" />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px 72px',
        gap: 32,
      }}>
        {/* Label */}
        <div style={{
          opacity: interpolate(frame, [start+8, start+25], [0,1], CLAMP),
          transform: `translateX(${interpolate(frame, [start+8, start+25], [-40, 0], CLAMP)}px)`,
        }}>
          <Pill color="#FF6B6B">😤 Le vrai problème</Pill>
        </div>

        {/* Title */}
        <div style={{
          fontSize: 72,
          fontWeight: 900,
          letterSpacing: -2,
          lineHeight: 1.05,
          fontFamily: '"Georgia", serif',
          color: '#FFFFFF',
          opacity: interpolate(frame, [start+15, start+35], [0,1], CLAMP),
          transform: `translateY(${interpolate(frame, [start+15, start+35], [30,0], CLAMP)}px)`,
        }}>
          Tu te reconnais ?
        </div>

        {/* Problem cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
          {problems.map((problem, i) => {
            const cardStart = start + 35 + i * 22;
            const cardSpring = spring({
              frame: frame - cardStart,
              fps: 30,
              config: { damping: 16, stiffness: 160, mass: 0.7 },
            });
            return (
              <div key={i} style={{
                opacity: interpolate(cardSpring, [0, 0.3, 1], [0, 1, 1], CLAMP),
                transform: `translateX(${interpolate(cardSpring, [0, 1], [-80, 0], CLAMP)}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: '24px 28px',
                borderRadius: 20,
                background: 'rgba(255,68,68,0.08)',
                border: '1px solid rgba(255,68,68,0.2)',
                backdropFilter: 'blur(12px)',
              }}>
                <div style={{
                  fontSize: 32,
                  flexShrink: 0,
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'rgba(255,68,68,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {['😩', '⏰', '😤'][i] || '❌'}
                </div>
                <div style={{
                  fontSize: 32,
                  lineHeight: 1.3,
                  color: '#F0F0F0',
                  fontWeight: 600,
                }}>
                  {problem}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── SCENE 3: SOLUTION REVEAL ───────────────────────────────────────────────
const SolutionScene = ({ frame, color, toolName, tagline }) => {
  const [start, end] = SCENES.SOLUTION;
  const opacity = sceneOpacity(frame, start, end);

  const logoSpring = spring({
    frame: frame - start - 10,
    fps: 30,
    config: { damping: 10, stiffness: 120, mass: 1 },
  });

  const textReveal = interpolate(frame, [start+40, start+70], [0, 1], CLAMP);
  const glowPulse = 0.5 + 0.5 * Math.sin((frame - start) * 0.08);

  return (
    <AbsoluteFill style={{ opacity }}>
      <OrbBackground frame={frame} color={color} />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '60px',
        gap: 36,
      }}>
        {/* Logo circle */}
        <div style={{
          transform: `scale(${Math.max(0, logoSpring)})`,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${rgba(color, 0.9)}, ${rgba(color, 0.6)})`,
          border: `3px solid ${rgba(color, 0.4)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 80,
          fontWeight: 900,
          color: '#FFFFFF',
          fontFamily: '"Georgia", serif',
          boxShadow: `0 0 ${60 + glowPulse * 40}px ${rgba(color, 0.5)}, 0 0 120px ${rgba(color, 0.25)}`,
        }}>
          {String(toolName).charAt(0).toUpperCase()}
        </div>

        {/* Tool name */}
        <div style={{
          fontSize: 96,
          fontWeight: 900,
          letterSpacing: -4,
          fontFamily: '"Georgia", serif',
          color: '#FFFFFF',
          textAlign: 'center',
          opacity: textReveal,
          transform: `translateY(${interpolate(textReveal, [0,1], [20,0], CLAMP)}px)`,
        }}>
          {toolName}
        </div>

        {/* Tagline */}
        <div style={{
          fontSize: 36,
          lineHeight: 1.4,
          color: rgba('#FFFFFF', 0.7),
          textAlign: 'center',
          maxWidth: 800,
          opacity: interpolate(frame, [start+60, start+90], [0,1], CLAMP),
          transform: `translateY(${interpolate(frame, [start+60, start+90], [20,0], CLAMP)}px)`,
        }}>
          {tagline}
        </div>

        {/* Divider line animation */}
        <div style={{
          width: interpolate(frame, [start+70, start+110], [0, 300], CLAMP),
          height: 2,
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          borderRadius: 2,
        }}/>

        {/* "La solution" label */}
        <div style={{
          opacity: interpolate(frame, [start+80, start+100], [0,1], CLAMP),
        }}>
          <Pill color={color}>✨ La solution</Pill>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── SCENE 4: APP DEMO ──────────────────────────────────────────────────────
const DemoScene = ({ frame, color, toolName, appMockup }) => {
  const [start, end] = SCENES.DEMO;
  const opacity = sceneOpacity(frame, start, end);

  const mockup = appMockup || {};
  const tabs = getList(mockup.tabs, ['Dashboard', 'Generate', 'Export'], 3);
  const metrics = getList(mockup.metrics, ['CTR +37%', '30 sec', 'Pro ready'], 3);
  const bullets = getList(mockup.resultBullets, ['Optimized', 'Mobile ready', 'Publish now'], 3);
  const activeTab = Math.floor(interpolate(frame, [start+30, start+120], [0, tabs.length-1], CLAMP));

  const phoneSpring = spring({
    frame: frame - start - 5,
    fps: 30,
    config: { damping: 14, stiffness: 100, mass: 1.2 },
  });

  const typing = Math.floor(interpolate(frame, [start+60, start+120], [0, 28], CLAMP));
  const btnSpring = spring({ frame: frame - start - 100, fps: 30, config: { damping: 10, stiffness: 200 } });
  const resultOpacity = interpolate(frame, [start+140, start+160], [0,1], CLAMP);
  const pulse = 1 + 0.025 * Math.sin((frame - start) * 0.25);

  return (
    <AbsoluteFill style={{ opacity }}>
      <OrbBackground frame={frame} color={color} />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 30,
        padding: '60px 40px',
      }}>
        {/* Label */}
        <div style={{
          opacity: interpolate(frame, [start+5, start+20], [0,1], CLAMP),
        }}>
          <Pill color={color}>🖥️ En action</Pill>
        </div>

        {/* Phone mockup */}
        <div style={{
          transform: `scale(${Math.max(0, phoneSpring)}) perspective(1000px) rotateY(${interpolate(frame, [start, start+40], [8, 0], CLAMP)}deg)`,
          transformOrigin: 'center center',
        }}>
          <div style={{
            width: 340,
            borderRadius: 44,
            border: `10px solid #1A1A2E`,
            boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 60px ${rgba(color, 0.2)}, inset 0 0 0 1px rgba(255,255,255,0.1)`,
            overflow: 'hidden',
            background: '#F8FAFC',
          }}>
            {/* Status bar */}
            <div style={{
              height: 36,
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 20px',
            }}>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{String(mockup.screenTitle || toolName).slice(0,16)}</span>
              <span style={{ color: rgba('#fff', 0.8), fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: rgba('#fff', 0.2) }}>LIVE</span>
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB', padding: '0 12px' }}>
              {tabs.map((tab, i) => (
                <div key={i} style={{
                  flex: 1,
                  padding: '12px 4px',
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: i === activeTab ? 700 : 500,
                  color: i === activeTab ? color : '#9CA3AF',
                  borderBottom: i === activeTab ? `2px solid ${color}` : '2px solid transparent',
                  transition: 'all 0.3s',
                }}>
                  {tab}
                </div>
              ))}
            </div>

            {/* Content */}
            <div style={{ padding: '16px 14px', background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Input field */}
              <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, marginBottom: 4 }}>
                {mockup.inputLabel || 'Titre de la vidéo'}
              </div>
              <div style={{
                border: `2px solid ${color}`,
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 14,
                color: '#111827',
                background: '#FFFFFF',
                minHeight: 40,
              }}>
                {String(mockup.inputPlaceholder || 'Mon contenu...').slice(0, typing)}
                {typing < 28 && <span style={{ opacity: Math.floor(frame / 15) % 2, color }}> |</span>}
              </div>

              {/* CTA Button */}
              <div style={{
                background: color,
                borderRadius: 12,
                padding: '12px',
                textAlign: 'center',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 15,
                transform: `scale(${Math.max(0, btnSpring) * pulse})`,
                transformOrigin: 'center',
                opacity: interpolate(frame, [start+100, start+115], [0,1], CLAMP),
                boxShadow: `0 8px 24px ${rgba(color, 0.4)}`,
              }}>
                {mockup.buttonLabel || 'Generate ✨'}
              </div>

              {/* Result */}
              <div style={{
                opacity: resultOpacity,
                background: '#FFFFFF',
                borderRadius: 12,
                border: `1px solid ${rgba(color, 0.2)}`,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: color }}>{mockup.resultLabel || '✅ Preview ready'}</div>
                {bullets.map((b, i) => (
                  <div key={i} style={{
                    fontSize: 12,
                    color: '#374151',
                    padding: '6px 10px',
                    background: '#F9FAFB',
                    borderRadius: 8,
                    border: '1px solid #E5E7EB',
                    opacity: interpolate(frame, [start+155+i*12, start+170+i*12], [0,1], CLAMP),
                  }}>
                    ✓ {b}
                  </div>
                ))}
              </div>

              {/* Metrics row */}
              <div style={{ display: 'flex', gap: 8 }}>
                {metrics.map((m, i) => (
                  <div key={i} style={{
                    flex: 1,
                    background: rgba(color, 0.1),
                    borderRadius: 10,
                    padding: '8px 6px',
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                    color: color,
                    opacity: interpolate(frame, [start+165+i*8, start+178+i*8], [0,1], CLAMP),
                  }}>
                    {m}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Annotation */}
        <div style={{
          opacity: interpolate(frame, [start+150, start+170], [0,1], CLAMP),
          transform: `scale(${spring({ frame: frame-start-150, fps: 30, config: {damping:12,stiffness:200} })})`,
          background: '#FFFFFF',
          color: '#111827',
          borderRadius: 16,
          padding: '12px 20px',
          fontWeight: 800,
          fontSize: 22,
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
        }}>
          ⚡ Résultat en quelques secondes
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── SCENE 5: BENEFITS ──────────────────────────────────────────────────────
const BenefitsScene = ({ frame, color, benefits, rating, userCount }) => {
  const [start, end] = SCENES.BENEFITS;
  const opacity = sceneOpacity(frame, start, end);

  const counter = Math.floor(interpolate(frame, [start+20, start+80], [0, 10], CLAMP));
  const ratingAnim = interpolate(frame, [start+20, start+80], [0, Number(rating||4.8)], CLAMP);
  const usersAnim = Math.floor(interpolate(frame, [start+20, start+100], [0, 12000], CLAMP));

  return (
    <AbsoluteFill style={{ opacity }}>
      <OrbBackground frame={frame} color={color} />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px 64px',
        gap: 28,
      }}>
        {/* Label */}
        <div style={{ opacity: interpolate(frame, [start+5, start+20], [0,1], CLAMP) }}>
          <Pill color={color}>🚀 Résultats réels</Pill>
        </div>

        {/* Big counter */}
        <div style={{
          fontSize: 160,
          fontWeight: 900,
          lineHeight: 0.9,
          fontFamily: '"Georgia", serif',
          color: color,
          opacity: interpolate(frame, [start+15, start+35], [0,1], CLAMP),
          textShadow: `0 0 80px ${rgba(color, 0.4)}`,
        }}>
          {counter}x
        </div>
        <div style={{
          fontSize: 32,
          color: rgba('#FFFFFF', 0.6),
          marginTop: -10,
          opacity: interpolate(frame, [start+30, start+50], [0,1], CLAMP),
        }}>
          plus rapide qu'avant
        </div>

        {/* Benefit cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
          {benefits.map((benefit, i) => {
            const cardSpring = spring({
              frame: frame - start - 50 - i * 15,
              fps: 30,
              config: { damping: 14, stiffness: 180 },
            });
            const bounce = 1 + 0.02 * Math.sin((frame + i*20) * 0.2);
            return (
              <div key={i} style={{
                opacity: interpolate(cardSpring, [0, 0.3, 1], [0,1,1], CLAMP),
                transform: `translateX(${interpolate(cardSpring, [0,1], [-60,0], CLAMP)}px) scale(${Math.max(0,cardSpring) * bounce})`,
                transformOrigin: 'left center',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '20px 24px',
                borderRadius: 18,
                background: rgba(color, 0.08),
                border: `1px solid ${rgba(color, 0.2)}`,
                backdropFilter: 'blur(8px)',
              }}>
                <div style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: color,
                  boxShadow: `0 0 12px ${rgba(color, 0.8)}`,
                  flexShrink: 0,
                }}/>
                <div style={{ fontSize: 30, fontWeight: 700, color: '#F0F0F0' }}>
                  {benefit}
                </div>
              </div>
            );
          })}
        </div>

        {/* Social proof */}
        <div style={{
          display: 'flex',
          gap: 20,
          marginTop: 8,
          opacity: interpolate(frame, [start+100, start+120], [0,1], CLAMP),
        }}>
          <div style={{
            flex: 1,
            padding: '16px 20px',
            borderRadius: 16,
            background: rgba('#F59E0B', 0.1),
            border: `1px solid ${rgba('#F59E0B', 0.2)}`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#F59E0B' }}>
              ⭐ {ratingAnim.toFixed(1)}
            </div>
            <div style={{ fontSize: 18, color: rgba('#FFFFFF', 0.5), marginTop: 4 }}>Note moyenne</div>
          </div>
          <div style={{
            flex: 1,
            padding: '16px 20px',
            borderRadius: 16,
            background: rgba(color, 0.1),
            border: `1px solid ${rgba(color, 0.2)}`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color }}>
              {new Intl.NumberFormat('fr-FR').format(usersAnim)}+
            </div>
            <div style={{ fontSize: 18, color: rgba('#FFFFFF', 0.5), marginTop: 4 }}>utilisateurs</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── SCENE 6: CTA ───────────────────────────────────────────────────────────
const CTAScene = ({ frame, color, ctaText, affiliateUrl, toolName }) => {
  const [start, end] = SCENES.CTA;
  const opacity = sceneOpacity(frame, start, end, 8);

  const ctaSpring = spring({
    frame: frame - start - 5,
    fps: 30,
    config: { damping: 12, stiffness: 140, mass: 1 },
  });

  const pulse = 1 + 0.04 * Math.sin((frame - start) * 0.2);
  const glow = 40 + 20 * Math.sin((frame - start) * 0.15);

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Full brand color background */}
      <AbsoluteFill style={{ background: color }}/>

      {/* Dark overlay pattern */}
      <AbsoluteFill style={{
        backgroundImage: `radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.2) 0%, transparent 50%)`,
      }}/>

      {/* Grid */}
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }}/>

      <NoiseOverlay />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '60px 64px',
        gap: 36,
      }}>
        {/* Arrow down */}
        <div style={{
          opacity: interpolate(frame, [start+5, start+20], [0,1], CLAMP),
          fontSize: 48,
          transform: `translateY(${Math.sin((frame-start) * 0.15) * 8}px)`,
        }}>
          👇
        </div>

        {/* CTA text */}
        <div style={{
          transform: `scale(${Math.max(0, ctaSpring) * pulse})`,
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 84,
            fontWeight: 900,
            letterSpacing: -3,
            lineHeight: 1.05,
            fontFamily: '"Georgia", serif',
            color: '#FFFFFF',
            textShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>
            {ctaText}
          </div>
        </div>

        {/* Link in bio */}
        <div style={{
          opacity: interpolate(frame, [start+30, start+50], [0,1], CLAMP),
          transform: `translateY(${interpolate(frame, [start+30, start+50], [20,0], CLAMP)}px)`,
          fontSize: 42,
          fontWeight: 800,
          color: rgba('#FFFFFF', 0.85),
        }}>
          🔗 Lien en bio
        </div>

        {/* CTA Button */}
        <div style={{
          opacity: interpolate(frame, [start+45, start+65], [0,1], CLAMP),
          transform: `scale(${pulse}) translateY(${interpolate(frame, [start+45, start+65], [20,0], CLAMP)}px)`,
          padding: '28px 56px',
          borderRadius: 24,
          background: '#FFFFFF',
          color: '#111827',
          fontSize: 36,
          fontWeight: 900,
          letterSpacing: -0.5,
          textAlign: 'center',
          boxShadow: `0 0 ${glow}px rgba(0,0,0,0.25), 0 20px 60px rgba(0,0,0,0.2)`,
        }}>
          Essayer {toolName} →
        </div>

        {/* URL */}
        <div style={{
          opacity: interpolate(frame, [start+60, start+80], [0,1], CLAMP),
          fontSize: 20,
          color: rgba('#FFFFFF', 0.65),
          textAlign: 'center',
          wordBreak: 'break-all',
          maxWidth: 860,
        }}>
          {affiliateUrl}
        </div>

        {/* Bottom tag */}
        <div style={{
          opacity: interpolate(frame, [start+70, start+90], [0,1], CLAMP),
          padding: '10px 24px',
          borderRadius: 999,
          background: rgba('#000000', 0.2),
          color: rgba('#FFFFFF', 0.8),
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 1,
        }}>
          LIEN EN DESCRIPTION ⬇️
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── PROGRESS BAR ───────────────────────────────────────────────────────────
const ProgressBar = ({ frame, color }) => {
  const totalFrames = 1050;
  const progress = frame / totalFrames;
  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 4,
      background: rgba(color, 0.2),
      zIndex: 100,
    }}>
      <div style={{
        height: '100%',
        width: `${progress * 100}%`,
        background: color,
        borderRadius: '0 2px 2px 0',
        boxShadow: `0 0 8px ${rgba(color, 0.8)}`,
      }}/>
    </div>
  );
};

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export const AffiliateToolVideo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const brandColor = String(brief.brandColor || tool.color || '#22C55E');
  const toolName = String(brief.toolName || tool.name || 'Tool');
  const tagline = String(brief.tagline || tool.tagline || '');
  const hook = String(brief.hook || '');
  const ctaText = String(brief.ctaText || `Essaye ${toolName}`);
  const affiliateUrl = String(brief.affiliateUrl || tool.affiliateUrl || '');
  const rating = Number(brief.rating || 4.8);
  const userCount = String(brief.userCount || '12,000+');

  const problems = getList(brief.problems, [
    'Tu perds trop de temps sur des tâches répétitives.',
    'Le rendu manque de constance.',
    'La production est trop lente.',
  ], 3);

  const benefits = getList(brief.benefits, [
    'Production 10x plus rapide',
    'Résultat pro en quelques clics',
    'Moins d\'effort, plus de résultats',
  ], 3);

  return (
    <AbsoluteFill style={{
      backgroundColor: '#070A14',
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
      color: '#FFFFFF',
      overflow: 'hidden',
    }}>
      <HookScene frame={frame} color={brandColor} toolName={toolName} hook={hook} />
      <ProblemScene frame={frame} color={brandColor} problems={problems} />
      <SolutionScene frame={frame} color={brandColor} toolName={toolName} tagline={tagline} />
      <DemoScene frame={frame} color={brandColor} toolName={toolName} appMockup={brief.appMockup} />
      <BenefitsScene frame={frame} color={brandColor} benefits={benefits} rating={rating} userCount={userCount} />
      <CTAScene frame={frame} color={brandColor} ctaText={ctaText} affiliateUrl={affiliateUrl} toolName={toolName} />

      <ProgressBar frame={frame} color={brandColor} />
    </AbsoluteFill>
  );
};
