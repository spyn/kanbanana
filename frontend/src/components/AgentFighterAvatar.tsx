import React, { useState } from 'react'
import { Flame, Swords } from 'lucide-react'

interface AgentFighterAvatarProps {
  provider: string
  name: string
  isActive: boolean
  isRecent?: boolean
  quotaUsedPct?: number
  tokensPerMin?: number
}

const PROVIDER_PALETTES: Record<
  string,
  {
    primary: string
    secondary: string
    glove: string
    gi: string
    hadouken: string
    moveName: string
  }
> = {
  antigravity: {
    primary: '#6366f1',
    secondary: '#a855f7',
    glove: '#ef4444',
    gi: '#1e1b4b',
    hadouken: '#38bdf8',
    moveName: 'GRAVITY HADOUKEN!',
  },
  claude: {
    primary: '#d97757',
    secondary: '#fb923c',
    glove: '#f97316',
    gi: '#431407',
    hadouken: '#fbbf24',
    moveName: 'SONNET SHORYUKEN!',
  },
  kimi: {
    primary: '#06b6d4',
    secondary: '#3b82f6',
    glove: '#22d3ee',
    gi: '#083344',
    hadouken: '#67e8f9',
    moveName: 'MOONSHOT TATSUMAKI!',
  },
  minimax: {
    primary: '#ec4899',
    secondary: '#f43f5e',
    glove: '#fb7185',
    gi: '#500724',
    hadouken: '#f472b6',
    moveName: 'MINIMAX SONIC BOOM!',
  },
  grok: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    glove: '#ef4444',
    gi: '#0f172a',
    hadouken: '#f8fafc',
    moveName: 'ORBITAL SLASH!',
  },
  codex: {
    primary: '#10b981',
    secondary: '#34d399',
    glove: '#059669',
    gi: '#064e3b',
    hadouken: '#6ee7b7',
    moveName: 'PATCH UPPERCUT!',
  },
  cursor: {
    primary: '#3b82f6',
    secondary: '#60a5fa',
    glove: '#2563eb',
    gi: '#172554',
    hadouken: '#93c5fd',
    moveName: 'TAB-TAB COMBO!',
  },
  opencode: {
    primary: '#eab308',
    secondary: '#facc15',
    glove: '#ca8a04',
    gi: '#422006',
    hadouken: '#fde047',
    moveName: 'OPEN HADOUKEN!',
  },
}

