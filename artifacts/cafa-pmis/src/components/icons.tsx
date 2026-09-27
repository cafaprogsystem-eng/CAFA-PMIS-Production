/**
 * The app's icons — HeroUI Pro's own set, Gravity UI (@gravity-ui/icons).
 *
 * Every icon in the app is imported from this module ("@/components/icons").
 * Export names are the ones the code already used (they came from lucide),
 * so call sites read the same; each maps to its Gravity equivalent below.
 * Gravity draws on a 16px grid, so the usual `size-4` / `h-4 w-4` classes
 * render it at its native size. Import each icon from its own file: the
 * package root re-exports all ~800 icons.
 *
 * Exceptions (the only ones allowed, enforced by ESLint and a test):
 *   Wheat, Handshake, Building2 — Gravity has no equivalent, so they stay on
 *   lucide, drawn with a 2.25 stroke (1.5px at 16px) to match Gravity's
 *   line weight.
 * Loading indicators (Loader2) render HeroUI's Spinner, as Pro does.
 */
import type { ComponentType, SVGProps } from "react";
import { Spinner } from "@heroui/react";
import {
  Building2 as LucideBuilding2,
  Handshake as LucideHandshake,
  Wheat as LucideWheat,
} from "lucide-react";

export type IconProps = SVGProps<SVGSVGElement>;
export type IconComponent = ComponentType<IconProps>;

