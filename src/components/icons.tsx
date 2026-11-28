// The app's icons, all from Lucide, behind one small name map so screens ask
// for a meaning ("closing", "rate") and not a particular drawing.
import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Boxes,
  Percent,
  Building2,
  ChartLine,
  Check,
  ChevronRight,
  FileText,
  Info,
  LayoutDashboard,
  Lock,
  Mail,
  Menu,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  TriangleAlert,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

const icons = {
  dashboard: LayoutDashboard,
  today: LayoutDashboard,
  closing: Lock,
  expenses: ReceiptText,
  settings: SlidersHorizontal,
  import: Upload,
  rate: ArrowLeftRight,
  reports: ChartLine,
  audit: ShieldCheck,
  team: Users,
  clients: Building2,
  info: Info,
  alert: TriangleAlert,
  cash: Banknote,
  door: Store,
  mail: Mail,
  file: FileText,
  menu: Menu,
  close: X,
  check: Check,
  arrow: ChevronRight,
  recipe: BookOpen,
  inventory: Boxes,
  foodCost: Percent,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={1.75} className={`shrink-0 ${className}`} aria-hidden />;
}
