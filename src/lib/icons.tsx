/**
 * Vendored Lucide icons (replaces the `lucide-react` runtime dependency).
 * Geometry + render semantics copied verbatim from lucide-react v0.555.0 (ISC).
 * The base Icon + createIcon faithfully mirror lucide's Icon.js/createLucideIcon.js:
 * same defaults (24px, currentColor, strokeWidth 2, round caps/joins), same prop
 * API (size, color, strokeWidth, absoluteStrokeWidth, className), so call sites
 * (<Shield size={16} className="..." />) are unchanged. Regenerate via the
 * transform in DEPENDENCY_AUDIT.md Phase 4 if icons are added/removed.
 */
import {
  forwardRef,
  createElement,
  type ForwardRefExoticComponent,
  type ReactSVGElement,
  type RefAttributes,
  type SVGProps,
} from 'react';

export interface LucideProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}
export type LucideIcon = ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
type IconNode = [tag: string, attrs: Record<string, string | number>][];

const defaultAttributes = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const mergeClasses = (...classes: (string | undefined)[]) =>
  classes.filter((c, i, a) => Boolean(c) && c!.trim() !== '' && a.indexOf(c) === i).join(' ').trim();

const hasA11yProp = (props: Record<string, unknown>) => {
  for (const prop in props) {
    if (prop.startsWith('aria-') || prop === 'role' || prop === 'title') return true;
  }
  return false;
};

const Icon = forwardRef<SVGSVGElement, LucideProps & { iconNode: IconNode }>(
  ({ color = 'currentColor', size = 24, strokeWidth = 2, absoluteStrokeWidth, className = '', children, iconNode, ...rest }, ref) =>
    createElement(
      'svg',
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth,
        className: mergeClasses('lucide', className),
        ...(!children && !hasA11yProp(rest as Record<string, unknown>) ? { 'aria-hidden': 'true' } : {}),
        ...rest,
      },
      [
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...(Array.isArray(children) ? children : [children]),
      ] as ReactSVGElement[],
    ),
);
Icon.displayName = 'Icon';

const createIcon = (name: string, iconNode: IconNode): LucideIcon => {
  const Component = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) =>
    createElement(Icon, { ref, iconNode, className: mergeClasses(`lucide-${name}`, className), ...props }),
  );
  Component.displayName = name;
  return Component;
};