/* ── Gravity UI ─────────────────────────────────────────────────────── */
export { default as Activity } from "@gravity-ui/icons/Pulse";
export { default as AlertCircle } from "@gravity-ui/icons/CircleExclamation";
export { default as AlertTriangle } from "@gravity-ui/icons/TriangleExclamation";
export { default as Apple } from "@gravity-ui/icons/Cherry";
export { default as Archive } from "@gravity-ui/icons/Archive";
export { default as ArrowLeft } from "@gravity-ui/icons/ArrowLeft";
export { default as ArrowRight } from "@gravity-ui/icons/ArrowRight";
export { default as ArrowUpDown } from "@gravity-ui/icons/ArrowUpArrowDown";
export { default as Ban } from "@gravity-ui/icons/Ban";
export { default as BarChart3 } from "@gravity-ui/icons/ChartColumn";
export { default as Bell } from "@gravity-ui/icons/Bell";
export { default as BookMarked } from "@gravity-ui/icons/Bookmark";
export { default as BookOpen } from "@gravity-ui/icons/BookOpen";
export { default as Bot } from "@gravity-ui/icons/FaceRobot";
export { default as BriefcaseBusiness } from "@gravity-ui/icons/Briefcase";
export { default as Calendar } from "@gravity-ui/icons/Calendar";
export { default as CalendarCheck } from "@gravity-ui/icons/Calendar";
export { default as CalendarClock } from "@gravity-ui/icons/Calendar";
export { default as CalendarDays } from "@gravity-ui/icons/Calendar";
export { default as Camera } from "@gravity-ui/icons/Camera";
export { default as ChartColumn } from "@gravity-ui/icons/ChartColumn";
export { default as ChartNoAxesColumn } from "@gravity-ui/icons/ChartColumn";
export { default as Check } from "@gravity-ui/icons/Check";
export { default as CheckCheck } from "@gravity-ui/icons/CheckDouble";
export { default as CheckCircle } from "@gravity-ui/icons/CircleCheck";
export { default as CheckCircle2 } from "@gravity-ui/icons/CircleCheck";
export { default as ChevronDown } from "@gravity-ui/icons/ChevronDown";
export { default as ChevronDownIcon } from "@gravity-ui/icons/ChevronDown";
export { default as ChevronLeft } from "@gravity-ui/icons/ChevronLeft";
export { default as ChevronLeftIcon } from "@gravity-ui/icons/ChevronLeft";
export { default as ChevronRight } from "@gravity-ui/icons/ChevronRight";
export { default as ChevronRightIcon } from "@gravity-ui/icons/ChevronRight";
export { default as ChevronsLeft } from "@gravity-ui/icons/ChevronsLeft";
export { default as ChevronsRight } from "@gravity-ui/icons/ChevronsRight";
export { default as ChevronsUpDown } from "@gravity-ui/icons/ChevronsExpandVertical";
export { default as ChevronUp } from "@gravity-ui/icons/ChevronUp";
export { default as Circle } from "@gravity-ui/icons/Circle";
export { default as CircleHelp } from "@gravity-ui/icons/CircleQuestion";
export { default as CircleOff } from "@gravity-ui/icons/BanDashed";
export { default as ClipboardCheck } from "@gravity-ui/icons/FileCheck";
export { default as ClipboardList } from "@gravity-ui/icons/ListCheck";
export { default as Clock } from "@gravity-ui/icons/Clock";
export { default as CloudOff } from "@gravity-ui/icons/CloudSlash";
export { default as Copy } from "@gravity-ui/icons/Copy";
export { default as Database } from "@gravity-ui/icons/Database";
export { default as DollarSign } from "@gravity-ui/icons/CircleDollar";
export { default as Download } from "@gravity-ui/icons/ArrowDownToLine";
export { default as DownloadCloud } from "@gravity-ui/icons/ArrowDownToLine";
export { default as Droplets } from "@gravity-ui/icons/Droplet";
export { default as Edit2 } from "@gravity-ui/icons/Pencil";
export { default as ExternalLink } from "@gravity-ui/icons/ArrowUpRightFromSquare";
export { default as Eye } from "@gravity-ui/icons/Eye";
export { default as EyeOff } from "@gravity-ui/icons/EyeSlash";
export { default as File } from "@gravity-ui/icons/File";
export { default as FileArchive } from "@gravity-ui/icons/FileZipper";
export { default as FileDown } from "@gravity-ui/icons/FileArrowDown";
export { default as FileImage } from "@gravity-ui/icons/CopyPicture";
export { default as Files } from "@gravity-ui/icons/Files";
export { default as FileSpreadsheet } from "@gravity-ui/icons/FileLetterX";
export { default as FileText } from "@gravity-ui/icons/FileText";
export { default as Filter } from "@gravity-ui/icons/Funnel";
export { default as FilterX } from "@gravity-ui/icons/FunnelXmark";
export { default as FolderKanban } from "@gravity-ui/icons/Folder";
export { default as FolderOpen } from "@gravity-ui/icons/FolderOpen";
export { default as Forward } from "@gravity-ui/icons/ArrowShapeTurnUpRight";
export { default as GalleryHorizontal } from "@gravity-ui/icons/Filmstrip";
export { default as GitMerge } from "@gravity-ui/icons/CodeMerge";
export { default as Globe } from "@gravity-ui/icons/Globe";
export { default as Hash } from "@gravity-ui/icons/Hashtag";
export { default as Heart } from "@gravity-ui/icons/Heart";
export { default as HelpCircle } from "@gravity-ui/icons/CircleQuestion";
export { default as History } from "@gravity-ui/icons/ClockArrowRotateLeft";
export { default as Home } from "@gravity-ui/icons/House";
export { default as House } from "@gravity-ui/icons/House";
export { default as Image } from "@gravity-ui/icons/Picture";
export { default as Info } from "@gravity-ui/icons/CircleInfo";
export { default as Kanban } from "@gravity-ui/icons/LayoutColumns3";
export { default as KeyRound } from "@gravity-ui/icons/Key";
export { default as Landmark } from "@gravity-ui/icons/Vault";
export { default as Layers } from "@gravity-ui/icons/Layers";
export { default as LayoutDashboard } from "@gravity-ui/icons/LayoutCellsLarge";
export { default as LayoutGrid } from "@gravity-ui/icons/LayoutCellsLarge";
export { default as LayoutList } from "@gravity-ui/icons/LayoutList";
export { default as Link2 } from "@gravity-ui/icons/Link";
export { default as List } from "@gravity-ui/icons/ListUl";
export { default as ListChecks } from "@gravity-ui/icons/ListCheck";
export { default as Lock } from "@gravity-ui/icons/Lock";
export { default as LogOut } from "@gravity-ui/icons/ArrowRightFromSquare";
export { default as Mail } from "@gravity-ui/icons/Envelope";
export { default as Map } from "@gravity-ui/icons/GeoPolygons";
export { default as MapPin } from "@gravity-ui/icons/MapPin";
export { default as Megaphone } from "@gravity-ui/icons/Megaphone";
export { default as Menu } from "@gravity-ui/icons/Bars";
export { default as MessageCircle } from "@gravity-ui/icons/Comment";
export { default as MessageSquare } from "@gravity-ui/icons/Comment";
export { default as Mic } from "@gravity-ui/icons/Microphone";
export { default as Minimize2 } from "@gravity-ui/icons/ChevronsCollapseUpRight";
export { default as Minus } from "@gravity-ui/icons/Minus";
export { default as MonitorSmartphone } from "@gravity-ui/icons/Display";
export { default as MoreHorizontal } from "@gravity-ui/icons/Ellipsis";
export { default as MoreVertical } from "@gravity-ui/icons/EllipsisVertical";
export { default as Network } from "@gravity-ui/icons/NodesDown";
export { default as Package } from "@gravity-ui/icons/Box";
export { default as PanelLeftIcon } from "@gravity-ui/icons/LayoutSideContentLeft";
export { default as Paperclip } from "@gravity-ui/icons/Paperclip";
export { default as Pause } from "@gravity-ui/icons/Pause";
export { default as PauseCircle } from "@gravity-ui/icons/CirclePause";
export { default as Pencil } from "@gravity-ui/icons/Pencil";
export { default as PieChart } from "@gravity-ui/icons/ChartPie";
export { default as PiggyBank } from "@gravity-ui/icons/Sack";
export { default as Pin } from "@gravity-ui/icons/Pin";
export { default as PinOff } from "@gravity-ui/icons/PinSlash";
export { default as Play } from "@gravity-ui/icons/Play";
export { default as Plus } from "@gravity-ui/icons/Plus";
export { default as PlusCircle } from "@gravity-ui/icons/CirclePlus";
export { default as RefreshCw } from "@gravity-ui/icons/ArrowsRotateRight";
export { default as Reply } from "@gravity-ui/icons/ArrowShapeTurnUpLeft";
export { default as RotateCcw } from "@gravity-ui/icons/ArrowRotateLeft";
export { default as Rows3 } from "@gravity-ui/icons/LayoutRows3";
export { default as Save } from "@gravity-ui/icons/FloppyDisk";
export { default as Scale } from "@gravity-ui/icons/ScalesBalanced";
export { default as Search } from "@gravity-ui/icons/Magnifier";
export { default as Send } from "@gravity-ui/icons/PaperPlane";
export { default as ServerCrash } from "@gravity-ui/icons/Server";
export { default as Settings } from "@gravity-ui/icons/Gear";
export { default as Settings2 } from "@gravity-ui/icons/Sliders";
export { default as Shield } from "@gravity-ui/icons/Shield";
export { default as ShieldAlert } from "@gravity-ui/icons/ShieldExclamation";
export { default as ShieldCheck } from "@gravity-ui/icons/ShieldCheck";
export { default as ShieldOff } from "@gravity-ui/icons/ShieldExclamation";
export { default as Smile } from "@gravity-ui/icons/FaceSmile";
export { default as Sparkles } from "@gravity-ui/icons/Sparkles";
export { default as Square } from "@gravity-ui/icons/Square";
export { default as Star } from "@gravity-ui/icons/Star";
export { default as StopCircle } from "@gravity-ui/icons/CircleStop";
export { default as Table2 } from "@gravity-ui/icons/LayoutCells";
export { default as Tag } from "@gravity-ui/icons/Tag";
export { default as Target } from "@gravity-ui/icons/Target";
export { default as ThumbsDown } from "@gravity-ui/icons/ThumbsDown";
export { default as ThumbsUp } from "@gravity-ui/icons/ThumbsUp";
export { default as ToggleLeft } from "@gravity-ui/icons/ToggleOff";
export { default as ToggleRight } from "@gravity-ui/icons/ToggleOn";
export { default as Trash2 } from "@gravity-ui/icons/TrashBin";
export { default as TrendingDown } from "@gravity-ui/icons/ChartLine";
export { default as TrendingUp } from "@gravity-ui/icons/ChartLineArrowUp";
export { default as TriangleAlert } from "@gravity-ui/icons/TriangleExclamation";
export { default as Upload } from "@gravity-ui/icons/ArrowUpFromLine";
export { default as UploadCloud } from "@gravity-ui/icons/CloudArrowUpIn";
export { default as User } from "@gravity-ui/icons/Person";
export { default as UserCheck } from "@gravity-ui/icons/Person";
export { default as UserCog } from "@gravity-ui/icons/PersonGear";
export { default as Users } from "@gravity-ui/icons/Persons";
export { default as Volume2 } from "@gravity-ui/icons/Volume";
export { default as Wallet } from "@gravity-ui/icons/Wallet";
export { default as WalletCards } from "@gravity-ui/icons/CreditCard";
export { default as Wifi } from "@gravity-ui/icons/AntennaSignal";
export { default as WifiOff } from "@gravity-ui/icons/CloudSlash";
export { default as Wrench } from "@gravity-ui/icons/Wrench";
export { default as X } from "@gravity-ui/icons/Xmark";
export { default as XCircle } from "@gravity-ui/icons/CircleXmark";
export { default as Zap } from "@gravity-ui/icons/Thunderbolt";

/* Filled variants, for the places that drew a filled lucide shape. */
export { default as CircleFill } from "@gravity-ui/icons/CircleFill";
export { default as StarFill } from "@gravity-ui/icons/StarFill";

/* ── lucide exceptions (no Gravity equivalent) ─────────────────────── */
export const Building2 = (props: IconProps) => <LucideBuilding2 strokeWidth={2.25} {...props} />;
export const Handshake = (props: IconProps) => <LucideHandshake strokeWidth={2.25} {...props} />;
export const Wheat = (props: IconProps) => <LucideWheat strokeWidth={2.25} {...props} />;

/* ── Loading ─────────────────────────────────────────────────────────── */
/** HeroUI Spinner in the current text colour; size it with the same classes. */
export const Loader2 = ({ className }: IconProps) => <Spinner color="current" className={className} />;
export const Loader2Icon = Loader2;
