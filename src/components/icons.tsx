/**
 * 内联 SVG 图标集（参考 Alma 界面：线性图标、currentColor 继承）。
 * 统一 24 视口，尺寸由 CSS 控制，避免用文字符号（☰ ✕ ↻）导致的基线抖动。
 */
interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** 侧边栏面板：collapsed 决定箭头朝向（展开 vs 收起）。 */
export function IconPanel({ collapsed, size, className }: IconProps & { collapsed: boolean }) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
      {collapsed ? <path d="M13.5 9.5L16 12l-2.5 2.5" /> : <path d="M16 9.5L13.5 12l2.5 2.5" />}
    </Svg>
  )
}

export function IconSearch({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="15.8" y1="15.8" x2="20" y2="20" />
    </Svg>
  )
}

export function IconPlus({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  )
}

export function IconTasks({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 6.5l2 2 3.5-3.5" />
      <path d="M4 17l2 2 3.5-3.5" />
      <line x1="13" y1="6.5" x2="20" y2="6.5" />
      <line x1="13" y1="17" x2="20" y2="17" />
    </Svg>
  )
}

export function IconChat({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6z" />
    </Svg>
  )
}

export function IconSettings({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5" />
    </Svg>
  )
}

export function IconRefresh({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 11.5a8 8 0 1 0-2.3 6.4" />
      <path d="M20 5.5v6h-6" />
    </Svg>
  )
}

export function IconClose({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Svg>
  )
}

export function IconMore({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconChevron({ collapsed, size, className }: IconProps & { collapsed: boolean }) {
  return (
    <Svg size={size} className={className}>
      {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M6 9l6 6 6-6" />}
    </Svg>
  )
}