export const AlertCircle: LucideIcon = createIcon('alert-circle', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12","key":"1pkeuh"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16","key":"4dfq90"}]]);
export const AlertTriangle: LucideIcon = createIcon('alert-triangle', [["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","key":"wmoenq"}],["path",{"d":"M12 9v4","key":"juzpu7"}],["path",{"d":"M12 17h.01","key":"p32p05"}]]);
export const ArrowLeft: LucideIcon = createIcon('arrow-left', [["path",{"d":"m12 19-7-7 7-7","key":"1l729n"}],["path",{"d":"M19 12H5","key":"x3x0zl"}]]);
export const ArrowRight: LucideIcon = createIcon('arrow-right', [["path",{"d":"M5 12h14","key":"1ays0h"}],["path",{"d":"m12 5 7 7-7 7","key":"xquz4c"}]]);
export const AtSign: LucideIcon = createIcon('at-sign', [["circle",{"cx":"12","cy":"12","r":"4","key":"4exip2"}],["path",{"d":"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8","key":"7n84p3"}]]);
export const Check: LucideIcon = createIcon('check', [["path",{"d":"M20 6 9 17l-5-5","key":"1gmf2c"}]]);
export const CheckCircle: LucideIcon = createIcon('check-circle', [["path",{"d":"M21.801 10A10 10 0 1 1 17 3.335","key":"yps3ct"}],["path",{"d":"m9 11 3 3L22 4","key":"1pflzl"}]]);
export const ChevronDown: LucideIcon = createIcon('chevron-down', [["path",{"d":"m6 9 6 6 6-6","key":"qrunsl"}]]);
export const ChevronLeft: LucideIcon = createIcon('chevron-left', [["path",{"d":"m15 18-6-6 6-6","key":"1wnfg3"}]]);
export const ChevronRight: LucideIcon = createIcon('chevron-right', [["path",{"d":"m9 18 6-6-6-6","key":"mthhwq"}]]);
export const Copy: LucideIcon = createIcon('copy', [["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2","key":"17jyea"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2","key":"zix9uf"}]]);
export const Crown: LucideIcon = createIcon('crown', [["path",{"d":"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z","key":"1vdc57"}],["path",{"d":"M5 21h14","key":"11awu3"}]]);
export const Download: LucideIcon = createIcon('download', [["path",{"d":"M12 15V3","key":"m9g1x1"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","key":"ih7n3h"}],["path",{"d":"m7 10 5 5 5-5","key":"brsn70"}]]);
export const Eye: LucideIcon = createIcon('eye', [["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0","key":"1nclc0"}],["circle",{"cx":"12","cy":"12","r":"3","key":"1v7zrd"}]]);
export const EyeOff: LucideIcon = createIcon('eye-off', [["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49","key":"ct8e1f"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242","key":"151rxh"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143","key":"13bj9a"}],["path",{"d":"m2 2 20 20","key":"1ooewy"}]]);
export const Globe: LucideIcon = createIcon('globe', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","key":"13o1zl"}],["path",{"d":"M2 12h20","key":"9i4pu4"}]]);
export const Hash: LucideIcon = createIcon('hash', [["line",{"x1":"4","x2":"20","y1":"9","y2":"9","key":"4lhtct"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15","key":"vyu0kd"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21","key":"1ggp8o"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21","key":"weycgp"}]]);
export const HelpCircle: LucideIcon = createIcon('help-circle', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3","key":"1u773s"}],["path",{"d":"M12 17h.01","key":"p32p05"}]]);
export const Inbox: LucideIcon = createIcon('inbox', [["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12","key":"o97t9d"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z","key":"oot6mr"}]]);
export const Info: LucideIcon = createIcon('info', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"M12 16v-4","key":"1dtifu"}],["path",{"d":"M12 8h.01","key":"e9boi3"}]]);
export const Key: LucideIcon = createIcon('key', [["path",{"d":"m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4","key":"g0fldk"}],["path",{"d":"m21 2-9.6 9.6","key":"1j0ho8"}],["circle",{"cx":"7.5","cy":"15.5","r":"5.5","key":"yqb3hr"}]]);
export const KeyRound: LucideIcon = createIcon('key-round', [["path",{"d":"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z","key":"1s6t7t"}],["circle",{"cx":"16.5","cy":"7.5","r":".5","fill":"currentColor","key":"w0ekpg"}]]);
export const Lock: LucideIcon = createIcon('lock', [["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2","key":"1w4ew1"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4","key":"fwvmzm"}]]);
export const Menu: LucideIcon = createIcon('menu', [["path",{"d":"M4 5h16","key":"1tepv9"}],["path",{"d":"M4 12h16","key":"1lakjw"}],["path",{"d":"M4 19h16","key":"1djgab"}]]);
export const MessageCircle: LucideIcon = createIcon('message-circle', [["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719","key":"1sd12s"}]]);
export const MessageSquare: LucideIcon = createIcon('message-square', [["path",{"d":"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z","key":"18887p"}]]);
export const Pin: LucideIcon = createIcon('pin', [["path",{"d":"M12 17v5","key":"bb1du9"}],["path",{"d":"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z","key":"1nkz8b"}]]);
export const PinOff: LucideIcon = createIcon('pin-off', [["path",{"d":"M12 17v5","key":"bb1du9"}],["path",{"d":"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89","key":"znwnzq"}],["path",{"d":"m2 2 20 20","key":"1ooewy"}],["path",{"d":"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11","key":"c9qhm2"}]]);
export const Plus: LucideIcon = createIcon('plus', [["path",{"d":"M5 12h14","key":"1ays0h"}],["path",{"d":"M12 5v14","key":"s699le"}]]);
export const RefreshCw: LucideIcon = createIcon('refresh-cw', [["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","key":"v9h5vc"}],["path",{"d":"M21 3v5h-5","key":"1q7to0"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","key":"3uifl3"}],["path",{"d":"M8 16H3v5","key":"1cv678"}]]);
export const Search: LucideIcon = createIcon('search', [["path",{"d":"m21 21-4.34-4.34","key":"14j7rj"}],["circle",{"cx":"11","cy":"11","r":"8","key":"4ej97u"}]]);
export const Server: LucideIcon = createIcon('server', [["rect",{"width":"20","height":"8","x":"2","y":"2","rx":"2","ry":"2","key":"ngkwjq"}],["rect",{"width":"20","height":"8","x":"2","y":"14","rx":"2","ry":"2","key":"iecqi9"}],["line",{"x1":"6","x2":"6.01","y1":"6","y2":"6","key":"16zg32"}],["line",{"x1":"6","x2":"6.01","y1":"18","y2":"18","key":"nzw8ys"}]]);
export const Settings: LucideIcon = createIcon('settings', [["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915","key":"1i5ecw"}],["circle",{"cx":"12","cy":"12","r":"3","key":"1v7zrd"}]]);
export const Share2: LucideIcon = createIcon('share-2', [["circle",{"cx":"18","cy":"5","r":"3","key":"gq8acd"}],["circle",{"cx":"6","cy":"12","r":"3","key":"w7nqdw"}],["circle",{"cx":"18","cy":"19","r":"3","key":"1xt0gg"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49","key":"47mynk"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49","key":"1n3mei"}]]);
export const Shield: LucideIcon = createIcon('shield', [["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z","key":"oel41y"}]]);
export const Sparkles: LucideIcon = createIcon('sparkles', [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z","key":"1s2grr"}],["path",{"d":"M20 2v4","key":"1rf3ol"}],["path",{"d":"M22 4h-4","key":"gwowj6"}],["circle",{"cx":"4","cy":"20","r":"2","key":"6kqj1y"}]]);
export const Trash2: LucideIcon = createIcon('trash-2', [["path",{"d":"M10 11v6","key":"nco0om"}],["path",{"d":"M14 11v6","key":"outv1u"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6","key":"miytrc"}],["path",{"d":"M3 6h18","key":"d0wm0j"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2","key":"e791ji"}]]);
export const Upload: LucideIcon = createIcon('upload', [["path",{"d":"M12 3v12","key":"1x0j5s"}],["path",{"d":"m17 8-5-5-5 5","key":"7q97r8"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","key":"ih7n3h"}]]);
export const UserX: LucideIcon = createIcon('user-x', [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","key":"1yyitq"}],["circle",{"cx":"9","cy":"7","r":"4","key":"nufk8"}],["line",{"x1":"17","x2":"22","y1":"8","y2":"13","key":"3nzzx3"}],["line",{"x1":"22","x2":"17","y1":"8","y2":"13","key":"1swrse"}]]);
export const Users: LucideIcon = createIcon('users', [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","key":"1yyitq"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744","key":"16gr8j"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87","key":"kshegd"}],["circle",{"cx":"9","cy":"7","r":"4","key":"nufk8"}]]);
export const X: LucideIcon = createIcon('x', [["path",{"d":"M18 6 6 18","key":"1bl5f8"}],["path",{"d":"m6 6 12 12","key":"d8bk6v"}]]);
export const Zap: LucideIcon = createIcon('zap', [["path",{"d":"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z","key":"1xq2db"}]]);
