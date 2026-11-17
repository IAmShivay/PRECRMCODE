import type { SVGProps } from 'react';

export function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8A8.5 8.5 0 1 1 20.5 11.7Z" />
      <path d="m8.1 7.1 1.4-.1 1.1 2.6-1.1 1.2a7.6 7.6 0 0 0 3.7 3.7l1.2-1.1 2.6 1.1-.1 1.4c-.1.8-.9 1.4-1.7 1.3-4.5-.5-8-4-8.5-8.5-.1-.8.5-1.6 1.4-1.6Z" strokeWidth={1.4} />
    </svg>
  );
}

export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M13.2 20.4v-6.6h2.3l.4-2.7h-2.7V9.4c0-.8.3-1.3 1.4-1.3h1.4V5.7a17 17 0 0 0-2.1-.1c-2.1 0-3.4 1.2-3.4 3.5v2h-2.3v2.7h2.3v6.6" />
    </svg>
  );
}
