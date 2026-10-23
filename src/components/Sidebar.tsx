import {
  BookOpen,
  Home,
  Search,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { LogoMark } from "./LogoMark";

interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const primaryNavigation: NavigationItem[] = [
  { label: "Главная", to: "/", icon: Home, end: true },
  { label: "Поиск", to: "/search", icon: Search },
  { label: "Моя библиотека", to: "/library", icon: BookOpen },
];

const secondaryNavigation: NavigationItem[] = [
  { label: "Профиль", to: "/profile", icon: UserRound },
  { label: "Настройки", to: "/settings", icon: Settings },
];

function NavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;

  return (
    <NavLink
      aria-label={item.label}
      className={({ isActive }) =>
        [
          "group relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
          isActive
            ? "bg-violet-accent/14 text-violet-bright"
            : "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100",
        ].join(" ")
      }
      end={item.end}
      to={item.to}
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute inset-y-2 -left-3 w-0.5 rounded-full bg-violet-bright" />
          ) : null}
          <Icon
            aria-hidden="true"
            className="size-5 shrink-0"
            strokeWidth={1.8}
          />
          <span className="truncate max-[1120px]:sr-only">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/85 px-4 py-5 backdrop-blur-xl max-[1120px]:w-[76px] max-[1120px]:px-3">
      <div className="mb-8 flex items-center gap-3 px-1">
        <LogoMark />
        <div className="min-w-0 max-[1120px]:hidden">
          <p className="text-[17px] font-semibold tracking-tight text-white">
            AnimDesk
          </p>
          <p className="text-[11px] text-zinc-500">Личная библиотека</p>
        </div>
      </div>

      <nav
        aria-label="Основная навигация"
        className="flex flex-1 flex-col gap-1"
      >
        {primaryNavigation.map((item) => (
          <NavigationLink item={item} key={item.to} />
        ))}
      </nav>

      <nav
        aria-label="Профиль и настройки"
        className="flex flex-col gap-1 border-t border-white/[0.06] pt-4"
      >
        {secondaryNavigation.map((item) => (
          <NavigationLink item={item} key={item.to} />
        ))}
      </nav>

    </aside>
  );
}
