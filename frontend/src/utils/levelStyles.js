// Shared level chip color definitions
// bg uses low-opacity fill so chips work on both dark and light card backgrounds

export const LEVEL_STYLE = {
  International: { bg: 'rgba(168,85,247,0.15)', border: '#A855F7', text: '#A855F7' }, // neon purple
  Pro:           { bg: 'rgba(56,189,248,0.15)',  border: '#38BDF8', text: '#38BDF8' }, // sky blue
  Club:          { bg: 'rgba(34,197,94,0.15)',   border: '#22C55E', text: '#22C55E' }, // green
  College:       { bg: 'rgba(239,68,68,0.15)',   border: '#EF4444', text: '#EF4444' }, // red
  'High School': { bg: 'rgba(251,146,60,0.15)',  border: '#FB923C', text: '#FB923C' }, // orange-light
  Youth:         { bg: 'rgba(234,179,8,0.15)',   border: '#EAB308', text: '#EAB308' }, // yellow
  Masters:       { bg: 'rgba(148,163,184,0.15)', border: '#94A3B8', text: '#94A3B8' }, // slate
};

export const LEVEL_ORDER = ['International', 'Pro', 'Club', 'College', 'High School', 'Youth', 'Masters'];
