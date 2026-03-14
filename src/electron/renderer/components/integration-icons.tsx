import type { ReactElement } from "react";
import {
  SiNotion,
  SiLinear,
  SiGoogle,
  SiGithub,
} from "@icons-pack/react-simple-icons";

export type IconProps = { className?: string };
export type IconComponent = (props: IconProps) => ReactElement;

function wrapSimpleIcon(
  Icon: typeof SiNotion,
  defaultColor?: string,
): IconComponent {
  return function WrappedIcon({ className }: IconProps) {
    return <Icon className={className} color={defaultColor ?? "currentColor"} size="100%" />;
  };
}

export const NotionIcon = wrapSimpleIcon(SiNotion);
export const LinearIcon = wrapSimpleIcon(SiLinear, "#5E6AD2");
export const GoogleIcon = wrapSimpleIcon(SiGoogle);
export const GitHubIcon = wrapSimpleIcon(SiGithub);

export function SlackIcon({ className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zm2.521-10.123a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.123 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.123a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#4A154B" />
    </svg>
  );
}

const DOMAIN_ICONS: Array<{ pattern: RegExp; icon: IconComponent }> = [
  { pattern: /google\.|googleapis\.|gemini\./i, icon: GoogleIcon },
  { pattern: /github\.|copilot\.github\./i, icon: GitHubIcon },
  { pattern: /slack\./i, icon: SlackIcon },
  { pattern: /notion\./i, icon: NotionIcon },
  { pattern: /linear\./i, icon: LinearIcon },
];

export function resolveProviderIcon(url: string): IconComponent | null {
  try {
    const { hostname } = new URL(url);
    for (const { pattern, icon } of DOMAIN_ICONS) {
      if (pattern.test(hostname)) return icon;
    }
    return null;
  } catch {
    return null;
  }
}
