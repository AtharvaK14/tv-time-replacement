// The WatchTime brand mark: a minimal TV (near-white outline, antenna + legs)
// with a coral "W" on the screen — the same design as the app launcher icon
// (see scripts/build-app-icon.mjs) and favicon. Rendered with no background
// so it sits on any of the app's dark surfaces; colors are fixed brand
// values on purpose so it always reads correctly.
export default function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M 452 340 L 382 250 M 572 340 L 642 250" stroke="#F2F1EF" strokeWidth="22" />
      <path d="M 362 680 L 322 748 M 662 680 L 702 748" stroke="#F2F1EF" strokeWidth="22" />
      <rect x="262" y="340" width="500" height="340" rx="52" stroke="#F2F1EF" strokeWidth="28" />
      <path
        d="M 402 430 L 457 580 L 512 490 L 567 580 L 622 430"
        stroke="#FF4433"
        strokeWidth="36"
        strokeLinejoin="round"
      />
    </svg>
  );
}
