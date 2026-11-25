// The mayor: a mini-the owner with a tall hat and a sash. Drawn here, not borrowed.
// mood tilts the mouth and the cheeks: "good" smiles, "tired" goes flat.
export default function Mayor({ size = 40, mood = "good" }: { size?: number; mood?: "good" | "tired" }) {
  const mouth = mood === "good" ? "M25 41 Q32 46 39 41" : "M26 43 L38 43";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="The mayor" style={{ flex: "none" }}>
      <circle cx="32" cy="32" r="31" fill="#e9e2d4" />
      {/* hat */}
      <rect x="21" y="6" width="22" height="16" rx="2" fill="#1b1a17" />
      <rect x="21" y="17" width="22" height="3" fill="#b8473a" />
      <rect x="15" y="21" width="34" height="4" rx="2" fill="#1b1a17" />
      {/* face */}
      <circle cx="32" cy="37" r="14" fill="#f2c9a5" />
      <path d="M19 33 Q22 25 32 25 Q42 25 45 33 Q40 28 32 29 Q24 28 19 33Z" fill="#3b2a20" />
      <circle cx="27" cy="36" r="1.8" fill="#1b1a17" />
      <circle cx="37" cy="36" r="1.8" fill="#1b1a17" />
      {mood === "good" && <circle cx="23.5" cy="41" r="2.2" fill="#e8a08a" opacity="0.6" />}
      {mood === "good" && <circle cx="40.5" cy="41" r="2.2" fill="#e8a08a" opacity="0.6" />}
      <path d={mouth} stroke="#1b1a17" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* sash */}
      <path d="M18 56 Q32 50 46 56 L46 63 L18 63Z" fill="#2f5d8a" />
      <path d="M22 53 L42 62" stroke="#d9b64a" strokeWidth="3" />
    </svg>
  );
}
