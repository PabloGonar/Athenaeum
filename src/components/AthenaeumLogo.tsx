export function AthenaeumLogo({
  className = "h-5 w-5",
  framed = true,
}: {
  className?: string;
  framed?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      data-testid="athenaeum-logo-mark"
    >
      {framed && (
        <>
          <rect width="64" height="64" rx="12" fill="#0E131F" />
          <rect
            x="2.5"
            y="2.5"
            width="59"
            height="59"
            rx="9.5"
            fill="none"
            stroke="#E2B46D"
            strokeWidth="1.2"
            opacity="0.55"
          />
        </>
      )}
      {/* Finial & Lantern */}
      <line x1="32" y1="8.5" x2="32" y2="12" stroke="#E2B46D" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="32" cy="12.5" r="1.3" fill="#F6DA97" />
      <path d="M29 16 C29 14 35 14 35 16 Z" fill="#E2B46D" />
      {/* Classical Ribbed Dome */}
      <path
        d="M17.5 29 C17.5 19.5 23.8 16 32 16 C40.2 16 46.5 19.5 46.5 29 Z"
        fill="#E2B46D"
        opacity="0.16"
      />
      <path
        d="M17.5 29 C17.5 19.5 23.8 16 32 16 C40.2 16 46.5 19.5 46.5 29"
        fill="none"
        stroke="#E2B46D"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M23.5 29 C24.5 21 27.5 17 32 16.2" fill="none" stroke="#E2B46D" strokeWidth="0.9" opacity="0.7" />
      <path d="M40.5 29 C39.5 21 36.5 17 32 16.2" fill="none" stroke="#E2B46D" strokeWidth="0.9" opacity="0.7" />
      <line x1="32" y1="16.2" x2="32" y2="29" stroke="#E2B46D" strokeWidth="0.9" opacity="0.65" />
      {/* Pediment & Architrave */}
      <polygon points="32,25.5 18.5,32 45.5,32" fill="#0E131F" stroke="#E2B46D" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="16.5" y="32" width="31" height="2.4" rx="0.5" fill="#E2B46D" />
      {/* Six Colonnade Columns */}
      <g fill="#E2B46D">
        <rect x="18.8" y="35.2" width="2.2" height="13.8" rx="0.4" />
        <rect x="23.6" y="35.2" width="2.2" height="13.8" rx="0.4" />
        <rect x="28.4" y="35.2" width="2.2" height="13.8" rx="0.4" />
        <rect x="33.4" y="35.2" width="2.2" height="13.8" rx="0.4" />
        <rect x="38.2" y="35.2" width="2.2" height="13.8" rx="0.4" />
        <rect x="43.0" y="35.2" width="2.2" height="13.8" rx="0.4" />
      </g>
      {/* Stepped Stylobate */}
      <rect x="15.2" y="49.2" width="33.6" height="1.8" rx="0.5" fill="#E2B46D" />
      <rect x="13" y="51.8" width="38" height="2" rx="0.6" fill="#E2B46D" opacity="0.82" />
    </svg>
  );
}
