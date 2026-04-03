import { cn } from "@/lib/utils";

export function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA"/>
      <path d="M43.65 25.15L29.9 1.35c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5l16.15-28z" fill="#00AC47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.7c.8-1.4 1.2-2.95 1.2-4.5H59.8l6.1 11.8 7.65 11.8z" fill="#EA4335"/>
      <path d="M43.65 25.15L57.4 1.35a9.39 9.39 0 0 0-4.5-1.35H34.4c-1.6 0-3.15.45-4.5 1.35l13.75 23.8z" fill="#00832D"/>
      <path d="M59.8 53.15h-32.3L13.75 76.95c1.35.8 2.9 1.25 4.5 1.25h22.5c1.6 0 3.15-.45 4.5-1.25l14.55-23.8z" fill="#2684FC"/>
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25.15l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" fill="#FFBA00"/>
    </svg>
  );
}

export function OneDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.22 9.59c.46-.79 1.17-1.4 2.03-1.73a3.98 3.98 0 0 1 2.66-.05A5.49 5.49 0 0 0 9.4 6.1a4.46 4.46 0 0 1 4.82 3.49z" fill="#0364B8"/>
      <path d="M14.22 9.59A4.46 4.46 0 0 0 9.4 6.1a4.47 4.47 0 0 0-3.99 2.47A3.97 3.97 0 0 0 1 12.48a3.97 3.97 0 0 0 3.97 3.97h8.46l.79-6.86z" fill="#0078D4"/>
      <path d="M18.91 7.81a3.98 3.98 0 0 0-2.66.05 3.98 3.98 0 0 0-2.03 1.73l.79 6.86h5.96A3.01 3.01 0 0 0 24 13.44a3.01 3.01 0 0 0-3.01-3.01 2.96 2.96 0 0 0-.76.1l-.14-.04a3.98 3.98 0 0 0-1.18-2.68z" fill="#1490DF"/>
      <path d="M13.43 16.45H4.97A3.97 3.97 0 0 0 8.94 20.42h10.03A3.01 3.01 0 0 0 22 17.41a3.01 3.01 0 0 0-1.03-2.27l-7.54 1.31z" fill="#28A8EA"/>
    </svg>
  );
}

export function ConfluenceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 246" xmlns="http://www.w3.org/2000/svg">
      <linearGradient id="confluence-a" x1="99.14%" x2="33.86%" y1="112.95%" y2="37.78%" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#0052CC" />
        <stop offset=".92" stopColor="#2684FF" />
      </linearGradient>
      <linearGradient id="confluence-b" x1=".87%" x2="66.12%" y1="-13.04%" y2="62.08%" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#0052CC" />
        <stop offset=".92" stopColor="#2684FF" />
      </linearGradient>
      <path d="M9.26 187.73c-3.69 6.04-7.83 13.09-10.58 17.62a8.17 8.17 0 0 0 2.95 11.12l56.6 34.73a8.17 8.17 0 0 0 11.23-2.74c2.4-4.08 5.74-9.94 9.47-16.26 24.58-41.59 49.39-36.55 97.14-14.05l55.44 25.94a8.17 8.17 0 0 0 10.8-4.28l26.14-58.07a8.17 8.17 0 0 0-4.1-10.68c-13.65-6.37-40.75-19.06-59.87-28.03-68.2-32.14-126.61-36.14-195.22 44.7z" fill="url(#confluence-a)" />
      <path d="M246.74 58.4c3.69-6.05 7.83-13.1 10.58-17.63a8.17 8.17 0 0 0-2.95-11.12L197.77-5.08a8.17 8.17 0 0 0-11.23 2.74c-2.4 4.08-5.74 9.94-9.47 16.26-24.58 41.59-49.39 36.55-97.14 14.05L24.93 2.03A8.17 8.17 0 0 0 14.13 6.3L-12.01 64.38a8.17 8.17 0 0 0 4.1 10.68c13.65 6.37 40.75 19.06 59.87 28.03 68.18 32.12 126.59 36.12 194.78-44.69z" fill="url(#confluence-b)" />
    </svg>
  );
}

export function ProviderLogo({ provider, className }: { provider: string; className?: string }) {
  const size = className ?? "w-5 h-5";
  switch (provider) {
    case "google_drive": return <GoogleDriveLogo className={size} />;
    case "onedrive": return <OneDriveLogo className={size} />;
    case "confluence": return <ConfluenceLogo className={size} />;
    default: return <div className={cn(size, "rounded bg-slate-200 dark:bg-gray-700")} />;
  }
}