export const AgentFighterAvatar: React.FC<AgentFighterAvatarProps> = ({
  provider,
  name,
  isActive,
  isRecent = false,
  quotaUsedPct = 15,
  tokensPerMin = 0,
}) => {
  const [demoFight, setDemoFight] = useState(false)
  const fighting = isActive || demoFight

  const key = provider.toLowerCase()
  const pal = PROVIDER_PALETTES[key] || {
    primary: '#8b5cf6',
    secondary: '#c084fc',
    glove: '#ef4444',
    gi: '#2e1065',
    hadouken: '#38bdf8',
    moveName: 'HYPER COMBO!',
  }

  // Remaining stamina/quota bar (arcade health bar style)
  const remainingQuota = Math.max(5, Math.min(100, 100 - quotaUsedPct))

  const renderLogoSymbol = () => {
    switch (key) {
      case 'antigravity':
        // 4-point Gemini/Antigravity sparkle star inside the fighter head
        return (
          <path
            d="M50 18 L53 26 L61 29 L53 32 L50 40 L47 32 L39 29 L47 26 Z"
            fill="#ffffff"
          />
        )
      case 'claude':
        // Claude sunburst rays
        return (
          <g stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
            <line x1="50" y1="19" x2="50" y2="39" />
            <line x1="40" y1="29" x2="60" y2="29" />
            <line x1="43" y1="22" x2="57" y2="36" />
            <line x1="57" y1="22" x2="43" y2="36" />
          </g>
        )
      case 'kimi':
        // Kimi crescent moon + star
        return (
          <g fill="#ffffff">
            <path d="M53 20 A9 9 0 1 0 53 38 A7 7 0 1 1 53 20 Z" />
            <circle cx="56" cy="26" r="2" />
          </g>
        )
      case 'minimax':
        // Minimax M wave
        return (
          <path
            d="M41 34 L44 22 L50 30 L56 22 L59 34"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      case 'grok':
        // Grok orbital slash
        return (
          <g stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="50" cy="29" r="6" fill="none" />
            <line x1="41" y1="37" x2="59" y2="21" />
          </g>
        )
      case 'codex':
        // Hexagon code core
        return (
          <polygon
            points="50,19 58,24 58,34 50,39 42,34 42,24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.2"
          />
        )
      case 'cursor':
        // Cursor arrow
        return (
          <polygon
            points="44,20 59,28 51,31 48,39"
            fill="#ffffff"
          />
        )
      default:
        // Terminal prompt >_
        return (
          <path
            d="M43 24 L49 29 L43 34 M51 34 L57 34"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        )
    }
  }

  return (
    <div className="relative rounded-xl border border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/40 p-2.5 flex flex-col items-center justify-between w-44 shrink-0 select-none overflow-hidden shadow-inner">
      {/* Top Arcade Health / Quota Bar */}
      <div className="w-full flex flex-col gap-1 z-10">
        <div className="flex items-center justify-between text-[9px] font-mono font-extrabold tracking-tighter">
          <span className="px-1 rounded bg-amber-400 text-slate-950">1P</span>
          <span className="text-amber-300 truncate max-w-[76px]">
            {name.split(' ')[0].toUpperCase()}
          </span>
          <span className="text-rose-400">KO</span>
        </div>
        <div className="w-full h-2 rounded-xs bg-rose-950 border border-amber-400/80 overflow-hidden p-0.2">
          <div
            className="h-full bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-400 transition-all duration-300"
            style={{ width: `${remainingQuota}%` }}
            title={`Remaining Stamina/Quota: ${remainingQuota.toFixed(0)}%`}
          />
        </div>
      </div>

      {/* Combo / Move Banner when Fighting */}
      {fighting ? (
        <div className="text-[9px] font-mono font-black tracking-wider text-amber-300 bg-rose-600/90 border border-amber-300 px-1.5 py-0.2 rounded shadow animate-bounce mt-1 z-10">
          {pal.moveName}
        </div>
      ) : (
        <div className="text-[9px] font-mono text-slate-500 mt-1">
          {isRecent ? 'READY STANCE' : 'RESTING STANCE'}
        </div>
      )}

      {/* Animated SVG Fighter Character with Logo Head, Arms & Legs */}
      <div className="relative w-36 h-28 flex items-center justify-center">
        <svg
          viewBox="0 0 135 110"
          className="w-full h-full overflow-visible"
        >
          {/* Dojo Floor Shadow */}
          <ellipse
            cx="52"
            cy="102"
            rx={fighting ? '26' : '22'}
            ry="4"
            fill="rgba(0,0,0,0.55)"
          />

          <g className={fighting ? 'fighter-fighting-body' : 'fighter-idle-body'}>
            {/* Fluttering Red Fighter Headband Tails */}
            <g className={fighting ? 'fighter-headband-active' : ''}>
              <path
                d="M34 22 Q18 16 12 25 Q22 27 33 26 Z"
                fill="#ef4444"
              />
              <path
                d="M34 24 Q20 28 15 35 Q25 33 34 27 Z"
                fill="#dc2626"
              />
            </g>

            {/* Back Leg & Boot */}
            <g className={fighting ? 'fighter-leg-back-active' : ''}>
              <path
                d="M44 76 L35 94 L42 96 L49 78 Z"
                fill={pal.gi}
                stroke={pal.primary}
                strokeWidth="1.5"
              />
              {/* Fighter Boot */}
              <rect
                x="31"
                y="93"
                width="13"
                height="6"
                rx="2"
                fill={pal.glove}
              />
            </g>

            {/* Lead Kicking Leg & Boot */}
            <g className={fighting ? 'fighter-leg-lead-active' : ''}>
              <path
                d="M55 76 L64 94 L57 96 L50 78 Z"
                fill={pal.gi}
                stroke={pal.primary}
                strokeWidth="1.5"
              />
              {/* Fighter Boot */}
              <rect
                x="56"
                y="93"
                width="14"
                height="6"
                rx="2"
                fill={pal.glove}
              />
            </g>

            {/* Back Arm & Boxing Glove (Throws Left Jab) */}
            <g className={fighting ? 'fighter-arm-left-active' : ''}>
              <path
                d="M38 50 L24 58 L34 65"
                fill="none"
                stroke={pal.secondary}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="35"
                cy="65"
                r="6.5"
                fill={pal.glove}
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </g>

            {/* Martial Arts Gi Torso */}
            <path
              d="M37 45 L63 45 L60 77 L40 77 Z"
              fill={pal.gi}
              stroke={pal.primary}
              strokeWidth="2"
               strokeLinejoin="round"
            />
            {/* Gi Lapel V-neck */}
            <path
              d="M42 45 L50 58 L58 45"
              fill="none"
              stroke={pal.secondary}
              strokeWidth="2"
            />
            {/* Black Belt */}
            <rect x="39" y="70" width="22" height="4.5" rx="1" fill="#090d16" />
            <path d="M50 72 L46 83 M52 72 L56 82" stroke="#090d16" strokeWidth="3" strokeLinecap="round" />

            {/* Agent Logo Head */}
            <circle
              cx="50"
              cy="29"
              r="15"
              fill={pal.primary}
              stroke="#ffffff"
              strokeWidth="2"
            />
            {/* Red Fighter Headband Across Forehead */}
            <path
              d="M35 22 Q50 19 65 22 L65 26 Q50 23 35 26 Z"
              fill="#ef4444"
            />

            {/* Provider Logo Emblem inside Head */}
            {renderLogoSymbol()}

            {/* Determined Fighter Eyes */}
            <polygon points="43,24 48,26 43,27" fill="#fef08a" />
            <polygon points="57,24 52,26 57,27" fill="#fef08a" />

            {/* Lead Arm & Boxing Glove (Throws Cross / Energy Projectile) */}
            <g className={fighting ? 'fighter-arm-right-active' : ''}>
              <path
                d="M61 50 L74 55 L82 49"
                fill="none"
                stroke={pal.secondary}
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="84"
                cy="48"
                r="7"
                fill={pal.glove}
                stroke="#ffffff"
                strokeWidth="1.4"
              />
            </g>
          </g>

          {/* Energy Fireball Projectile when Active/Fighting */}
          {fighting && (
            <g className="fighter-hadouken">
              <circle
                cx="96"
                cy="48"
                r="9"
                fill={pal.hadouken}
                fillOpacity="0.35"
              />
              <circle
                cx="98"
                cy="48"
                r="5.5"
                fill="#ffffff"
                stroke={pal.hadouken}
                strokeWidth="2.5"
              />
              <path
                d="M84 44 L94 46 M82 52 L94 50"
                stroke={pal.hadouken}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Bottom Controls: Live Tok/m + Spar Toggle */}
      <div className="w-full flex items-center justify-between gap-1 pt-1 border-t border-slate-800/80 z-10">
        <span className="text-[10px] font-mono text-indigo-300 truncate">
          {tokensPerMin > 0 ? `${tokensPerMin.toLocaleString()} tok/m` : '0 tok/m'}
        </span>
        <button
          type="button"
          onClick={() => setDemoFight(!demoFight)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
            fighting
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
          }`}
          title="Toggle combat animation preview"
        >
          <Swords className="w-2.5 h-2.5" />
          {demoFight ? 'Stop' : 'Fight!'}
        </button>
      </div>
    </div>
  )
}
