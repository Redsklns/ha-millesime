/**
 * Millésime Card v6.1.1
 * Cave à vin pour Home Assistant
 * - Recherche texte avec suggestions temps réel
 * - Lecture d'étiquette par photo (Gemini Vision)
 * - Messages d'erreur pro : quota, clé invalide, indisponibilité
 * - Journal de dégustation, recherche dans la cave, déplacement de casier
 */

const MILLESIME_CARD_VERSION = "6.1.1";

const DOMAIN = "millesime";

const WINE_TYPES = {
  red:       { color: "#C0392B", glow: "rgba(192,57,43,0.6)",   label: "Rouge",        emoji: "🔴" },
  white:     { color: "#D4AC0D", glow: "rgba(212,172,13,0.5)",  label: "Blanc",        emoji: "🟡" },
  rose:      { color: "#E8607A", glow: "rgba(232,96,122,0.5)",  label: "Rosé",         emoji: "🌸" },
  sparkling: { color: "#2E5C3B", glow: "rgba(46,92,59,0.55)",   label: "Effervescent", emoji: "✨" },
  dessert:   { color: "#C47820", glow: "rgba(196,120,32,0.5)",  label: "Liquoreux",    emoji: "🍯" },
};

const EVENT_TYPES = [
  { v: "",              l: "— Non défini —",   emoji: "" },
  { v: "no_touch",      l: "Ne pas toucher",   emoji: "🚫" },
  { v: "keep",          l: "À garder",         emoji: "📦" },
  { v: "special",       l: "Grande occasion",  emoji: "🎉" },
  { v: "small_occasion",l: "Petite Occasion",   emoji: "🥂" },
  { v: "table",         l: "Vin de table",     emoji: "🍽️" },
];
const EVENT_LABEL = Object.fromEntries(EVENT_TYPES.map(e => [e.v, e]));

// Messages d'erreur affichés à l'utilisateur selon le code retourné par le backend
const ERROR_MESSAGES = {
  quota_exceeded:      "⚠️ Quota Gemini dépassé (1 500/jour). Les résultats viennent d'Open Food Facts — ajoutez votre clé demain ou vérifiez votre quota sur aistudio.google.com.",
  invalid_key:         "🔑 Clé Gemini invalide ou expirée. Allez dans Paramètres → Appareils → Millésime → ⚙️ pour la mettre à jour.",
  service_unavailable: "🔄 Gemini temporairement indisponible. Les résultats viennent d'Open Food Facts.",
  parse_error:         "⚠️ Réponse Gemini inattendue. Réessayez ou remplissez manuellement.",
  no_key:              "ℹ️ Résultats Open Food Facts. Configurez une clé Gemini pour obtenir notes de dégustation et accords mets-vins.",
  no_wine_found:       "📷 Aucune étiquette de vin reconnue. Assurez-vous que l'étiquette est nette et bien éclairée.",
};

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = url => /^https?:\/\//i.test(url ?? "") ? url : "#";
// Mobile/tactile : sur ces appareils on ouvre DIRECTEMENT l'appareil photo (caméra
// arrière) via l'attribut `capture`. Sur desktop, on laisse le sélecteur de fichier
// classique (capture ignoré/indésirable). Détection volontairement conservatrice.
const _isMobile = () => {
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
      || ((navigator.maxTouchPoints || 0) > 0 && matchMedia("(pointer: coarse)").matches);
  } catch (e) { return false; }
};

// Profils de bouteilles [rayon, hauteur] — SOURCE UNIQUE des deux vues : la 3D
// les tourne (LatheGeometry), la 2D les projette à plat (silhouette SVG). Par type :
// rouge → bourguignonne, blanc → flûte (Alsace), rosé → bordelaise, effervescent →
// champenoise, liquoreux → ligérienne. Toutes les bouteilles sont en verre
// transparent (le vin est visible au travers) — seuls les profils diffèrent.
// Diamètre max STRICTEMENT identique partout (normalisation BOTTLE_R ci-dessous) :
// seules les silhouettes diffèrent, l'espacement entre bouteilles reste constant.
const BOTTLE_PROFILES = {
  // Bordelaise : fût droit élancé, épaule marquée, goulot long et fin avec bague
  bordeaux: [
    [0.00, 0.30], [0.19, 0.12], [0.32, 0.05], [0.405, 0.03], [0.44, 0.12], [0.445, 0.35],
    [0.445, 1.90], [0.435, 2.10], [0.40, 2.30], [0.33, 2.47], [0.24, 2.61], [0.17, 2.73],
    [0.14, 2.85], [0.132, 3.48], [0.13, 3.62], [0.155, 3.65], [0.155, 3.71], [0.14, 3.72],
    [0.00, 3.72],
  ],
  // Champenoise : verre épais, fût bombé (point le plus large au tiers bas),
  // épaule pleine, pente en S continue jusqu'au goulot épais
  champagne: [
    [0.00, 0.34], [0.21, 0.14], [0.35, 0.06], [0.445, 0.04], [0.475, 0.16], [0.485, 0.45],
    [0.49, 0.95], [0.485, 1.30], [0.465, 1.62], [0.43, 1.94], [0.375, 2.24], [0.305, 2.52],
    [0.235, 2.78], [0.185, 3.02], [0.16, 3.56], [0.18, 3.60], [0.18, 3.72], [0.155, 3.73],
    [0.00, 3.73],
  ],
  // Flûte élancée type Alsace : très fuselée — fût court, fuite continue
  // sur presque toute la hauteur (disponible mais non mappée par défaut)
  flute: [
    [0.00, 0.14], [0.20, 0.07], [0.33, 0.04], [0.405, 0.03], [0.43, 0.10], [0.435, 0.55],
    [0.435, 1.10], [0.415, 1.60], [0.365, 2.10], [0.295, 2.55], [0.225, 2.95], [0.165, 3.25],
    [0.125, 3.62], [0.15, 3.65], [0.15, 3.71], [0.135, 3.72],
    [0.00, 3.72],
  ],
  // Rosé : bordelaise au col allongé — fût droit plus court, épaule adoucie,
  // long goulot fin (type rosé de Provence/Loire)
  rose: [
    [0.00, 0.28], [0.19, 0.11], [0.32, 0.05], [0.405, 0.03], [0.44, 0.12], [0.445, 0.35],
    [0.445, 1.55], [0.43, 1.76], [0.385, 1.97], [0.305, 2.18], [0.225, 2.37], [0.165, 2.55],
    [0.138, 2.72], [0.13, 3.48], [0.128, 3.62], [0.152, 3.65], [0.152, 3.71], [0.138, 3.72],
    [0.00, 3.72],
  ],
  // Bourguignonne (rouge) : corps large, longue épaule conique
  bourgogne: [
    [0.00, 0.26], [0.20, 0.10], [0.34, 0.05], [0.435, 0.03], [0.465, 0.12], [0.47, 0.35],
    [0.47, 1.53], [0.455, 1.78], [0.42, 2.08], [0.36, 2.38], [0.28, 2.63], [0.21, 2.85],
    [0.16, 3.05], [0.14, 3.25], [0.135, 3.62], [0.16, 3.65], [0.16, 3.71], [0.145, 3.72],
    [0.00, 3.72],
  ],
  // Ligérienne (liquoreux) : épaule douce — type Anjou / Vouvray
  loire: [
    [0.00, 0.18], [0.19, 0.08], [0.32, 0.04], [0.405, 0.03], [0.435, 0.10], [0.44, 0.45],
    [0.44, 1.67], [0.425, 1.95], [0.375, 2.30], [0.29, 2.59], [0.205, 2.83], [0.15, 3.07],
    [0.128, 3.58], [0.15, 3.62], [0.15, 3.71], [0.135, 3.72],
    [0.00, 3.72],
  ],
};
const TYPE_SHAPE = { red: "bourgogne", white: "flute", rose: "rose", sparkling: "champagne", dessert: "loire" };

// Rayon de fût COMMUN : toutes les bouteilles ont le même diamètre max — l'espacement
// entre deux bouteilles est donc constant, quel que soit leur sens (tête-bêche ou non).
// Chaque profil est normalisé radialement à la lecture (2D comme 3D).
const BOTTLE_R = 0.43;
const _normProfile = (pts) => {
  const k = BOTTLE_R / Math.max(...pts.map((p) => p[0]));
  return pts.map(([r, y]) => [+(r * k).toFixed(3), y]);
};

// Projection à plat d'un profil 3D → silhouette SVG (viewBox 10×26) + repères
// d'habillage calculés (largeur de col/fût, haut et bas d'épaule).
const SX2D = 8.54, TOP2D = 2.55, BOT2D = 23.6;
const _shape2d = (kind) => {
  const pts = _normProfile(BOTTLE_PROFILES[kind]);
  const H = pts[pts.length - 1][1];
  const k = (BOT2D - TOP2D) / H;
  const y2 = (y) => +(BOT2D - y * k).toFixed(2);
  const body = pts.slice(1, -1);            // sans l'apex du punt ni le centre du goulot
  const maxR = Math.max(...body.map((p) => p[0]));
  const up = body.map(([r, y]) => `L${+(5 - r * SX2D).toFixed(2)},${y2(y)}`);
  const dn = [...body].reverse().map(([r, y]) => `L${+(5 + r * SX2D).toFixed(2)},${y2(y)}`);
  const d = `M${+(5 - body[0][0] * SX2D).toFixed(2)},${y2(body[0][1])} ${up.slice(1).join(" ")} ${dn.join(" ")} Z`;
  // Col = rayon minimal du goulot ; épaule : bas = dernier point au rayon max,
  // haut = premier point qui rejoint le rayon du col
  const neckR = Math.min(...body.filter(([r, y]) => y > H * 0.75 && y < H * 0.985).map((p) => p[0]));
  let iBody = 0;
  body.forEach((p, i) => { if (p[0] >= maxR * 0.96) iBody = i; });
  let iNeck = body.findIndex((p, i) => i > iBody && p[0] <= neckR * 1.18);
  if (iNeck < 0) iNeck = body.length - 2;
  return { d, nw: +(neckR * SX2D).toFixed(2), bw: +(maxR * SX2D).toFixed(2),
           shTop: y2(body[iNeck][1]), shBot: y2(body[iBody][1]) };
};
const BOTTLE_SHAPES = {};
for (const kind of Object.keys(BOTTLE_PROFILES)) BOTTLE_SHAPES[kind] = _shape2d(kind);
// Teinte du verre — TOUTES les bouteilles sont en verre transparent, le vin
// (couleur du type) est visible au travers
// Le verre du rouge est vert antique sombre et peu transparent (comme celui de
// l'effervescent) ; blanc/rosé/liquoreux restent en verre clair
// Verre du rouge : vert FROID (part de bleu) — un vert jauni multiplié par une
// robe grenat fabrique du marron
const GLASS_TINT = { red: "#3E5C4A", white: "#E4DDB0", rose: "#F0E6DC", sparkling: "#2F4A26", dessert: "#F2EEE0" };
// Force du filtre du verre (voile multiplicatif, partagé 2D/3D) — défaut 0.42
const GLASS_VOILE = { sparkling: 0.62 };
// Couleur du vin DANS la bouteille (≠ couleur d'accent UI du type) : choisie pour
// rester juste une fois filtrée par la teinte du verre — grenat à sous-ton bleuté
// pour le rouge (sinon marron sous verre vert), saumon pâle pour le rosé, paille
// pour l'effervescent (l'or vif virait au vert pomme), miel pour le liquoreux
// Rouge : robe sombre type photo de référence (presque noire, relevée par les
// reflets) — la capsule, elle, reste rouge vif pour identifier le type
const WINE_IN = { red: "#A81226", white: "#F2E2A2", rose: "#E2795F", sparkling: "#D9C883", dessert: "#C9881C" };
// Opacité de la robe — UNIQUE pour 2D et 3D. Référence photo : le rouge est quasi
// opaque, le rosé un peu plus transparent, le blanc encore plus (l'effervescent
// suit le blanc, le liquoreux le rosé)
// (assez denses pour que le fond sombre ne ternisse pas les robes claires)
const WINE_OPACITY = { red: 0.95, sparkling: 0.92, dessert: 0.88, rose: 0.80, white: 0.78 };

// Format de bouteille → facteurs d'échelle du rendu. L'ENTRAXE NE CHANGE JAMAIS :
// le rayon est borné par le jour entre bouteilles (magnum ×1.12 max → jour 0.03),
// la longueur par la profondeur de planche (×1.05 max). Le Ø croît moins vite que
// le volume (exposant 0.4).
const sizeLiters = (size) => {
  const s = String(size || "").toLowerCase().replace(",", ".").trim();
  const m = s.match(/([\d.]+)\s*(cl|ml|l)?/);
  if (!m) return 0.75;
  let v = parseFloat(m[1]);
  if (isNaN(v) || v <= 0) return 0.75;
  const unit = m[2] || (v >= 10 ? "cl" : "l");
  if (unit === "cl") v /= 100;
  else if (unit === "ml") v /= 1000;
  return v;
};
const sizeScale = (size) => {
  const v = sizeLiters(size) / 0.75;
  const clamp = (lo, x, hi) => Math.min(hi, Math.max(lo, x));
  // Exposant 0.5 : les petits formats (50 cl → ×0.82, 37,5 cl → ×0.76) s'affinent
  // nettement. Plafond magnum ×1.22 : maximum sans contact — deux magnums côte à
  // côte gardent un jour de 0.011 (limite de contact : ×1.2326 pour l'entraxe 1.06)
  return { r: clamp(0.76, Math.pow(v, 0.5), 1.22), l: clamp(0.90, Math.pow(v, 0.18), 1.05) };
};

// ── Identité visuelle par casier ────────────────────────────────────────────────
// Attribution déterministe par index : essence de bois + liseré d'accent + type de
// cadre (3D). Partagé 2D/3D. (`lt` = bois clair → texte sombre sur le bandeau.)
const RACK_WOODS = [
  { name: "chêne",    top: "#E2C290", side: "#B8905C", dark: "#7A5C38", lt: true  },
  { name: "noyer",    top: "#9C6B45", side: "#6E4A2E", dark: "#43291A", lt: false },
  { name: "merisier", top: "#C98B5E", side: "#9C6238", dark: "#6B4023", lt: false },
  { name: "grisé",    top: "#B9AE9F", side: "#8E8475", dark: "#5F574B", lt: true  },
  { name: "wengé",    top: "#6B5138", side: "#4A3623", dark: "#2A1E12", lt: false },
];
const RACK_ACCENTS = ["#C9A84C", "#B03A48", "#4A7FA5", "#5B8C5A", "#C97B4A", "#7B5EA7"];
// "iron" = cave en fer forgé : étagères en métal sombre, montants ronds à boules,
// lisses avant — l'essence de bois du casier est alors ignorée
const RACK_FRAMES  = ["posts", "iron", "cross", "box", "legs"];
const rackStyleOf = (i) => ({
  wood:   RACK_WOODS[i % RACK_WOODS.length],
  accent: RACK_ACCENTS[i % RACK_ACCENTS.length],
  frame:  RACK_FRAMES[i % RACK_FRAMES.length],
});
// Clés de config YAML insensibles à la casse et aux accents : "Chêne" → "chene"
const normKey = (s) => String(s ?? "").trim().toLowerCase()
  .normalize("NFD").replace(/\p{Diacritic}/gu, "");

let _bmUid = 0;
const BOTTLE_MINI = (color, w = null, type = "red", flipped = false, size = null) => {
  const sp = BOTTLE_SHAPES[TYPE_SHAPE[type] || "bordeaux"];
  // Échelle du format (magnum/demi) : la bouteille change de taille DANS sa
  // cellule (ancrée au culot), la grille ne bouge pas
  const sc = sizeScale(size);
  const tf = (sc.r !== 1 || sc.l !== 1)
    ? `transform:scale(${sc.r.toFixed(3)},${sc.l.toFixed(3)});transform-origin:50% 100%;`
    : "";
  const { d: glass, nw, bw, shTop, shBot } = sp; // silhouette projetée du profil 3D
  const cid = "bm" + (++_bmUid);
  const f = (n) => +n.toFixed(2);
  const nL = f(5 - nw), nR = f(5 + nw), bL = f(5 - bw), bR = f(5 + bw);
  const isCh = type === "sparkling";
  const tint = GLASS_TINT[type];           // verre transparent : blanc, rosé, liquoreux
  const lblY = f(shBot + (22.5 - shBot) * 0.40);   // étiquette sur le bas du fût
  const lblH = 4.3, lblX = f(bL + 0.55), lblW = f(bw * 2 - 1.1);
  const colY = f(shTop - 1.45);                    // collerette juste au-dessus de l'épaule
  return `<svg class="dot-svg-b" viewBox="0 0 10 26" xmlns="http://www.w3.org/2000/svg" style="${w ? `width:${w}px;height:${Math.round(w * 2.6)}px` : 'width:100%;height:auto'};display:block;${tf}">
  <defs><clipPath id="${cid}"><path d="${glass}"/></clipPath></defs>
  <!-- Ombre au sol -->
  <ellipse cx="5" cy="25.3" rx="${f(bw * 0.92)}" ry="0.65" fill="black" opacity="0.38"/>
  <!-- Corps en verre -->
  ${tint ? `
  <path d="${glass}" fill="${tint}" opacity="0.40"/>
  <rect x="0" y="${f(shTop + 1.1)}" width="10" height="22" fill="${WINE_IN[type] || color}" opacity="${WINE_OPACITY[type] ?? 0.88}" clip-path="url(#${cid})"/>
  <!-- On voit le vin À TRAVERS le verre : voile multiplicatif de la teinte par-dessus -->
  <path d="${glass}" fill="${tint}" style="mix-blend-mode:multiply" opacity="${GLASS_VOILE[type] ?? 0.42}"/>
  <path d="${glass}" fill="none" stroke="${tint}" stroke-width="0.22" opacity="0.8"/>` : `
  <path d="${glass}" fill="${color}"/>
  ${isCh ? `<path d="${glass}" fill="black" opacity="0.30"/>` : ""}`}
  <!-- Reflets / ombres (clippés sur la silhouette) -->
  <rect x="${bL}" y="0" width="1.3" height="26" fill="white" opacity="${tint ? 0.24 : 0.14}" clip-path="url(#${cid})"/>
  <rect x="${f(bR - 1.5)}" y="0" width="1.5" height="26" fill="black" opacity="0.18" clip-path="url(#${cid})"/>
  <path d="M${f(bL + 0.85)},${f(shBot + 0.5)} Q${f(bL + 0.45)},17.5 ${f(bL + 0.85)},22.3" stroke="white" stroke-width="0.5" fill="none" stroke-linecap="round" opacity="0.55"/>
  <!-- Fond + piqûre -->
  <ellipse cx="5" cy="23.1" rx="${f(bw * 0.97)}" ry="1.0" fill="black" opacity="0.26" clip-path="url(#${cid})"/>
  ${isCh ? `
  <!-- Coiffe d'effervescent : rebord, tête de bouchon champignon (liège ombré), muselet -->
  <ellipse cx="5" cy="0.85" rx="${f(nw + 0.55)}" ry="0.62" fill="${color}"/>
  <ellipse cx="5" cy="0.74" rx="${f(nw + 0.45)}" ry="0.48" fill="white" opacity="0.20"/>
  <ellipse cx="5" cy="0.5" rx="${f(nw * 0.80)}" ry="0.48" fill="#C8A165"/>
  <ellipse cx="${f(5 + nw * 0.22)}" cy="0.64" rx="${f(nw * 0.62)}" ry="0.32" fill="#8B6B42" opacity="0.42"/>
  <ellipse cx="${f(5 - nw * 0.24)}" cy="0.32" rx="${f(nw * 0.42)}" ry="0.18" fill="white" opacity="0.34"/>
  <circle cx="${f(5 - nw * 0.38)}" cy="0.58" r="0.07" fill="#8B6B42" opacity="0.65"/>
  <circle cx="${f(5 + nw * 0.10)}" cy="0.36" r="0.06" fill="#8B6B42" opacity="0.55"/>
  <circle cx="${f(5 + nw * 0.45)}" cy="0.50" r="0.07" fill="#8B6B42" opacity="0.6"/>
  <path d="M${f(5 - nw * 0.78)},0.62 Q5,1.06 ${f(5 + nw * 0.78)},0.62" stroke="#7A5C38" stroke-width="0.14" fill="none" opacity="0.55"/>
  <!-- Muselet : brins par-dessus la tête + plaque -->
  <path d="M${f(5 - nw * 0.76)},0.94 Q${f(5 - nw * 0.70)},0.26 ${f(5 - 0.28)},0.20" stroke="#938A75" stroke-width="0.10" fill="none" opacity="0.9"/>
  <path d="M${f(5 + nw * 0.76)},0.94 Q${f(5 + nw * 0.70)},0.26 ${f(5 + 0.28)},0.20" stroke="#938A75" stroke-width="0.10" fill="none" opacity="0.9"/>
  <path d="M5,1.02 L5,0.34" stroke="#938A75" stroke-width="0.10" opacity="0.75"/>
  <ellipse cx="5" cy="0.26" rx="0.38" ry="0.18" fill="#C9A84C" stroke="#7A5C38" stroke-width="0.07"/>
  <rect x="${f(5 - nw - 0.32)}" y="0.9" width="${f((nw + 0.32) * 2)}" height="${f(shTop - 2.3)}" rx="0.45" fill="${color}"/>
  <rect x="${f(5 - nw - 0.32)}" y="0.9" width="1.0" height="${f(shTop - 2.3)}" fill="white" opacity="0.22"/>
  <rect x="${f(5 + nw - 0.55)}" y="0.9" width="0.87" height="${f(shTop - 2.3)}" fill="black" opacity="0.22"/>
  <line x1="${f(5 - nw - 0.32)}" y1="1.9" x2="${f(5 + nw + 0.32)}" y2="1.9" stroke="black" stroke-width="0.22" opacity="0.35"/>
  <!-- Collerette -->
  <rect x="${f(5 - nw - 0.34)}" y="${f(shTop - 1.55)}" width="${f((nw + 0.34) * 2)}" height="0.95" fill="#F2E8D5" opacity="0.95"/>
  <line x1="${f(5 - nw - 0.34)}" y1="${f(shTop - 0.82)}" x2="${f(5 + nw + 0.34)}" y2="${f(shTop - 0.82)}" stroke="${color}" stroke-width="0.3"/>` : `
  <!-- Bouchon de liège dépassant -->
  <rect x="${f(5 - nw * 0.72)}" y="0.12" width="${f(nw * 1.44)}" height="0.95" rx="0.3" fill="#C8A165"/>
  <rect x="${f(5 - nw * 0.72)}" y="0.12" width="0.5" height="0.95" fill="white" opacity="0.25"/>
  <!-- Capsule sur le col -->
  <rect x="${f(5 - nw - 0.22)}" y="0.95" width="${f((nw + 0.22) * 2)}" height="2.0" rx="0.4" fill="${color}"/>
  <rect x="${f(5 - nw - 0.22)}" y="0.95" width="${f((nw + 0.22) * 2)}" height="2.0" rx="0.4" fill="black" opacity="0.32"/>
  <rect x="${f(5 - nw - 0.22)}" y="0.95" width="0.8" height="2.0" fill="white" opacity="0.2"/>
  <line x1="${f(5 - nw - 0.22)}" y1="1.6" x2="${f(5 + nw + 0.22)}" y2="1.6" stroke="black" stroke-width="0.22" opacity="0.3"/>
  <line x1="${f(5 - nw - 0.22)}" y1="2.3" x2="${f(5 + nw + 0.22)}" y2="2.3" stroke="black" stroke-width="0.22" opacity="0.3"/>
  <!-- Collerette -->
  <rect x="${f(nL - 0.16)}" y="${colY}" width="${f((nw + 0.16) * 2)}" height="0.85" fill="#F2E8D5" opacity="0.92"/>
  <line x1="${f(nL - 0.16)}" y1="${f(colY + 0.62)}" x2="${f(nR + 0.16)}" y2="${f(colY + 0.62)}" stroke="${color}" stroke-width="0.28"/>`}
  <!-- Étiquette (bas du fût) : blason + fausses écritures. Sur une bouteille
       tête-bêche (SVG pivoté de 180° en CSS), le contenu est pré-pivoté pour
       que le texte reste à l'endroit. -->
  <g${flipped ? ` transform="rotate(180 5 ${f(lblY + lblH / 2)})"` : ""}>
  <rect x="${f(lblX + 0.3)}" y="${f(lblY + 0.3)}" width="${lblW}" height="${lblH}" rx="0.5" fill="black" opacity="0.28"/>
  <rect x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" rx="0.5" fill="white" opacity="0.9"/>
  <!-- Couronne -->
  <path d="M4.62,${f(lblY + 0.42)} l0.18,-0.22 l0.2,0.18 l0.18,-0.18 l0.2,0.22 Z" fill="#C9A84C" opacity="0.95"/>
  <!-- Écu avec bande diagonale -->
  <path d="M4.55,${f(lblY + 0.5)} h0.9 v0.55 q0,0.45 -0.45,0.62 q-0.45,-0.17 -0.45,-0.62 Z" fill="${color}" opacity="0.9"/>
  <line x1="4.62" y1="${f(lblY + 0.58)}" x2="5.38" y2="${f(lblY + 1.32)}" stroke="white" stroke-width="0.16" opacity="0.7"/>
  <!-- Fausses écritures -->
  <rect x="${f(5 - lblW * 0.26)}" y="${f(lblY + 1.9)}" width="${f(lblW * 0.52)}" height="0.4" rx="0.2" fill="#4A3F30" opacity="0.85"/>
  <rect x="${f(5 - lblW * 0.34)}" y="${f(lblY + 2.55)}" width="${f(lblW * 0.68)}" height="0.2" rx="0.1" fill="#8A7D68" opacity="0.8"/>
  <rect x="${f(5 - lblW * 0.20)}" y="${f(lblY + 3.0)}" width="${f(lblW * 0.40)}" height="0.2" rx="0.1" fill="#8A7D68" opacity="0.8"/>
  <rect x="${f(5 - lblW * 0.27)}" y="${f(lblY + 3.55)}" width="${f(lblW * 0.54)}" height="0.24" rx="0.1" fill="${color}" opacity="0.7"/>
  </g>
</svg>`;
};

// Bouteille fantôme pour les emplacements vides (mode bottle)
const BOTTLE_GHOST = (w = null) => `<svg class="dot-svg-b" viewBox="0 0 10 26" xmlns="http://www.w3.org/2000/svg" style="${w ? `width:${w}px;height:${Math.round(w*2.6)}px` : 'width:100%;height:auto'};display:block">
  <rect x="3.5" y="0.2" width="3" height="2.4" rx="0.9" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" stroke-dasharray="1.2 0.7"/>
  <rect x="3.8" y="2.5" width="2.4" height="4.2" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" stroke-dasharray="1.2 0.7"/>
  <path d="M3.8,6.7 Q2.4,9.8 1.2,11.2 Q0.8,17 1.2,23 L8.8,23 Q9.2,17 8.8,11.2 Q7.6,9.8 6.2,6.7 Z" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" stroke-dasharray="1.2 0.7"/>
  <ellipse cx="5" cy="23" rx="3.8" ry="1" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
</svg>`;

const GLASS_SVG = `<svg viewBox="0 0 40 56" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 2 Q8 20 20 30 Q32 20 32 2 Z" fill="#C0392B" opacity="0.92"/>
  <path d="M11 6 Q11 19 20 28" fill="none" stroke="#E74C3C" stroke-width="1" opacity="0.35"/>
  <path d="M14 22 Q17 27 20 29 Q23 27 26 22" fill="#922B21" opacity="0.5"/>
  <rect x="18.5" y="30" width="3" height="17" rx="1.5" fill="#7B241C"/>
  <ellipse cx="20" cy="48" rx="8" ry="2.2" fill="#6E2118"/>
</svg>`;

// ── Ombres de la vue 3D : deux implémentations conservées, au choix ───────────
// false (DÉFAUT, ACTIF) : ombre de CONTACT — un halo radial léger posé sous chaque
//   bouteille. Quasi gratuit en GPU (recommandé, surtout mobile/WebView).
// true  (INACTIF)        : ombres PCF PROJETÉES — vraie shadow map 2048² (bouteilles,
//   planches, cadre, ombres inter-étagères, directionnelles). Plus réaliste mais
//   lourd : c'est ce qui saturait le contexte WebGL (pertes de contexte / crash).
// Le code des DEUX modes est présent ci-dessous, gardé par cette constante :
// passer à `true` réactive intégralement les ombres PCF, sans rien réécrire.
const SHADOWS_3D_PCF = false;

// ── Classe principale ──────────────────────────────────────────────────────────

class MillesimeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass       = null;
    this._data       = null;
    this._filter     = "all";
    this._filterEvent= "all";
    this._selected   = null;  // id bouteille sélectionnée
    this._modal      = null;
    this._modalStyle = null;
    this._unsubs        = [];
    this._pendingRender = false;
    this._view       = "2d";  // "2d" | "dot" | "3d"
    this._viewTouched = false; // l'utilisateur a basculé manuellement (prime sur default_view)
    this._optionsOpen = false; // ligne d'options repliable (sous le verre du logo)
    let lblMode = "both";
    try { lblMode = localStorage.getItem("millesime-labelmode") || "both"; } catch (e) {}
    this._labelMode = ["plate", "bubble", "both"].includes(lblMode) ? lblMode : "both"; // repères 3D
    this._three      = null;  // contexte WebGL (vue 3D)
    this._threeModP  = null;  // promesse du module three.js (chargé une fois)
  }

  setConfig(config) {
    this._config = config || {};
    // Priorité : choix manuel mémorisé (localStorage) > default_view YAML > 2d.
    // bottle_style: dot accepté comme alias déprécié.
    if (!this._viewTouched) {
      let saved = null;
      try { saved = localStorage.getItem("millesime-view"); } catch (e) {}
      if (saved === "2d" || saved === "dot" || saved === "3d") {
        this._view = saved;
      } else {
        const dv = normKey(this._config.default_view);
        this._view = dv === "3d" || dv === "dot" ? dv
          : this._config.bottle_style === "dot" ? "dot" : "2d";
      }
    }
    this._applyConfigColors();
    this._renderLoading();
  }

  _applyConfigColors() {
    const cfg = this._config;
    const set = (prop, val) => val
      ? this.style.setProperty(prop, val)
      : this.style.removeProperty(prop);
    set('--accent',         cfg.accent_color);
    set('--accent-h',       cfg.accent_hover_color);
    set('--header-accent',  cfg.header_accent_color || cfg.accent_color);
    set('--wood-dk',        cfg.wood_dark);
    set('--wood-md',        cfg.wood_mid);
    set('--wood-lt',        cfg.wood_light);
    set('--gold',           cfg.gold_color);
    const serifName = cfg.font_serif || 'Playfair Display';
    const sansName  = cfg.font_sans  || 'Inter';
    this._fontSerif = `'${serifName}', serif`;
    this._fontSans  = `'${sansName}', sans-serif`;
    set('--font-serif', this._fontSerif);
    set('--font-sans',  this._fontSans);
    this.style.fontFamily = this._fontSans;
    this.style.fontSize   = (parseFloat(cfg.font_size) || 13) + 'px';
    this._injectFonts(serifName, sansName, cfg.font_url);
    this._fsBase = parseFloat(cfg.font_size) || 13;
    set('--fs-base', this._fsBase + 'px');
  }

  _injectFonts(serifName, sansName, customUrl) {
    const id   = 'mm-gfonts';
    const href = customUrl ||
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(serifName)}:wght@400;700&family=${encodeURIComponent(sansName)}:wght@300;400;500;600&display=swap`;
    let link = document.getElementById(id);
    if (link) {
      if (link.href === href) return;
      link.href = href;
    } else {
      link = document.createElement('link');
      link.id  = id;
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }

  // ── Apparence d'un casier : style déterministe (rackStyleOf) surchargé par la
  // configuration YAML de la carte. `rack_defaults:` s'applique à tous les
  // casiers, `racks:` (clé = nom ou id du casier) surcharge casier par casier.
  //   material: chene | noyer | merisier | grise | wenge | fer   ← tous les éléments
  //   feet / cross_braces / roof : booléens (pieds, croisillons latéraux, toit)
  //   accent: couleur CSS du liseré
  // Sans config, l'ancien cadre déterministe est décomposé en mêmes éléments.
  _rackLook(rack, index) {
    const base = rackStyleOf(index);
    const cfg  = this._config || {};
    let ov = {};
    const named = cfg.racks;
    if (Array.isArray(named)) {
      ov = named.find((r) => r && (r.id === rack.id || normKey(r.name) === normKey(rack.name))) || {};
    } else if (named && typeof named === "object") {
      const k = Object.keys(named).find((k) => k === rack.id || normKey(k) === normKey(rack.name));
      ov = (k && named[k]) || {};
    }
    // Priorité croissante : style déterministe < rack_defaults (YAML) < style
    // stocké sur le casier (popup ⚙) < racks: (YAML par casier)
    ov = { ...(cfg.rack_defaults || {}), ...(rack?.style || {}), ...ov };

    // Matériau : essence de bois ou fer forgé, appliqué à tout le casier
    let wood = base.wood, iron = base.frame === "iron";
    const mk = normKey(ov.material);
    if (mk) {
      if (mk === "fer" || mk === "iron" || mk === "metal") iron = true;
      else {
        const w = RACK_WOODS.find((w) => normKey(w.name) === mk);
        if (w) { wood = w; iron = false; }
      }
    }

    // Cadre legacy décomposé en éléments indépendants, puis surcharge YAML
    const legacy = base.frame;
    const pick = (key, dflt) => (ov[key] === undefined ? dflt : !!ov[key]);
    const cross = pick("cross_braces", legacy === "cross");
    const roof  = pick("roof", legacy === "box");
    const feet  = pick("feet", legacy === "legs");
    // Panneaux latéraux pleins : réservés au caisson legacy non retouché
    const panels = legacy === "box" && ov.roof === undefined;
    // Montants d'angle : auto si croisillons/toit (ils s'y appuient) ou cadre
    // legacy à montants — débrayables explicitement (posts: false)
    const posts = pick("posts",
      cross || roof || legacy === "posts" || legacy === "cross" || legacy === "iron");
    return { wood, accent: ov.accent || base.accent, iron, posts, cross, roof, panels, feet };
  }

  set hass(hass) {
    const first = !this._hass;
    const themeChanged = this._hass?.themes !== hass.themes;
    this._hass = hass;
    if (first) { this._subscribeUpdates(); this._fetchData(); }
    if (first || themeChanged) this._applyTheme();
  }

  getCardSize() { return 8; }

  _applyTheme() {
    const themeVars = this._hass?.themes?.themes?.[this._hass?.themes?.theme] || {};
    const props = [
      'primary-background-color', 'secondary-background-color', 'card-background-color',
      'primary-text-color', 'secondary-text-color', 'divider-color',
      'primary-color', 'secondary-color', 'accent-color',
    ];
    props.forEach(p => {
      if (themeVars[p]) this.style.setProperty(`--${p}`, themeVars[p]);
      else this.style.removeProperty(`--${p}`);
    });
  }

  // ── WebSocket ────────────────────────────────────────────────────────────────

  async _fetchData() {
    if (!this._hass) return;
    if (this._squelchUpdates) return;  // séquence multi-services en cours (permutation…)
    try {
      this._data = await this._hass.connection.sendMessagePromise({ type: "millesime/get_data" });
    } catch (err) {
      console.error("[Millésime] fetchData:", err);
      this._data = this._data || DEFAULT_DATA();
    }
    if (!this._modal) this._render();
    else this._pendingRender = true;
  }

  _subscribeUpdates() {
    // Toujours recharger les données (même modale ouverte : _fetchData diffère
    // alors le rendu via _pendingRender, appliqué à la fermeture de la modale)
    this._hass.connection
      .subscribeEvents(() => this._fetchData(), `${DOMAIN}_updated`)
      .then((u) => { if (this.isConnected) this._unsubs.push(u); else u(); });
  }

  async _callService(service, data) {
    try {
      await this._hass.callService(DOMAIN, service, data);
      this._closeModal();
      // Rechargement immédiat (le backend a déjà persisté quand le service rend
      // la main) + filet de sécurité différé
      await this._fetchData();
      setTimeout(() => this._fetchData(), 600);
      return true;
    } catch (err) {
      this._showToast("error", `Erreur : ${err.message || JSON.stringify(err)}`);
      return false;
    }
  }

  // ── Recherche texte ───────────────────────────────────────────────────────────

  async _searchWine(query) {
    try {
      return await this._hass.connection.sendMessagePromise({
        type: "millesime/search_wine",
        query,
      });
    } catch (err) {
      console.error("[Millésime] searchWine:", err);
      return { results: [], error: "service_unavailable", source: "off" };
    }
  }

  // ── Analyse photo ─────────────────────────────────────────────────────────────

  async _analyzePhoto(imageB64, mimeType) {
    try {
      return await this._hass.connection.sendMessagePromise({
        type:      "millesime/analyze_photo",
        image_b64: imageB64,
        mime_type: mimeType,
      });
    } catch (err) {
      console.error("[Millésime] analyzePhoto:", err);
      return { results: [], error: "service_unavailable", source: "gemini" };
    }
  }

  async _estimatePrice(query) {
    try {
      return await this._hass.connection.sendMessagePromise({
        type:  "millesime/estimate_price",
        query,
      });
    } catch (err) {
      return { price: 0, error: "service_unavailable" };
    }
  }

  // ── Toast notifications ───────────────────────────────────────────────────────

  _showToast(type, message) {
    const existing = document.querySelector(".mm-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `mm-toast mm-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Injection CSS toast si pas déjà là
    if (!document.querySelector("#mm-toast-css")) {
      const s = document.createElement("style");
      s.id = "mm-toast-css";
      s.textContent = `
        .mm-toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          max-width: 420px; width: calc(100% - 32px);
          padding: 12px 16px; border-radius: 10px;
          font-family: Inter, sans-serif; font-size: 13px; line-height: 1.5;
          z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          animation: mm-toast-in 0.2s ease;
        }
        @keyframes mm-toast-in { from { opacity:0; transform:translateX(-50%) translateY(10px); } }
        .mm-toast--error   { background:#2A0A0A; color:#ff8f8f; border:1px solid #5A1010; }
        .mm-toast--warning { background:#2A1E00; color:#ffc85a; border:1px solid #5A3F00; }
        .mm-toast--info    { background:#0A1A2A; color:#7db8f7; border:1px solid #1A4070; }
        .mm-toast--success { background:#0A2A15; color:#6ee098; border:1px solid #1A5030; }
      `;
      document.head.appendChild(s);
    }

    setTimeout(() => toast.remove(), type === "error" ? 8000 : 5000);
  }

  // ── Confirmation modale (remplace window.confirm) ────────────────────────────

  // opts.checkbox : libellé d'une option à cocher dans la popup — la promesse
  // rend alors { checked } à la confirmation (toujours false à l'annulation)
  _confirm(message, opts = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100000;display:flex;align-items:center;justify-content:center";
      overlay.style.setProperty('--font-sans', this._fontSans || "'Inter', sans-serif");
      overlay.style.setProperty('--fs-base',  (this._fsBase  || 13) + 'px');
      overlay.style.fontFamily = this._fontSans || "'Inter', sans-serif";
      overlay.style.fontSize   = (this._fsBase  || 13) + 'px';
      const box = document.createElement("div");
      box.style.cssText = "background:#111;border:1px solid #333;border-radius:14px;padding:22px 24px;max-width:360px;width:90%;color:#EDE0CC;font-size:1em;line-height:1.6;box-shadow:0 8px 32px rgba(0,0,0,0.6)";
      const p = document.createElement("p");
      p.textContent = message;
      p.style.cssText = "margin:0 0 18px";
      const btns = document.createElement("div");
      btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
      const cancel = document.createElement("button");
      cancel.textContent = "Annuler";
      cancel.style.cssText = "padding:8px 16px;border-radius:8px;border:1px solid #333;background:#222;color:#EDE0CC;cursor:pointer;font-size:1em;font-family:var(--font-sans)";
      const ok = document.createElement("button");
      ok.textContent = "Confirmer";
      ok.style.cssText = "padding:8px 16px;border-radius:8px;border:none;background:rgba(140,10,10,0.9);color:#ff8f8f;cursor:pointer;font-size:1em;font-weight:600;font-family:var(--font-sans)";
      box.append(p);
      let check = null;
      if (opts.checkbox) {
        p.style.cssText = "margin:0 0 12px";
        const lbl = document.createElement("label");
        lbl.style.cssText = "display:flex;align-items:center;gap:8px;margin:0 0 18px;cursor:pointer;font-size:0.95em";
        check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !!opts.checked;
        lbl.append(check, document.createTextNode(opts.checkbox));
        box.append(lbl);
      }
      const done = val => { overlay.remove(); resolve(val); };
      cancel.onclick = () => done(false);
      ok.onclick = () => done(check ? { checked: check.checked } : true);
      overlay.onclick = e => { if (e.target === overlay) done(false); };
      btns.append(cancel, ok);
      box.append(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  // ── Gestion des erreurs de recherche ─────────────────────────────────────────

  _handleSearchError(error, source, resultsEl) {
    if (!error) return;
    const msg = ERROR_MESSAGES[error];
    if (!msg) return;

    // Quota dépassé = warning visible (mais résultats OFF disponibles)
    const level = error === "quota_exceeded" || error === "service_unavailable"
      ? "warning" : "error";

    // Afficher sous la barre de recherche si des résultats OFF existent
    const banner = document.createElement("div");
    banner.className = `mm-search-banner mm-search-banner--${level}`;
    banner.textContent = msg;
    if (resultsEl && resultsEl.parentNode) {
      resultsEl.parentNode.insertBefore(banner, resultsEl);
    }

    // Toast si c'est une erreur critique (pas de résultats)
    if (error === "invalid_key" || error === "parse_error") {
      this._showToast(level, msg);
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────────

  _openModal(type, opts = {}) {
    this._closeModal();
    const style = document.createElement("style");
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
    this._modalStyle = style;

    const overlay = document.createElement("div");
    overlay.className = "mm-overlay";
    const themeVars = this._hass?.themes?.themes?.[this._hass?.themes?.theme] || {};
    ['primary-background-color','secondary-background-color','card-background-color',
     'primary-text-color','secondary-text-color','divider-color','primary-color','secondary-color','accent-color']
      .forEach(p => { if (themeVars[p]) overlay.style.setProperty(`--${p}`, themeVars[p]); });
    overlay.style.setProperty('--font-serif', this._fontSerif || "'Playfair Display', serif");
    overlay.style.setProperty('--font-sans',  this._fontSans  || "'Inter', sans-serif");
    overlay.style.setProperty('--fs-base',    (this._fsBase   || 13) + 'px');
    overlay.style.fontFamily = this._fontSans || "'Inter', sans-serif";
    overlay.style.fontSize   = (this._fsBase  || 13) + 'px';
    const box = document.createElement("div");
    box.className = "mm-box";

    if (type === "rack")     box.innerHTML = this._rackFormHTML(opts.rack);
    if (type === "bottle")    box.innerHTML = this._bottleFormHTML(opts.wine, opts.slot);
    if (type === "detail")    box.innerHTML = this._detailHTML(opts.wine);
    if (type === "duplicate") box.innerHTML = this._addSlotFormHTML(opts.wine);
    if (type === "history")   box.innerHTML = this._historyHTML();
    if (type === "drink")     box.innerHTML = this._drinkFormHTML(opts.wine);
    if (type === "slotedit")  box.innerHTML = this._slotEditHTML(opts.wine, opts.slotIdx);
    if (type === "journal")   box.innerHTML = this._journalHTML();
    if (type === "search")    box.innerHTML = this._searchModalHTML();
    if (type === "moverack") box.innerHTML = this._moveRackHTML(opts.rack);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this._modal = overlay;

    overlay.addEventListener("click", (e) => { if (e.target === overlay) this._closeModal(); });
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => this._closeModal()));

    if (type === "rack")     this._bindRackForm(box, opts.rack);
    if (type === "bottle")    this._bindBottleForm(box, opts.wine, opts.slot);
    if (type === "detail")    this._bindDetailButtons(box, opts.wine);
    if (type === "duplicate") this._bindAddSlotForm(box, opts.wine);
    if (type === "slotedit")  this._bindSlotEdit(box, opts.wine, opts.slotIdx);
    if (type === "history") {
      this._bindHistory(box);
    }
    if (type === "drink")     this._bindDrinkForm(box, opts.wine);
    if (type === "journal")   this._bindJournal(box);
    if (type === "search")    this._bindSearchModal(box);
    if (type === "moverack") this._bindMoveRack(box, opts.rack);
  }

  _closeModal() {
    this._modal?.remove();      this._modal      = null;
    this._modalStyle?.remove(); this._modalStyle = null;
    if (this._pendingRender) { this._pendingRender = false; this._render(); }
  }

  // ── HTML formulaire casier ─────────────────────────────────────────────────────

  _rackFormHTML(rack) {
    const next  = (this._data?.cellar?.racks?.length || 0) + 1;
    const isEdit = !!rack;
    return `
      <div class="mm-header">
        <span class="mm-title">${isEdit ? "Modifier le casier" : "Nouveau casier"}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-field">
          <label class="mm-label">Nom</label>
          <input class="mm-input" id="fl-name" type="text"
            value="${esc(rack?.name || "Casier " + next)}" placeholder="Bordeaux, Bourgogne...">
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Colonnes</label>
            <input class="mm-input" id="fl-cols" type="number" value="${rack?.columns || 8}" min="1" max="20">
          </div>
          <div class="mm-field">
            <label class="mm-label">Étagères</label>
            <input class="mm-input" id="fl-shelves" type="number" value="${rack?.shelves || 2}" min="1" max="10">
          </div>
        </div>
        <div class="mm-field">
          <label class="mm-label">Disposition</label>
          <select class="mm-input" id="fl-layout">
            <option value="side_by_side"   ${(rack?.layout || "side_by_side") === "side_by_side" ? "selected" : ""}>Côte à côte</option>
            <option value="alternating"    ${rack?.layout === "alternating"    ? "selected" : ""}>Tête-bêche</option>
            <option value="alternating_2d" ${rack?.layout === "alternating_2d" ? "selected" : ""}>Tête-bêche alterné</option>
            <option value="quinconce"      ${rack?.layout === "quinconce"      ? "selected" : ""}>Quinconce</option>
          </select>
        </div>
        ${this._rackStyleFieldsHTML(rack)}
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="fl-submit">${isEdit ? "Enregistrer" : "Créer le casier"}</button>
      </div>`;
  }

  // Champs d'apparence du casier (matériau + pieds/croisillons/toit) : « Auto »
  // laisse le style déterministe — ou la config YAML de la carte — décider
  _rackStyleFieldsHTML(rack) {
    const stl = rack?.style || {};
    const mat = normKey(stl.material);
    const matOpt = (v, lbl) => `<option value="${v}" ${mat === v ? "selected" : ""}>${lbl}</option>`;
    const tri = (id, lbl, v) => `
          <div class="mm-field">
            <label class="mm-label">${lbl}</label>
            <select class="mm-input" id="${id}">
              <option value="">Auto</option>
              <option value="1" ${v === true  ? "selected" : ""}>Avec</option>
              <option value="0" ${v === false ? "selected" : ""}>Sans</option>
            </select>
          </div>`;
    return `
        <div class="mm-field">
          <label class="mm-label">Matériau</label>
          <select class="mm-input" id="fl-material">
            <option value="">Automatique</option>
            ${matOpt("chene", "Chêne")}
            ${matOpt("noyer", "Noyer")}
            ${matOpt("merisier", "Merisier")}
            ${matOpt("grise", "Bois grisé")}
            ${matOpt("wenge", "Wengé")}
            ${matOpt("fer", "Fer forgé")}
          </select>
        </div>
        <div class="mm-row">
          ${tri("fl-posts", "Montants",    stl.posts)}
          ${tri("fl-feet",  "Pieds",       stl.feet)}
        </div>
        <div class="mm-row">
          ${tri("fl-cross", "Croisillons", stl.cross_braces)}
          ${tri("fl-roof",  "Toit",        stl.roof)}
        </div>`;
  }

  _bindRackForm(box, rack) {
    box.querySelector("#fl-submit").addEventListener("click", async () => {
      const name   = box.querySelector("#fl-name").value.trim() || "Nouveau casier";
      const cols   = parseInt(box.querySelector("#fl-cols").value) || 8;
      const shelves   = parseInt(box.querySelector("#fl-shelves").value) || 2;
      const layout = box.querySelector("#fl-layout").value;
      // Seuls les choix explicites sont stockés ; un style vide est envoyé quand
      // même pour permettre le retour complet à l'automatique côté backend
      const style = {};
      const mat = box.querySelector("#fl-material").value;
      if (mat) style.material = mat;
      [["#fl-posts", "posts"], ["#fl-feet", "feet"], ["#fl-cross", "cross_braces"], ["#fl-roof", "roof"]].forEach(([sel, key]) => {
        const v = box.querySelector(sel).value;
        if (v !== "") style[key] = v === "1";
      });
      if (rack) {
        await this._callService("update_rack", { rack_id: rack.id, name, columns: cols, shelves, layout, style });
      } else {
        await this._callService("add_rack", { name, columns: cols, shelves, layout, slots: cols * shelves, style });
      }
    });
  }

  // ── HTML formulaire bouteille ──────────────────────────────────────────────────

  _bottleFormHTML(wine, pendingSlot) {
    const racks = this._data?.cellar?.racks || [];
    const isEdit = !!wine;
    const b = wine || {};
    return `
      <div class="mm-header">
        <span class="mm-title">${isEdit ? "Modifier le vin" : "Ajouter un vin"}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">

        <!-- Bloc recherche / photo -->
        <div class="mm-search-block">
          <div class="mm-search-row">
            <div class="mm-search-wrap">
              <span class="mm-search-icon">🔍</span>
              <input class="mm-input mm-search-input" id="viv-query"
                placeholder="Rechercher : château, domaine, appellation..."
                value="${esc(b.name || "")}">
            </div>
            <button class="mm-btn-photo" id="btn-photo" title="Scanner l'étiquette">📷</button>
            <input type="file" id="photo-input" accept="image/*" ${_isMobile() ? 'capture="environment"' : ''} style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;overflow:hidden">
          </div>
          <div id="search-banner"></div>
          <div id="viv-results" class="mm-viv-results"></div>
        </div>

        <!-- Aperçu image -->
        <div id="viv-img-preview"></div>

        <!-- Champs principaux -->
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Nom du vin *</label>
            <input class="mm-input" id="bt-name" value="${esc(b.name || "")}" placeholder="Château Pétrus">
          </div>
          <div class="mm-field">
            <label class="mm-label">Millésime</label>
            <input class="mm-input" id="bt-vintage" value="${esc(b.vintage || "")}" placeholder="2019" maxlength="4">
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Format</label>
            <input class="mm-input" id="bt-size" value="${esc(b.size || "")}" placeholder="75cl">
          </div>
          <div class="mm-field">
            <label class="mm-label">Coup de cœur</label>
            <button type="button" id="bt-favorite" class="mm-fav${b.favorite ? " on" : ""}"
              title="Coup de cœur" aria-pressed="${b.favorite ? "true" : "false"}">${b.favorite ? "★" : "☆"}</button>
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Type</label>
            <select class="mm-input" id="bt-type">
              ${Object.entries(WINE_TYPES).map(([v, t]) =>
                `<option value="${v}" ${(b.type || "red") === v ? "selected" : ""}>${t.emoji} ${t.label}</option>`
              ).join("")}
            </select>
          </div>
          <div class="mm-field">
            <label class="mm-label">Prix (€)</label>
            <input class="mm-input" id="bt-price" type="number" step="0.5" min="0" value="${b.price || ""}">
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Producteur</label>
            <input class="mm-input" id="bt-producer" value="${esc(b.producer || "")}" placeholder="Domaine...">
          </div>
          <div class="mm-field">
            <label class="mm-label">Appellation</label>
            <input class="mm-input" id="bt-appellation" value="${esc(b.appellation || "")}" placeholder="Pomerol, Chablis...">
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">À boire à partir de</label>
            <input class="mm-input" id="bt-from" value="${esc(b.drink_from || "")}" placeholder="2025">
          </div>
          <div class="mm-field">
            <label class="mm-label">À boire avant</label>
            <input class="mm-input" id="bt-until" value="${esc(b.drink_until || "")}" placeholder="2035">
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-field" style="grid-column:1/-1">
            <label class="mm-label">Note /5</label>
            <input class="mm-input" id="bt-vrating" type="number" step="0.1" min="0" max="5" value="${b.vivino_rating || ""}">
          </div>
        </div>

        ${!isEdit ? `
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Casier *</label>
            <select class="mm-input" id="bt-rack">
              ${racks.map((f) =>
                `<option value="${esc(f.id)}" ${pendingSlot?.rack_id === f.id ? "selected" : ""}>${esc(f.name)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="mm-field" style="grid-column:1/-1">
            <label class="mm-label">Emplacements (cliquer pour sélectionner)</label>
            <input type="hidden" id="bt-slots" value="${pendingSlot != null ? pendingSlot.slot : ""}">
            <div id="bt-slot-picker" class="sp-picker"></div>
          </div>
        </div>` : ""}

        <div class="mm-row">
          <div class="mm-field" style="grid-column:1/-1">
            <label class="mm-label">Événement</label>
            <select class="mm-input" id="bt-event">
              ${EVENT_TYPES.map(e =>
                `<option value="${e.v}" ${(b.event || "") === e.v ? "selected" : ""}>${e.emoji ? e.emoji + " " : ""}${e.l}</option>`
              ).join("")}
            </select>
          </div>
        </div>

        <div class="mm-field">
          <label class="mm-label">Notes personnelles</label>
          <textarea class="mm-input mm-textarea" id="bt-notes"
            placeholder="Impressions, occasion...">${esc(b.notes || "")}</textarea>
        </div>

        <!-- Champs cachés remplis par Gemini -->
        <input type="hidden" id="bt-image_url"   value="${esc(b.image_url    || "")}">
        <input type="hidden" id="bt-vivino_url"  value="${esc(b.vivino_url   || "")}">
        <input type="hidden" id="bt-region"      value="${esc(b.region       || "")}">
        <input type="hidden" id="bt-country"     value="${esc(b.country      || "")}">
        <input type="hidden" id="bt-tasting"     value="${esc(b.tasting_notes|| "")}">
        <input type="hidden" id="bt-pairing"     value="${esc(b.food_pairing || "")}">
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="bt-submit">
          ${isEdit ? "Enregistrer" : "Ajouter à la cave"}
        </button>
      </div>`;
  }

  _bindBottleForm(box, wine, pendingSlot) {
    let searchTimer;
    const qInput   = box.querySelector("#viv-query");
    const results  = box.querySelector("#viv-results");
    const imgWrap  = box.querySelector("#viv-img-preview");
    const banner   = box.querySelector("#search-banner");
    const btnPhoto = box.querySelector("#btn-photo");
    const fileInput= box.querySelector("#photo-input");

    // ── Auto-remplissage depuis un résultat ──────────────────────────────────
    const fillFrom = (w) => {
      const set = (id, val) => {
        const el = box.querySelector(`#${id}`);
        if (el && val != null && val !== "" && val !== 0) el.value = val;
      };
      set("bt-name",        w.name);
      set("bt-vintage",     w.vintage);
      set("bt-producer",    w.producer);
      set("bt-appellation", w.appellation);
      set("bt-from",        w.drink_from  || "");
      set("bt-until",       w.drink_until || "");
      set("bt-vrating",     w.vivino_rating || "");
      if (w.price > 0) { const el = box.querySelector("#bt-price"); if (el) el.value = w.price; }
      set("bt-image_url",   w.image_url   || "");
      set("bt-vivino_url",  w.vivino_url  || "");
      set("bt-region",      w.region      || "");
      set("bt-country",     w.country     || "");
      set("bt-tasting",     w.tasting_notes || "");
      set("bt-pairing",     w.food_pairing  || "");
      const typeEl = box.querySelector("#bt-type");
      if (typeEl && w.type) typeEl.value = w.type;
      results.innerHTML = "";
      results.style.display = "none";
      if (w.image_url) {
        imgWrap.innerHTML = `<img src="${esc(w.image_url)}"
          style="width:56px;display:block;margin:0 auto 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.5)">`;
      }
    };

    // ── Affichage des résultats ───────────────────────────────────────────────
    const showResults = (response) => {
      // Nettoyer les anciens banners
      banner.innerHTML = "";
      const { results: wines = [], error, source } = response;

      // Afficher le banner d'erreur si besoin
      if (error) {
        const msg = ERROR_MESSAGES[error] || error;
        const level = (error === "quota_exceeded" || error === "service_unavailable") ? "warning" : "error";
        banner.innerHTML = `<div class="mm-search-banner mm-search-banner--${level}">${msg}</div>`;
      } else if (source === "off" && box.querySelector("#viv-query").value.trim().length >= 3) {
        // Info discrète : résultats OFF sans erreur (pas de clé Gemini)
        // On ne l'affiche que si la recherche a produit des résultats
        if (wines.length > 0) {
          banner.innerHTML = `<div class="mm-search-banner mm-search-banner--info">
            ℹ️ Résultats Open Food Facts — ajoutez une clé Gemini pour les notes de dégustation.
          </div>`;
        }
      }

      if (!wines.length) {
        results.innerHTML = `<div class="mm-viv-loading">Aucun résultat — remplissez manuellement</div>`;
        results.style.display = "block";
        return;
      }

      results.style.display = "block";
      results.innerHTML = wines.map((w, i) => `
        <div class="mm-viv-item" data-idx="${i}">
          ${w.image_url
            ? `<img src="${esc(w.image_url)}" style="width:28px;border-radius:4px;flex-shrink:0">`
            : `<span style="font-size:1.38em;flex-shrink:0">${WINE_TYPES[w.type]?.emoji || "🍷"}</span>`}
          <div style="flex:1;min-width:0">
            <div class="mm-viv-name">${esc(w.name)}${w.vintage ? " " + esc(w.vintage) : ""}</div>
            <div class="mm-viv-sub">${[
              w.appellation ? esc(w.appellation) : null,
              w.region      ? esc(w.region)      : null,
              w.vivino_rating ? "⭐ " + w.vivino_rating : null
            ].filter(Boolean).join(" · ")}</div>
            ${w.tasting_notes ? `<div class="mm-viv-notes">${esc(w.tasting_notes)}</div>` : ""}
          </div>
        </div>`).join("");

      results.querySelectorAll(".mm-viv-item").forEach((el) =>
        el.addEventListener("click", () => fillFrom(wines[parseInt(el.dataset.idx)]))
      );
    };

    // ── Recherche texte avec debounce 600ms ───────────────────────────────────
    qInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = qInput.value.trim();
      if (q.length < 3) {
        results.innerHTML = "";
        results.style.display = "none";
        banner.innerHTML = "";
        return;
      }
      results.style.display = "block";
      results.innerHTML = `<div class="mm-viv-loading">
        <span class="mm-spinner"></span> Recherche en cours...
      </div>`;
      searchTimer = setTimeout(async () => {
        const response = await this._searchWine(q);
        showResults(response);
      }, 600);
    });

    // ── Scan photo de l'étiquette ─────────────────────────────────────────────
    btnPhoto?.addEventListener("click", () => fileInput?.click());

    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      // Aperçu immédiat
      const url = URL.createObjectURL(file);
      imgWrap.innerHTML = `<div class="mm-photo-loading">
        <img src="${url}" style="width:80px;border-radius:8px;opacity:0.6;display:block;margin:0 auto 6px">
        <div style="text-align:center;font-size:0.85em;color:var(--mm-muted,#888)">
          <span class="mm-spinner"></span> Analyse de l'étiquette...
        </div>
      </div>`;
      results.innerHTML = "";
      results.style.display = "none";
      banner.innerHTML = "";

      // Encoder en base64 (robuste : certains navigateurs mobiles renvoient un résultat vide)
      let b64;
      try {
        b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => {
            const result = r.result || "";
            const comma = String(result).indexOf(",");
            res(comma >= 0 ? String(result).slice(comma + 1) : "");
          };
          r.onerror = () => rej(new Error("Lecture fichier impossible"));
          r.readAsDataURL(file);
        });
      } catch (e) {
        imgWrap.innerHTML = `<div class="mm-photo-error">Impossible de lire l'image. Réessayez.</div>`;
        URL.revokeObjectURL(url);
        return;
      }
      if (!b64) {
        imgWrap.innerHTML = `<div class="mm-photo-error">Image vide ou format non supporté.</div>`;
        URL.revokeObjectURL(url);
        return;
      }

      const mimeType = file.type || "image/jpeg";
      const response = await this._analyzePhoto(b64, mimeType);
      URL.revokeObjectURL(url);

      const { results: wines = [], error } = response;

      // Nettoyer l'aperçu loading
      imgWrap.innerHTML = "";

      if (error === "invalid_key" || error === "no_key") {
        imgWrap.innerHTML = `<div class="mm-photo-error">${ERROR_MESSAGES.invalid_key}</div>`;
        return;
      }
      if (!wines.length) {
        imgWrap.innerHTML = `<div class="mm-photo-error">${ERROR_MESSAGES.no_wine_found}</div>`;
        return;
      }
      if (error) {
        banner.innerHTML = `<div class="mm-search-banner mm-search-banner--warning">${ERROR_MESSAGES[error] || esc(error)}</div>`;
      }

      if (wines.length === 1) {
        // Un seul vin identifié → remplissage direct
        fillFrom(wines[0]);
        this._showToast("success", `✅ Étiquette reconnue : ${wines[0].name}`);
      } else {
        // Plusieurs vins possibles → afficher les suggestions
        showResults({ results: wines, error: null, source: "gemini" });
        this._showToast("info", "📷 Plusieurs vins possibles — sélectionnez le bon");
      }
    });

    // ── Coup de cœur : étoile cliquable (★ pleine si actif, ☆ contour sinon) ──
    const fav = box.querySelector("#bt-favorite");
    fav?.addEventListener("click", () => {
      const on = fav.classList.toggle("on");
      fav.textContent = on ? "★" : "☆";
      fav.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // ── Soumission du formulaire ──────────────────────────────────────────────
    box.querySelector("#bt-submit")?.addEventListener("click", async () => {
      const txt = (id) => box.querySelector(`#${id}`)?.value?.trim() || "";
      const num = (id) => parseFloat(box.querySelector(`#${id}`)?.value)  || 0;

      const name = txt("bt-name");
      if (!name) { this._showToast("error", "Le nom du vin est requis."); return; }

      const payload = {
        name,
        vintage:       txt("bt-vintage"),
        size:          txt("bt-size"),
        favorite:      !!box.querySelector("#bt-favorite")?.classList.contains("on"),
        type:          box.querySelector("#bt-type")?.value || "red",
        producer:      txt("bt-producer"),
        appellation:   txt("bt-appellation"),
        region:        txt("bt-region"),
        country:       txt("bt-country"),
        price:         num("bt-price"),
        drink_from:    txt("bt-from"),
        drink_until:   txt("bt-until"),
        notes:         txt("bt-notes"),
        tasting_notes: txt("bt-tasting"),
        food_pairing:  txt("bt-pairing"),
        vivino_rating: num("bt-vrating"),
        event:         box.querySelector("#bt-event")?.value || "",
        image_url:     txt("bt-image_url"),
        vivino_url:    txt("bt-vivino_url"),
      };

      try {
        if (wine) {
          await this._hass.callService(DOMAIN, "update_wine", { wine_id: wine.id, ...payload });
        } else {
          const rackId = box.querySelector("#bt-rack")?.value || "";
          const slotsStr = box.querySelector("#bt-slots")?.value || "0";
          const slots = slotsStr.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          if (!slots.length) slots.push(0);
          // Créer le vin au premier emplacement
          payload.rack_id = rackId;
          payload.slot     = slots[0];
          await this._hass.callService(DOMAIN, "add_wine", payload);
          // Ajouter les emplacements supplémentaires
          if (slots.length > 1) {
            let added = null;
            for (let attempt = 0; attempt < 5 && !added; attempt++) {
              if (attempt > 0) await new Promise(r => setTimeout(r, 400));
              const freshData = await this._hass.connection.sendMessagePromise({ type: "millesime/get_data" });
              added = (freshData.wines || []).find(w => w.name === name && w.slots?.some(s => s.rack_id === rackId && s.slot === slots[0]));
            }
            if (added) {
              for (let k = 1; k < slots.length; k++) {
                await this._hass.callService(DOMAIN, "add_slot", { wine_id: added.id, rack_id: rackId, slot: slots[k] });
              }
            } else {
              this._showToast("warning", "Emplacements supplémentaires non ajoutés (vin introuvable après création).");
            }
          }
        }
        this._closeModal();
        // Rechargement immédiat (tous les add_wine/add_slot sont déjà persistés
        // à ce stade) + filet de sécurité différé
        await this._fetchData();
        setTimeout(() => this._fetchData(), 600);
      } catch (err) {
        this._showToast("error", `Erreur : ${err.message || JSON.stringify(err)}`);
      }
    });

    const renderPicker = () => this._renderSlotPicker(box, "bt-rack", "bt-slot-picker", "bt-slots", null, true);
    box.querySelector("#bt-rack")?.addEventListener("change", renderPicker);
    if (!wine) renderPicker();
  }

  _renderSlotPicker(box, rackSelectId, pickerId, slotInputId, excludeWineId = null, multiSelect = false) {
    const rackId   = box.querySelector(`#${rackSelectId}`)?.value;
    const rack     = (this._data?.cellar?.racks || []).find(f => f.id === rackId);
    const picker    = box.querySelector(`#${pickerId}`);
    const slotInput = box.querySelector(`#${slotInputId}`);
    if (!picker || !rack) return;

    const cols  = rack.columns || 8;
    const total = rack.slots || cols * (rack.shelves || 2);
    const occupied = {};
    (this._data?.wines || []).forEach(w => {
      if (w.id === excludeWineId) return;
      w.slots?.forEach(s => {
        if (s.rack_id === rackId) occupied[s.slot] = w;
      });
    });

    const selected = multiSelect
      ? new Set((slotInput.value || "").split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)))
      : new Set([parseInt(slotInput.value) || 0]);

    let dots = "";
    for (let i = 0; i < total; i++) {
      const bt   = occupied[i];
      const wt   = bt ? (WINE_TYPES[bt.type] || WINE_TYPES.red) : null;
      const isSel = !bt && selected.has(i);
      dots += `<div class="sp-dot ${bt ? "sp-taken" : "sp-free"}${isSel ? " sp-sel" : ""}"
        data-s="${i}"
        style="${bt ? `--sp-c:${wt.color}` : isSel ? "--sp-c:#a78bfa" : ""}"
        title="${bt ? bt.name + (bt.vintage ? " " + bt.vintage : "") : this._slotLabel({ rack_id: rackId, slot: i })}"></div>`;
    }

    const selArr = [...selected].sort((a, b) => a - b);
    // Affichage humain (1-based) : « ét. X · n°Y », l'étagère omise s'il n'y en a qu'une
    const multiShelf = (rack.shelves || Math.ceil(total / cols)) > 1;
    const fmtSlot = (n) => multiShelf
      ? `ét. ${Math.floor(n / cols) + 1} · n°${(n % cols) + 1}`
      : `n°${(n % cols) + 1}`;
    const label = multiSelect
      ? `${selArr.length} emplacement${selArr.length > 1 ? "s" : ""} sélectionné${selArr.length > 1 ? "s" : ""} : <strong>${selArr.map(fmtSlot).join(", ")}</strong>`
      : `Emplacement sélectionné : <strong>${fmtSlot(selArr[0])}</strong>`;
    picker.innerHTML = `
      <div class="sp-grid" style="grid-template-columns:repeat(${cols},1fr)">${dots}</div>
      <div class="sp-label">${label}</div>`;

    picker.querySelectorAll(".sp-free").forEach(dot => {
      dot.addEventListener("click", () => {
        const s = parseInt(dot.dataset.s);
        if (multiSelect) {
          if (selected.has(s)) selected.delete(s);
          else selected.add(s);
          slotInput.value = [...selected].sort((a, b) => a - b).join(",");
        } else {
          slotInput.value = s;
        }
        this._renderSlotPicker(box, rackSelectId, pickerId, slotInputId, excludeWineId, multiSelect);
      });
    });
  }

  // ── Libellé d'emplacement (commun à tous les affichages) ─────────────────────
  // Regroupe casier · étagère · position : l'étagère et la position (1-based) sont
  // déduites du numéro de slot et des colonnes du casier ; l'étagère est omise si
  // le casier n'en a qu'une.

  _slotLabel(s) {
    const rack = (this._data?.cellar?.racks || []).find(f => f.id === s.rack_id);
    if (!rack) return `${s.rack_id} · n°${(s.slot || 0) + 1}`;
    const cols    = rack.columns || 8;
    const shelves = rack.shelves || Math.ceil((rack.slots || cols) / cols);
    const sh  = Math.floor(s.slot / cols) + 1;
    const pos = (s.slot % cols) + 1;
    return shelves > 1
      ? `${rack.name} · ét. ${sh} · n°${pos}`
      : `${rack.name} · n°${pos}`;
  }

  // Format effectif d'une bouteille : celui de l'emplacement, sinon celui du vin.
  // Retourne un texte uniquement s'il diffère du 75 cl standard.
  _slotSizeTxt(s, wine) {
    const sz = s.size || wine?.size || "";
    return sz && sizeLiters(sz) !== 0.75 ? sz : "";
  }

  // Badges d'emplacement (rendu commun fiche détail / recherche) — format affiché
  // s'il diffère de 75 cl, commentaire en infobulle (📝). `editable` rend chaque
  // badge cliquable (édition du format/commentaire de la bouteille).
  _slotBadges(slots, wine, editable = false) {
    return (slots || []).map((s, si) => {
      const szt = this._slotSizeTxt(s, wine);
      const tip = [s.comment, editable ? "cliquer pour modifier" : ""].filter(Boolean).join(" — ");
      return `<span class="mm-slot-badge${editable ? " mm-slot-badge--edit" : ""}"
        ${editable ? `data-slot-idx="${si}"` : ""}${tip ? ` title="${esc(tip)}"` : ""}>
        ${esc(this._slotLabel(s))}${szt ? ` · ${esc(szt)}` : ""}${s.comment ? " 📝" : ""}</span>`;
    }).join("");
  }

  // ── Fiche détail bouteille ─────────────────────────────────────────────────────

  _detailHTML(wine) {
    const b  = wine;
    const t  = WINE_TYPES[b.type] || WINE_TYPES.red;
    const vr = parseFloat(b.vivino_rating) || 0;
    const stars = vr > 0
      ? "★".repeat(Math.round(vr)) + "☆".repeat(5 - Math.round(vr)) : "";
    return `
      <div class="mm-header" style="background:linear-gradient(135deg,${t.color}18,transparent)">
        <button class="mm-close" data-close style="order:-1;font-size:1.54em">←</button>
        <span class="mm-title">${esc(b.name)}</span>
        <span style="color:${t.color};font-size:0.77em;font-weight:700;text-transform:uppercase;letter-spacing:1.5px">${t.label}</span>
      </div>
      <div class="mm-body">
        ${b.image_url ? `<img src="${esc(b.image_url)}" style="width:64px;display:block;margin:0 auto 16px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.6)">` : ""}
        <div class="mm-detail-hero">
          <div class="mm-detail-name">${b.favorite ? "⭐ " : ""}${esc(b.name)}</div>
          <div class="mm-detail-sub">${[b.producer, b.appellation].filter(Boolean).map(esc).join(" · ")}</div>
          ${vr > 0 ? `
            <div style="color:${t.color};font-size:1.54em;margin-top:10px;letter-spacing:2px">${stars}</div>
            <div style="color:var(--mm-muted,#555);font-size:0.85em;margin-top:2px">${vr.toFixed(1)} / 5</div>` : ""}
          ${b.vivino_url ? `<a href="${safeUrl(b.vivino_url)}" target="_blank" class="mm-vivino-link">Voir sur Vivino →</a>` : ""}
        </div>
        <div class="mm-detail-grid">
          ${_drow("Millésime",  b.vintage)}
          ${_drow("Format",     b.size || "75cl")}
          ${_drow("Région",     [b.region, b.country].filter(Boolean).join(", "))}
          <div class="mm-drow"><span class="mm-drow-label">Prix</span><span class="mm-drow-value det-price-display">${b.price ? `${b.price} €` : ""}</span></div>
          ${(b.slots?.length > 0) ? `<div class="mm-drow" style="grid-column:1/-1">
            <span class="mm-drow-label">Emplacements</span>
            <span class="mm-drow-value mm-slot-badges" style="margin-top:2px">${this._slotBadges(b.slots, b, true)}</span>
          </div>` : ""}
          ${_drow("À boire",    (b.drink_from || b.drink_until)
                                ? (b.drink_from || "?") + " — " + (b.drink_until || "?") : "")}
          ${_drow("Ajouté le",  b.added_date || "")}
          ${b.event && EVENT_LABEL[b.event]?.l ? _drow("Événement", EVENT_LABEL[b.event].emoji + " " + EVENT_LABEL[b.event].l) : ""}
        </div>
        ${b.tasting_notes ? `<div class="mm-notes mm-tasting">🍷 ${esc(b.tasting_notes)}</div>` : ""}
        ${b.food_pairing  ? `<div class="mm-notes mm-pairing">🍽️ ${esc(b.food_pairing)}</div>`  : ""}
        ${b.notes
          ? `<div class="mm-notes">"${esc(b.notes)}"</div>`
          : `<div class="mm-notes mm-notes--empty">Aucun commentaire — ✎ Modifier pour en ajouter</div>`}
      </div>
      <div class="mm-footer mm-footer-wrap">
        <button class="mm-btn mm-btn-drink" id="det-drink">🍷 J'ai bu cette bouteille</button>
        <div class="mm-footer-row">
          <button class="mm-btn mm-btn-danger" id="det-remove">🗑</button>
          <button class="mm-btn mm-btn-ghost"  id="det-price">💰 Prix</button>
          <button class="mm-btn mm-btn-ghost"  id="det-dup">+ Emplacement</button>
          <button class="mm-btn mm-btn-ghost"  id="det-edit">✏️ Modifier</button>
        </div>
      </div>`;
  }

  // ── Formulaire ajout d'emplacement ──────────────────────────────────────────

  _addSlotFormHTML(wine) {
    const racks = this._data?.cellar?.racks || [];
    return `
      <div class="mm-header">
        <span class="mm-title">+ Ajouter un emplacement</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-notes mm-tasting" style="margin-bottom:14px">
          Ajouter un emplacement pour <strong>${esc(wine.name)}${wine.vintage ? " " + esc(wine.vintage) : ""}</strong>
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Casier *</label>
            <select class="mm-input" id="dup-rack">
              ${racks.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}
            </select>
          </div>
          <div class="mm-field" style="grid-column:1/-1">
            <label class="mm-label">Emplacement</label>
            <input type="hidden" id="dup-slot" value="">
            <div id="dup-slot-picker" class="sp-picker"></div>
          </div>
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="dup-submit">Ajouter</button>
      </div>`;
  }

  _bindAddSlotForm(box, wine) {
    box.querySelector("#dup-submit")?.addEventListener("click", async () => {
      const btn     = box.querySelector("#dup-submit");
      const rackId = box.querySelector("#dup-rack")?.value;
      const slotRaw = box.querySelector("#dup-slot")?.value || "";
      const slots   = slotRaw.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (!rackId) { this._showToast("warning", "Sélectionnez un casier."); return; }
      if (slots.length === 0) { this._showToast("warning", "Sélectionnez au moins un emplacement."); return; }
      btn.textContent = "⏳ Ajout en cours...";
      btn.disabled = true;
      const failed = [];
      for (const slot of slots) {
        try {
          await this._hass.callService(DOMAIN, "add_slot", { wine_id: wine.id, rack_id: rackId, slot });
        } catch(e) {
          failed.push(slot);
        }
      }
      const added = slots.length - failed.length;
      this._closeModal();
      await this._fetchData();
      setTimeout(() => this._fetchData(), 600);
      if (failed.length) {
        this._showToast("warning", `${added} emplacement(s) ajouté(s), ${failed.length} en échec (n° ${failed.map(n => n + 1).join(", ")}).`);
      } else {
        this._showToast("success", `${slots.length} emplacement${slots.length > 1 ? "s" : ""} ajouté${slots.length > 1 ? "s" : ""} ✓`);
      }
    });

    const renderDupPicker = () => this._renderSlotPicker(box, "dup-rack", "dup-slot-picker", "dup-slot", null, true);
    box.querySelector("#dup-rack")?.addEventListener("change", renderDupPicker);
    renderDupPicker();
  }

  // ── Édition d'une bouteille (format / commentaire propres à l'emplacement) ──

  _slotEditHTML(wine, slotIdx) {
    const s = wine.slots?.[slotIdx] || {};
    return `
      <div class="mm-header">
        <span class="mm-title">🍾 Modifier la bouteille</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-notes mm-tasting" style="margin-bottom:14px">
          <strong>${esc(wine.name)}${wine.vintage ? " " + esc(wine.vintage) : ""}</strong><br>
          ${esc(this._slotLabel(s))} — ces réglages ne concernent que cette bouteille,
          pas les autres exemplaires du vin.
        </div>
        <div class="mm-row">
          <div class="mm-field">
            <label class="mm-label">Format</label>
            <input class="mm-input" id="se-size" value="${esc(s.size || "")}"
              placeholder="${esc(wine.size || "75cl")} (vide = format du vin)">
          </div>
          <div class="mm-field" style="grid-column:1/-1">
            <label class="mm-label">Commentaire de cette bouteille</label>
            <input class="mm-input" id="se-comment" value="${esc(s.comment || "")}" placeholder="ex. : cadeau, étiquette abîmée…">
          </div>
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="se-submit">Enregistrer</button>
      </div>`;
  }

  _bindSlotEdit(box, wine, slotIdx) {
    box.querySelector("#se-submit")?.addEventListener("click", async () => {
      await this._callService("update_slot", {
        wine_id:  wine.id,
        slot_idx: slotIdx,
        size:     box.querySelector("#se-size")?.value?.trim() || "",
        comment:  box.querySelector("#se-comment")?.value?.trim() || "",
      });
    });
  }

  // ── Formulaire « J'ai bu cette bouteille » ──────────────────────────────────

  _drinkFormHTML(wine) {
    const t = WINE_TYPES[wine.type] || WINE_TYPES.red;
    const today = new Date().toISOString().slice(0, 10);
    const multiSlot = (wine.slots?.length || 0) > 1;
    return `
      <div class="mm-header" style="background:linear-gradient(135deg,${t.color}18,transparent)">
        <span class="mm-title">🍷 Dégustation</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-detail-hero" style="margin-bottom:14px">
          <div class="mm-detail-name">${esc(wine.name)}${wine.vintage ? " " + esc(wine.vintage) : ""}</div>
          <div class="mm-detail-sub">${[wine.producer, wine.appellation].filter(Boolean).map(esc).join(" · ")}</div>
        </div>

        ${multiSlot ? `
        <div class="mm-field">
          <label class="mm-label">Quelle bouteille ?</label>
          <select class="mm-input" id="drink-slot">
            ${wine.slots.map((s, i) => {
              const szt = this._slotSizeTxt(s, wine);
              return `<option value="${i}">${esc(this._slotLabel(s))}${szt ? ` · ${esc(szt)}` : ""}</option>`;
            }).join("")}
          </select>
        </div>` : `<input type="hidden" id="drink-slot" value="0">`}

        <div class="mm-field">
          <label class="mm-label">Ma note</label>
          <div class="mm-stars" id="drink-stars">
            ${[1,2,3,4,5].map(n => `<span class="mm-star" data-star="${n}">☆</span>`).join("")}
          </div>
          <input type="hidden" id="drink-rating" value="0">
        </div>

        <div class="mm-field">
          <label class="mm-label">Date de dégustation</label>
          <input class="mm-input" id="drink-date" type="date" value="${today}">
        </div>

        <div class="mm-field">
          <label class="mm-label">Commentaire de dégustation</label>
          <textarea class="mm-input mm-textarea" id="drink-comment"
            placeholder="Vos impressions : arômes, accord, contexte..."></textarea>
        </div>

        <div class="mm-notes" style="border-left-color:${t.color}">
          La bouteille sera retirée de la cave et conservée dans votre journal de dégustation.
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-drink" id="drink-submit">🍷 Valider la dégustation</button>
      </div>`;
  }

  _bindDrinkForm(box, wine) {
    // Sélecteur d'étoiles
    const stars  = box.querySelectorAll(".mm-star");
    const hidden = box.querySelector("#drink-rating");
    const paint = (val) => stars.forEach((s) => {
      s.textContent = parseInt(s.dataset.star) <= val ? "★" : "☆";
      s.classList.toggle("mm-star--on", parseInt(s.dataset.star) <= val);
    });
    stars.forEach((s) => {
      s.addEventListener("click", () => {
        const v = parseInt(s.dataset.star);
        hidden.value = v;
        paint(v);
      });
    });

    box.querySelector("#drink-submit")?.addEventListener("click", async () => {
      const btn     = box.querySelector("#drink-submit");
      const slotIdx = parseInt(box.querySelector("#drink-slot")?.value) || 0;
      const rating  = parseFloat(hidden.value) || 0;
      const comment = box.querySelector("#drink-comment")?.value?.trim() || "";
      const drunk   = box.querySelector("#drink-date")?.value || "";
      btn.textContent = "⏳ Enregistrement...";
      btn.disabled = true;
      try {
        await this._hass.callService(DOMAIN, "drink_bottle", {
          wine_id:    wine.id,
          slot_idx:   slotIdx,
          rating,
          comment,
          drunk_date: drunk,
        });
        this._closeModal();
        setTimeout(() => this._fetchData(), 600);
        this._showToast("success", "Dégustation enregistrée 🍷");
      } catch (err) {
        btn.textContent = "🍷 Valider la dégustation";
        btn.disabled = false;
        this._showToast("error", "Erreur : " + (err.message || err));
      }
    });
  }

  // ── Journal de dégustation ────────────────────────────────────────────────────

  _journalHTML() {
    const log = (this._data?.cellar?.tasting_log || []).slice().reverse();
    const totalSpent = log.reduce((s, e) => s + (parseFloat(e.price) || 0), 0);
    const rated = log.filter(e => (e.my_rating || 0) > 0);
    const avg = rated.length ? (rated.reduce((s, e) => s + e.my_rating, 0) / rated.length) : 0;

    return `
      <div class="mm-header">
        <span class="mm-title">📓 Journal de dégustation</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        ${log.length === 0 ? `
          <div style="text-align:center;padding:30px 0;color:var(--mm-muted,#555)">
            <div style="font-size:2.46em;margin-bottom:10px">🍷</div>
            <div>Aucune bouteille dégustée pour l'instant.</div>
            <div style="font-size:0.85em;margin-top:6px">Cliquez « J'ai bu cette bouteille » sur une fiche.</div>
          </div>` : `
          <div class="hist-summary">
            <div class="hist-stat">
              <span class="hist-val">${log.length}</span>
              <span class="hist-lbl">Dégustées</span>
            </div>
            <div class="hist-stat">
              <span class="hist-val">${avg > 0 ? avg.toFixed(1) : "—"}</span>
              <span class="hist-lbl">Note moy.</span>
            </div>
            <div class="hist-stat">
              <span class="hist-val">${Math.round(totalSpent)}€</span>
              <span class="hist-lbl">Total</span>
            </div>
          </div>
          <div class="journal-list">
            ${log.map((e) => {
              const t = WINE_TYPES[e.type] || WINE_TYPES.red;
              const r = parseFloat(e.my_rating) || 0;
              const stars = r > 0 ? "★".repeat(Math.round(r)) + "☆".repeat(5 - Math.round(r)) : "—";
              return `
              <div class="journal-row">
                <div class="journal-main">
                  <span class="journal-dot" style="background:${t.color}"></span>
                  <div style="flex:1;min-width:0">
                    <div class="journal-name">${esc(e.name)}${e.vintage ? " " + esc(e.vintage) : ""}</div>
                    <div class="journal-sub">${[e.producer, e.appellation].filter(Boolean).map(esc).join(" · ")}</div>
                    ${e.my_comment ? `<div class="journal-comment">« ${esc(e.my_comment)} »</div>` : ""}
                  </div>
                  <button class="journal-del" data-del-tasting="${esc(e.id)}" title="Supprimer">✕</button>
                </div>
                <div class="journal-meta">
                  <span class="journal-stars" style="color:${t.color}">${stars}</span>
                  <span class="journal-date">📅 ${esc(e.drunk_date || "?")}</span>
                  ${e.price ? `<span class="journal-price">${esc(String(e.price))}€</span>` : ""}
                </div>
              </div>`;
            }).join("")}
          </div>`}
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
      </div>`;
  }

  _bindJournal(box) {
    box.querySelectorAll("[data-del-tasting]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await this._confirm("Supprimer cette dégustation du journal ?"))) return;
        try {
          await this._hass.callService(DOMAIN, "delete_tasting", { tasting_id: btn.dataset.delTasting });
          await new Promise(r => setTimeout(r, 500));
          await this._fetchData();
          box.innerHTML = this._journalHTML();
          this._bindJournal(box);
          box.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => this._closeModal()));
        } catch (err) {
          this._showToast("error", "Erreur : " + (err.message || err));
        }
      })
    );
  }

  // ── Recherche par nom dans toute la cave ─────────────────────────────────────

  _searchModalHTML() {
    return `
      <div class="mm-header">
        <span class="mm-title">🔍 Rechercher une bouteille</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-search-wrap" style="margin-bottom:12px">
          <span class="mm-search-icon">🔍</span>
          <input class="mm-input mm-search-input" id="gsearch-query"
            placeholder="Nom, producteur, appellation..." autocomplete="off">
        </div>
        <div id="gsearch-results"></div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
      </div>`;
  }

  _bindSearchModal(box) {
    const input   = box.querySelector("#gsearch-query");
    const results = box.querySelector("#gsearch-results");

    const render = (q) => {
      const query = q.trim().toLowerCase();
      if (!query) {
        results.innerHTML = `<div class="mm-viv-loading">Tapez pour rechercher dans votre cave…</div>`;
        return;
      }
      const matches = (this._data?.wines || []).filter((w) =>
        [w.name, w.producer, w.appellation, w.region, w.vintage]
          .filter(Boolean).join(" ").toLowerCase().includes(query)
      );
      if (!matches.length) {
        results.innerHTML = `<div class="mm-viv-loading">Aucune bouteille trouvée pour « ${esc(q)} »</div>`;
        return;
      }
      results.innerHTML = matches.map((w) => {
        const t = WINE_TYPES[w.type] || WINE_TYPES.red;
        return `
        <div class="mm-viv-item gsearch-item" data-id="${esc(w.id)}">
          <span style="font-size:1.38em;flex-shrink:0">${t.emoji}</span>
          <div style="flex:1;min-width:0">
            <div class="mm-viv-name">${esc(w.name)}${w.vintage ? " " + esc(w.vintage) : ""}</div>
            <div class="mm-viv-sub">${[w.appellation, w.producer].filter(Boolean).map(esc).join(" · ")}</div>
            <div class="mm-slot-badges" style="margin-top:3px">${this._slotBadges(w.slots, w)}</div>
          </div>
          ${w.price ? `<span style="color:var(--mm-text);font-weight:600;font-size:0.92em;flex-shrink:0">${esc(String(w.price))}€</span>` : ""}
        </div>`;
      }).join("");

      results.querySelectorAll(".gsearch-item").forEach((el) =>
        el.addEventListener("click", () => {
          const wine = (this._data?.wines || []).find((x) => x.id === el.dataset.id);
          if (wine) {
            this._closeModal();
            this._openModal("detail", { wine });
          }
        })
      );
    };

    render("");
    input?.addEventListener("input", () => render(input.value));
    setTimeout(() => input?.focus(), 150);
  }

  // ── Déplacer le contenu d'un casier vers un autre ───────────────────────────

  _moveRackHTML(rack) {
    const racks = (this._data?.cellar?.racks || []).filter(f => f.id !== rack.id);
    const cnt = (this._data?.wines || []).reduce(
      (n, w) => n + (w.slots?.filter(s => s.rack_id === rack.id).length || 0), 0);
    return `
      <div class="mm-header">
        <span class="mm-title">📦 Déplacer le casier</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-notes mm-tasting" style="margin-bottom:14px">
          Déplacer les <strong>${cnt} bouteille(s)</strong> de « ${esc(rack.name)} » vers un autre casier.
          Les bouteilles seront placées dans les premiers emplacements libres.
        </div>
        <div class="mm-field">
          <label class="mm-label">Casier de destination *</label>
          <select class="mm-input" id="mv-dest">
            ${racks.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="mv-submit">Déplacer</button>
      </div>`;
  }

  _bindMoveRack(box, rack) {
    box.querySelector("#mv-submit")?.addEventListener("click", async () => {
      const btn  = box.querySelector("#mv-submit");
      const dest = box.querySelector("#mv-dest")?.value;
      if (!dest) { this._showToast("warning", "Sélectionnez une destination."); return; }

      const destRack = (this._data?.cellar?.racks || []).find(f => f.id === dest);
      const destTotal = destRack.slots || (destRack.columns || 8) * (destRack.shelves || 2);

      // Emplacements à déplacer (vin + index de slot) et occupation de la destination
      const toMove = [];
      const occupied = new Set();
      (this._data?.wines || []).forEach(w => w.slots?.forEach((s, i) => {
        if (s.rack_id === rack.id) toMove.push({ wine_id: w.id, slot_idx: i });
        if (s.rack_id === dest)     occupied.add(s.slot);
      }));
      const freeSlots = [];
      for (let i = 0; i < destTotal; i++) if (!occupied.has(i)) freeSlots.push(i);

      if (freeSlots.length < toMove.length) {
        this._showToast("error",
          `Pas assez de place : ${freeSlots.length} emplacement(s) libre(s) pour ${toMove.length} bouteille(s).`);
        return;
      }

      btn.textContent = "⏳ Déplacement...";
      btn.disabled = true;
      try {
        for (let i = 0; i < toMove.length; i++) {
          await this._hass.callService(DOMAIN, "move_slot", {
            wine_id:  toMove[i].wine_id,
            slot_idx: toMove[i].slot_idx,
            rack_id: dest,
            slot:     freeSlots[i],
          });
        }
        this._closeModal();
        setTimeout(() => this._fetchData(), 600);
        this._showToast("success", `${toMove.length} bouteille(s) déplacée(s) vers ${destRack.name} ✓`);
      } catch (err) {
        btn.textContent = "Déplacer";
        btn.disabled = false;
        this._showToast("error", "Erreur lors du déplacement : " + (err.message || err));
      }
    });
  }

  // ── Historique valeur cave ──────────────────────────────────────────────────

  _historyHTML() {
    const history = this._data?.cellar?.value_history || [];
    const last    = history[history.length - 1];
    return `
      <div class="mm-header">
        <span class="mm-title">📈 Valeur de la cave</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        ${history.length === 0 ? `
          <div style="text-align:center;padding:30px 0;color:var(--mm-muted,#555)">
            <div style="font-size:2.46em;margin-bottom:10px">📊</div>
            <div>Aucun historique enregistré.</div>
            <div style="font-size:0.85em;margin-top:6px">Utilisez "Enregistrer la valeur" pour commencer.</div>
          </div>` : `
          <div class="hist-summary">
            <div class="hist-stat">
              <span class="hist-val">${last?.value ?? 0} €</span>
              <span class="hist-lbl">Valeur actuelle</span>
            </div>
            <div class="hist-stat">
              <span class="hist-val">${last?.bottles ?? 0}</span>
              <span class="hist-lbl">Bouteilles</span>
            </div>
            <div class="hist-stat">
              <span class="hist-val">${history.length}</span>
              <span class="hist-lbl">Relevés</span>
            </div>
          </div>
          <div id="hist-chart-wrap" style="width:100%;height:180px;margin-top:12px;background:var(--mm-bg0,#0D0D0D);border-radius:8px;border:1px solid var(--mm-border,#222)"></div>
          <div class="hist-table">
            ${[...history].reverse().slice(0, 12).map(h => `
              <div class="hist-row">
                <span class="hist-date">${h.date}</span>
                <span class="hist-bottles">${h.bottles} 🍾</span>
                <span class="hist-price">${h.value} €</span>
              </div>`).join("")}
          </div>`}
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
        <button class="mm-btn mm-btn-primary" id="hist-snapshot">📸 Enregistrer la valeur</button>
      </div>`;
  }

  _bindHistory(box) {
    // Dessiner le graphique immédiatement (DOM pur, pas de timing)
    const wrap = box.querySelector("#hist-chart-wrap");
    if (wrap) this._renderChart(wrap, this._data?.cellar?.value_history || []);

    box.querySelector("#hist-snapshot")?.addEventListener("click", async () => {
      const btn = box.querySelector("#hist-snapshot");
      btn.textContent = "⏳ Enregistrement...";
      btn.disabled = true;
      try {
        // Appel direct (sans fermer le modal) ; laisser le backend persister avant de relire
        await this._hass.callService(DOMAIN, "value_snapshot", {});
        await new Promise(r => setTimeout(r, 600));
        await this._fetchData();
        // Rafraîchir le contenu du modal en place
        box.innerHTML = this._historyHTML();
        this._bindHistory(box);
        box.querySelectorAll("[data-close]").forEach(b =>
          b.addEventListener("click", () => this._closeModal()));
        this._showToast("success", "Valeur enregistrée ✓");
        // _bindHistory s'occupe déjà du chart via le wrap

      } catch(err) {
        btn.textContent = "📸 Enregistrer la valeur";
        btn.disabled = false;
        this._showToast("error", "Erreur : " + (err.message || err));
      }
    });

  }



  _renderChart(wrap, history) {
    wrap.innerHTML = "";

    const tv      = this._hass?.themes?.themes?.[this._hass?.themes?.theme] || {};
    const cBg     = tv['primary-background-color']  || '#0D0D0D';
    const cGrid   = tv['divider-color']              || '#222';
    const cMuted  = tv['secondary-text-color']       || '#555';
    const cText   = tv['primary-text-color']         || '#EDE0CC';
    const cAccent = tv['primary-color']              || '#C0392B';

    if (!history || history.length === 0) {
      wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${cMuted};font-size:0.92em;font-family:${this._fontSans||'Inter,sans-serif'}">Aucun relevé</div>`;
      return;
    }

    if (history.length === 1) {
      const h = history[0];
      wrap.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:${cMuted};font-size:0.92em;font-family:${this._fontSans||'Inter,sans-serif'};gap:6px">
        <div style="font-size:1.69em;font-weight:700;color:${cText};font-family:${this._fontSerif||'Playfair Display,serif'}">${h.value} €</div>
        <div>${h.date} · ${h.bottles} bouteilles</div>
        <div style="color:${cMuted};font-size:0.85em;margin-top:4px">Ajoutez un 2ᵉ relevé pour voir l'évolution</div>
      </div>`;
      return;
    }

    // ── SVG créé en DOM (pas en innerHTML) ──────────────────
    const NS  = "http://www.w3.org/2000/svg";
    const W   = wrap.offsetWidth || wrap.parentElement?.offsetWidth || 340;
    const H   = 180;
    const pad = { t: 18, r: 14, b: 30, l: 48 };
    const cw  = W - pad.l - pad.r;
    const ch  = H - pad.t - pad.b;

    const vals = history.map(h => h.value);
    const lo   = Math.min(...vals) - (Math.max(...vals) - Math.min(...vals)) * 0.12 || 0;
    const hi   = Math.max(...vals) + (Math.max(...vals) - Math.min(...vals)) * 0.12 || 1;
    const span = hi - lo || 1;

    const px = i => pad.l + (i / (history.length - 1)) * cw;
    const py = v => pad.t + ch - ((v - lo) / span) * ch;

    const mk = tag => document.createElementNS(NS, tag);
    const at = (el, attrs) => { Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; };

    const svg = at(mk("svg"), { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.style.cssText = "display:block;width:100%;height:100%";

    // Dégradé
    const defs = mk("defs");
    const grad = at(mk("linearGradient"), { id: "cg", x1:"0", y1:"0", x2:"0", y2:"1" });
    const s1   = at(mk("stop"), { offset:"0%",   "stop-color":cAccent, "stop-opacity":"0.4" });
    const s2   = at(mk("stop"), { offset:"100%", "stop-color":cAccent, "stop-opacity":"0.02" });
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

    // Fond
    svg.appendChild(at(mk("rect"), { x:0, y:0, width:W, height:H, fill:cBg }));

    // Grilles horizontales
    for (let g = 0; g <= 4; g++) {
      const v = hi - span * g / 4;
      const y = (pad.t + ch * g / 4).toFixed(1);
      svg.appendChild(at(mk("line"), { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke:cGrid, "stroke-width":"1" }));
      const txt = at(mk("text"), { x: pad.l - 5, y: (parseFloat(y) + 4).toFixed(1), "text-anchor":"end", fill:cMuted, "font-size":"10", "font-family":"Inter,sans-serif" });
      txt.textContent = Math.round(v) + "€";
      svg.appendChild(txt);
    }

    // Axe gauche
    svg.appendChild(at(mk("line"), { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + ch, stroke:cGrid, "stroke-width":"1" }));

    // Aire
    const pts = history.map((h, i) => `${px(i).toFixed(1)},${py(h.value).toFixed(1)}`).join(" ");
    const areaD = `M ${px(0).toFixed(1)},${py(vals[0]).toFixed(1)} ` +
      history.slice(1).map((h,i) => `L ${px(i+1).toFixed(1)},${py(h.value).toFixed(1)}`).join(" ") +
      ` L ${px(history.length-1).toFixed(1)},${(pad.t+ch).toFixed(1)} L ${px(0).toFixed(1)},${(pad.t+ch).toFixed(1)} Z`;
    svg.appendChild(at(mk("path"), { d: areaD, fill:"url(#cg)" }));

    // Courbe
    const line = at(mk("polyline"), { points: pts, fill:"none", stroke:cAccent, "stroke-width":"2.5", "stroke-linejoin":"round", "stroke-linecap":"round" });
    svg.appendChild(line);

    // Points + dates X
    const step = Math.max(1, Math.floor(history.length / 5));
    history.forEach((h, i) => {
      // Point
      const dot = at(mk("circle"), { cx: px(i).toFixed(1), cy: py(h.value).toFixed(1), r:"3.5", fill:cAccent, stroke:cBg, "stroke-width":"1.5" });
      svg.appendChild(dot);
      // Label X
      if (i % step === 0 || i === history.length - 1) {
        const xt = at(mk("text"), { x: px(i).toFixed(1), y: H - 8, "text-anchor":"middle", fill:cMuted, "font-size":"9", "font-family":"Inter,sans-serif" });
        xt.textContent = h.date.slice(5);
        svg.appendChild(xt);
      }
    });

    // Valeur sur le dernier point
    const last = history[history.length - 1];
    const lx = px(history.length - 1);
    const ly = py(last.value);
    const balloon = at(mk("rect"), { x: lx - 28, y: ly - 22, width: 56, height: 18, rx: 5, fill:cAccent });
    svg.appendChild(balloon);
    const blt = at(mk("text"), { x: lx, y: ly - 9, "text-anchor":"middle", fill:"white", "font-size":"10", "font-weight":"700", "font-family":"Inter,sans-serif" });
    blt.textContent = last.value + " €";
    svg.appendChild(blt);

    wrap.appendChild(svg);
  }


  _bindDetailButtons(box, wine) {

    // Badges d'emplacement cliquables : édition du format/commentaire de LA bouteille
    box.querySelectorAll(".mm-slot-badge--edit").forEach((el) =>
      el.addEventListener("click", () => {
        this._closeModal();
        this._openModal("slotedit", { wine, slotIdx: parseInt(el.dataset.slotIdx) || 0 });
      })
    );

    // Retirer tout le vin (toutes ses bouteilles)
    box.querySelector("#det-remove")?.addEventListener("click", async () => {
      const cnt = wine.slots?.length || 0;
      const msg = cnt > 1
        ? `Retirer "${wine.name}" et ses ${cnt} emplacements de la cave ?`
        : `Retirer "${wine.name}" de la cave ?`;
      if (await this._confirm(msg)) {
        this._selected = null;
        await this._callService("remove_wine", { wine_id: wine.id });
      }
    });

    // Modifier les infos du vin
    box.querySelector("#det-edit")?.addEventListener("click", () => {
      this._closeModal();
      this._openModal("bottle", { wine });
    });

    // Ajouter un emplacement
    box.querySelector("#det-dup")?.addEventListener("click", () => {
      this._closeModal();
      this._openModal("duplicate", { wine });
    });

    // J'ai bu cette bouteille
    box.querySelector("#det-drink")?.addEventListener("click", () => {
      this._closeModal();
      this._openModal("drink", { wine });
    });

    // Estimer le prix
    box.querySelector("#det-price")?.addEventListener("click", async () => {
      const btn   = box.querySelector("#det-price");
      const query = [wine.name, wine.vintage, wine.appellation].filter(Boolean).join(" ");
      if (!query) { this._showToast("warning", "Nom du vin manquant."); return; }

      btn.textContent = "⏳ Recherche...";
      btn.disabled    = true;

      const resp = await this._estimatePrice(query);

      if (resp.error || !resp.price) {
        btn.textContent = "💰 Prix";
        btn.disabled    = false;
        this._showToast("warning",
          resp.error === "invalid_key"
            ? "🔑 Clé Gemini requise pour estimer le prix."
            : resp.price === 0
              ? "Prix introuvable pour ce vin."
              : "Estimation impossible, réessayez."
        );
        return;
      }

      btn.textContent = `✅ ${resp.price} €`;

      // Mettre à jour la fiche prix affiché
      const priceEl = box.querySelector(".det-price-display");
      if (priceEl) priceEl.textContent = resp.price + " €";

      // Enregistrer après 1.5s
      setTimeout(async () => {
        await this._callService("update_wine", { wine_id: wine.id, price: resp.price });
        btn.textContent = "💰 Prix";
        btn.disabled    = false;
        this._showToast("success", `Prix mis à jour : ${resp.price} €`);
      }, 1500);
    });
  }

  // ── Rendu principal ───────────────────────────────────────────────────────────

  _fontCSS() {
    const ff = this._fontSans || "'Inter', sans-serif";
    const fs = (this._fsBase || 13) + 'px';
    return `<style>:host{font-family:${ff};font-size:${fs}}</style>`;
  }

  _renderLoading() {
    this.shadowRoot.innerHTML = CARD_CSS + this._fontCSS() + `
      <div class="card">
        <div class="loading-state"><div class="loading-glass">${GLASS_SVG}</div></div>
      </div>`;
  }

  _render() {
    const data   = this._data || DEFAULT_DATA();
    const racks = data.cellar?.racks || [];
    const wines  = data.wines || [];
    this.shadowRoot.innerHTML = CARD_CSS + this._fontCSS() + `
      <div class="card">
        ${this._renderHeader(data, wines)}
        ${this._renderFilters()}
        <div class="cellar">
          ${racks.length === 0
            ? this._renderEmpty()
            : (this._view === "3d"
                ? `<div class="view3d-stage" id="view3d-stage"></div>`
                : (() => {
                    const maxCols = Math.max(...racks.map(f => f.columns || 8), 1);
                    return racks.map((f, i) => this._renderRack(f, wines, i, maxCols)).join("");
                  })())}
        </div>
      </div>`;
    this._bindCardListeners(data, wines);
    if (this._view === "3d") this._mount3D(); else this._unmount3D();
  }

  _renderHeader(data, wines) {
    const total  = wines.reduce((s, w) => s + (w.slots?.length || 0), 0);
    const value  = wines.reduce((s, w) => s + (w.price || 0) * (w.slots?.length || 0), 0);
    const nRack = data.cellar?.racks?.length || 0;
    // Sélecteur de vue : liste déroulante unique (bouteilles 2D, pastilles, 3D)
    const viewSel = `
      <select class="view-select" id="sel-view" title="Mode d'affichage">
        ${[["2d", "▦ Bouteilles"], ["dot", "⠿ Pastilles"], ["3d", "🧊 3D"]]
          .map(([v, lbl]) => `<option value="${v}" ${this._view === v ? "selected" : ""}>${lbl}</option>`)
          .join("")}
      </select>`;
    // Menu déroulant des repères 3D (étiquette de planche / bulle / les deux)
    const labelSel = `
      <select class="opt-select opt-select-compact" id="sel-labelmode" title="Repères des étagères en 3D">
        ${[["plate", "🏷️ Étiquette"], ["bubble", "🔵 Bulle"], ["both", "Les deux"]]
          .map(([v, lbl]) => `<option value="${v}" ${this._labelMode === v ? "selected" : ""}>${lbl}</option>`)
          .join("")}
      </select>`;

    return `
      <div class="header">
        <div class="header-left">
          <div class="header-glass">${GLASS_SVG}</div>
          <div class="header-meta">
            <div class="header-name">${esc(data.cellar?.name || "Millésime")}</div>
            <div class="header-tagline">Cave à vin</div>
          </div>
        </div>
        <div class="header-right">
          <div class="header-stats">
            <div class="stat"><span class="stat-value">${total}</span><span class="stat-label">Bouteilles</span></div>
            <div class="stat"><span class="stat-value">${nRack}</span><span class="stat-label">Casiers</span></div>
            <div class="stat stat-clickable" id="btn-history" title="Évolution de la valeur de la cave">
              <span class="stat-value">${value > 0 ? Math.round(value) + "€" : "—"}</span><span class="stat-label">Valeur</span>
            </div>
          </div>
          <div class="header-actions">
            <div class="ha-icons">
              ${viewSel}
              <button class="btn-icon" id="btn-search"  title="Rechercher une bouteille">🔍</button>
              <button class="btn-icon" id="btn-journal" title="Journal de dégustation">📓</button>
              <button class="btn-icon" id="btn-options" title="Options" aria-label="Options">⚙️</button>
            </div>
            <button class="btn-primary" id="btn-add-bottle">+ Vin</button>
          </div>
        </div>
      </div>
      <div class="header-options ${this._optionsOpen ? "open" : ""}" id="header-options">
        <div class="opt-row">
          <button class="opt-btn opt-btn-accent" id="btn-add-rack" title="Ajouter un casier">➕ Ajouter un casier</button>
          <button class="opt-btn" id="btn-import"  title="Importer millesime_import_vinotag.csv">📥 Importer des données</button>
          <button class="opt-btn" id="btn-refresh" title="Compléter les fiches via Gemini + fusionner les doublons">♻️ Compléter les fiches</button>
          <div class="opt-field">
            <span class="opt-field-label">Repères 3D</span>
            ${labelSel}
          </div>
        </div>
      </div>`;
  }

  _renderFilters() {
    return `
      <div class="filters">
        <div class="filter-group">
          <span class="filter-label">Type</span>
          <select class="filter-select" id="sel-type">
            <option value="all" ${this._filter === "all" ? "selected" : ""}>Tous les vins</option>
            ${Object.entries(WINE_TYPES).map(([v, t]) =>
              `<option value="${v}" ${this._filter === v ? "selected" : ""}>${t.emoji} ${t.label}</option>`
            ).join("")}
          </select>
        </div>
        <div class="filter-group">
          <span class="filter-label">Événement</span>
          <select class="filter-select" id="sel-event">
            <option value="all" ${this._filterEvent === "all" ? "selected" : ""}>Tous</option>
            ${EVENT_TYPES.filter(e => e.v).map(e =>
              `<option value="${e.v}" ${this._filterEvent === e.v ? "selected" : ""}>${e.emoji} ${e.l}</option>`
            ).join("")}
          </select>
        </div>
      </div>`;
  }

  _renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-glass">${GLASS_SVG}</div>
        <div class="empty-title">Cave vide</div>
        <div class="empty-sub">Cliquez sur "+ Casier" pour commencer</div>
      </div>`;
  }

  _renderRack(rack, allWines, index, maxCols = null) {
    // Build a map: slotNumber → { wine, slotIdx }
    const slotMap = {};
    allWines.forEach(w => {
      w.slots?.forEach((s, si) => {
        if (s.rack_id === rack.id) slotMap[s.slot] = { wine: w, slotIdx: si, size: s.size };
      });
    });

    const cols  = rack.columns || 8;
    const total = rack.slots || cols * (rack.shelves || 2);
    const isAlt  = rack.layout === "alternating";
    const isAlt2 = rack.layout === "alternating_2d";
    const isQc   = rack.layout === "quinconce";
    const isCircleMode = this._view === "dot";
    const lm = this._config?.bottle_label || "none";
    // font-size:0.85em × line-height:1.3 = 14.3px + padding-top:1px → 16px par label
    const lblCount = (lm === "name_vintage" || lm === "vintage_name") ? 2 : lm === "none" ? 0 : 1;
    const labelExtraH = lblCount * Math.ceil((this._fsBase || 13) * 0.85 * 1.3 + 1);
    const rowH = (isCircleMode ? 40 : 80) + labelExtraH;
    const pct   = Math.round((Object.keys(slotMap).length / total) * 100);

    const byType = {};
    Object.values(slotMap).forEach(({ wine }) => {
      byType[wine.type] = (byType[wine.type] || 0) + 1;
    });
    const counters = Object.entries(byType)
      .map(([t, n]) => `<span class="type-count" style="color:${WINE_TYPES[t]?.color || "#C0392B"}">${n}x</span>`)
      .join("");

    const _dot = (i, extraStyle = "") => {
      const entry   = slotMap[i];
      const wine    = entry?.wine || null;
      const slotIdx = entry?.slotIdx ?? -1;
      const filteredType  = this._filter !== "all" && wine && wine.type !== this._filter;
      const filteredEvent = this._filterEvent !== "all" && wine && (wine.event || "") !== this._filterEvent;
      const filtered = filteredType || filteredEvent;
      const wt  = wine ? WINE_TYPES[wine.type] || WINE_TYPES.red : null;
      const sel = wine && wine.id === this._selected;
      const shelf2d = Math.floor(i / cols);
      const col2d = i % cols;
      const alt = (isAlt && i % 2 === 1) || (isAlt2 && (shelf2d + col2d) % 2 === 1);
      const dotStyle = wine ? `--dot-glow:${wt.glow};opacity:${filtered ? 0.15 : 1}` : "";
      const isCircle = this._view === "dot";

      let labelEls = "";
      if (lm !== "none") {
        const nm = wine ? (wine.name || "").trim() : "";
        const yr = wine ? (wine.vintage || "").trim() : "";
        const short = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
        const nbsp = s => s.replace(/ /g, "\u00A0");
        // transparent pour les cases vides, coloré pour les vins
        const col = wine ? `color:${wt.color}` : `color:transparent`;
        const lbl = t => `<span class="dot-lbl" style="${col};display:flex;justify-content:center;align-items:center;width:100%">${t}</span>`;
        const ph = "\u00A0"; // placeholder invisible qui conserve la hauteur de ligne
        if      (lm === "vintage")      labelEls = lbl(yr || ph);
        else if (lm === "name")         labelEls = lbl(nm ? nbsp(short(nm, 15)) : ph);
        else if (lm === "name_vintage") labelEls = lbl(nm ? nbsp(short(nm, 12)) : ph) + lbl(yr || ph);
        else if (lm === "vintage_name") labelEls = lbl(yr || ph) + lbl(nm ? nbsp(short(nm, 12)) : ph);
      }

      // En mode cercle + tête-bêche : positions alternées = cercle plus petit (pas de rotation)
      const circleSize = isCircle ? (alt ? 28 : 40) : 40;
      const bottleContent = wine
        ? (isCircle
            ? `<svg class="dot-svg-c" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg" style="width:${circleSize}px;height:${circleSize}px;display:block"><circle cx="5" cy="5" r="5" fill="${wt.color}"/><circle cx="5" cy="5" r="5" fill="white" opacity="0.12"/><ellipse cx="3.5" cy="3.5" rx="1.5" ry="1" fill="white" opacity="0.2"/></svg>`
            : BOTTLE_MINI(wt.color, Math.round(80 * 10 / 26), wine.type, alt, entry.size || wine.size))
        : (isCircle
            ? `<svg class="dot-svg-c" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg" style="width:${circleSize}px;height:${circleSize}px;display:block"><circle cx="5" cy="5" r="4.5" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" stroke-dasharray="1.8 1.2"/></svg>`
            : BOTTLE_GHOST(Math.round(80 * 10 / 26)));

      // mode dot : seule la hauteur est imposée inline (width:100% vient du CSS, le SVG est centré par justify-content:center)
      const sizeStyle = isCircle ? `height:40px;` : ``;
      const dotEl = `<div
        class="dot ${wine ? "dot--filled" : "dot--empty"} ${sel ? "dot--selected" : ""} ${!isCircle && alt ? "dot--alt" : ""} ${isCircle && alt ? "dot--c-alt" : ""}"
        data-slot="${i}" data-rack-id="${rack.id}" data-wine-id="${wine?.id || ""}" data-slot-idx="${slotIdx}"
        style="${[dotStyle, sizeStyle].filter(Boolean).join(";")}"
        title="${wine
          ? esc(wine.name) + (wine.vintage ? " " + esc(wine.vintage) : "") + " — " + esc(this._slotLabel({ rack_id: rack.id, slot: i }))
          : esc(this._slotLabel({ rack_id: rack.id, slot: i })) + " — cliquer pour ajouter"}"
      >${bottleContent}</div>`;

      const labelsHtml = labelEls ? `<div class="dot-labels" style="height:${labelExtraH}px">${labelEls}</div>` : "";
      const cellStyle = `height:${rowH}px;${extraStyle}`;
      return `<div class="dot-cell${lm !== "none" ? " dot-cell--labeled" : ""}" style="${cellStyle}">${dotEl}${labelsHtml}</div>`;
    };

    let dots = "";
    let dotsStyle = `grid-template-columns:repeat(${cols},1fr);grid-auto-rows:${rowH}px`;

    if (isQc) {
      // Grille double-colonne : chaque bouteille occupe 2 colonnes
      // Les étagères impaires sont décalées d'une colonne → quinconce parfait
      dotsStyle = `grid-template-columns:repeat(${cols * 2 + 1},1fr);grid-auto-rows:${rowH}px;padding-top:4px`;
      const numRows = Math.ceil(total / cols);
      for (let row = 0; row < numRows; row++) {
        const odd = row % 2 === 1;
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (i >= total) break;
          const gc = odd ? col * 2 + 2 : col * 2 + 1;
          dots += _dot(i, `grid-column:${gc}/span 2`);
        }
      }
    } else {
      for (let i = 0; i < total; i++) dots += _dot(i);
    }

    // Un casier = un meuble : largeur proportionnelle à ses colonnes (cellules de
    // taille constante d'un casier à l'autre), centré — comme en 3D. Les ~72px
    // compensent les éléments fixes (compteurs, actions, gouttières).
    const ratio = maxCols ? Math.min(1, cols / maxCols) : 1;
    const widthStyle = ratio < 1
      ? `width:calc((100% - 72px) * ${ratio.toFixed(3)} + 72px);align-self:center;`
      : "";
    // Identité du casier : essence de bois (bordure + bandeau) et liseré d'accent ;
    // les casiers en fer forgé ont un bandeau métal sombre
    const st = this._rackLook(rack, index);
    const isIron = st.iron;
    const labelStyle = isIron
      ? `background:linear-gradient(90deg,#15151A,#34343E,#525260,#34343E,#15151A);` +
        `border-color:#525260;border-bottom:3px solid ${st.accent};color:#F2E8D5;`
      : `background:linear-gradient(90deg,${st.wood.dark},${st.wood.side},${st.wood.top},${st.wood.side},${st.wood.dark});` +
        `border-color:${st.wood.top};border-bottom:3px solid ${st.accent};` +
        `color:${st.wood.lt ? "#2E2115" : "#F2E8D5"};`;
    return `
      <div class="rack" style="animation-delay:${index * 0.06}s;${widthStyle}">
        <div class="rack-frame" style="border-color:${isIron ? "#4A4A55" : st.wood.side}">
          <div class="rack-counters">${counters}</div>
          <div class="rack-dots" style="${dotsStyle}">${dots}</div>
          <div class="rack-actions">
            <button class="icon-btn" data-edit-rack="${esc(rack.id)}" title="Modifier">⚙</button>
            <button class="icon-btn" data-move-rack="${esc(rack.id)}" title="Déplacer le contenu">📦</button>
            <button class="icon-btn" data-del-rack="${esc(rack.id)}"  title="Supprimer">✕</button>
          </div>
        </div>
        <div class="rack-label" style="${labelStyle}">
          <span>${esc(rack.name)}</span><span class="rack-pct" style="color:${st.wood.lt ? "#5F4A30" : st.wood.top}">${pct}%</span>
        </div>
      </div>`;
  }

  // ── Permutation de deux emplacements occupés ─────────────────────────────────
  // Le backend interdit de déposer sur un slot occupé → swap en 3 étapes via un
  // slot libre temporaire. Utilisé par le drag & drop 2D et 3D.

  async _swapViaTemp(src, tgt) {
    const data  = this._data || DEFAULT_DATA();
    const wines = data.wines || [];
    const occupied = new Set();
    wines.forEach(w => w.slots?.forEach(s => occupied.add(`${s.rack_id}:${s.slot}`)));
    let tempRackId = null, tempSlot = -1;
    for (const rack of (data.cellar?.racks || [])) {
      const total = rack.slots || (rack.columns || 8) * (rack.shelves || 2);
      for (let i = 0; i < total; i++) {
        if (!occupied.has(`${rack.id}:${i}`)) { tempRackId = rack.id; tempSlot = i; break; }
      }
      if (tempSlot !== -1) break;
    }
    if (tempSlot === -1) {
      this._showToast("error", "Cave pleine : permutation impossible.");
      return;
    }
    // Silence des mises à jour pendant la séquence : les 3 move_slot déclenchent
    // chacun un événement millesime_updated → sans ce verrou, on voit les états
    // intermédiaires (bouteille sur le slot temporaire) défiler à l'écran
    this._squelchUpdates = true;
    try {
      // 1. Libérer le slot source en déplaçant A vers le slot libre
      await this._hass.callService(DOMAIN, "move_slot", { wine_id: src.wineId, slot_idx: src.slotIdx, rack_id: tempRackId, slot: tempSlot });
      // 2. Déplacer B vers l'ancien slot de A (maintenant libre)
      await this._hass.callService(DOMAIN, "move_slot", { wine_id: tgt.wineId, slot_idx: tgt.slotIdx, rack_id: src.rackId, slot: src.slot });
      // 3. Déplacer A depuis le slot temporaire vers l'ancien slot de B (maintenant libre)
      await this._hass.callService(DOMAIN, "move_slot", { wine_id: src.wineId, slot_idx: src.slotIdx, rack_id: tgt.rackId, slot: tgt.slot });
    } catch (err) {
      this._showToast("error", `Erreur permutation : ${err.message || JSON.stringify(err)}`);
    } finally {
      this._squelchUpdates = false;
    }
    await this._fetchData();           // un seul rendu, avec l'état final
  }

  // ════════════════════════════════════════════════════════════════════
  //  VUE 3D — moteur Three.js (WebGL) : éclairage studio, ombres douces
  // ════════════════════════════════════════════════════════════════════

  _loadThree() {
    if (!this._threeModP) {
      this._threeModP = import("https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js");
    }
    return this._threeModP;
  }

  _unmount3D() {
    const t = this._three;
    if (!t) return;
    try {
      t.ro?.disconnect();
      window.removeEventListener("orientationchange", t.onOrient);
      const el = t.renderer.domElement;
      el.removeEventListener("webglcontextlost", t.onCtxLost);
      el.removeEventListener("webglcontextrestored", t.onCtxRestored);
      el.removeEventListener("click", t.onPick);
      el.removeEventListener("pointerdown", t.onDown);
      el.removeEventListener("pointermove", t.onMove);
      el.removeEventListener("pointerup", t.onUp);
      el.removeEventListener("pointercancel", t.onCancel);
      t.scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          // Libérer TOUTES les textures du matériau (pas seulement .map) : envMap,
          // bumpMap, etc. sinon elles fuient d'un montage à l'autre.
          for (const v of Object.values(m)) v?.isTexture && v.dispose?.();
          m.dispose();
        });
      });
      t.renderer.dispose();
      // Libérer IMMÉDIATEMENT le contexte WebGL. Sans ça, dispose() seul laisse le
      // contexte vivant jusqu'au GC : les remontages (rotation/reconnexion) les
      // accumulent, le navigateur tue les plus anciens (limite ~16 contextes) et
      // crache des "GL_INVALID_OPERATION / Texture is immutable". Les écouteurs
      // contextlost/restored ont été retirés ci-dessus → pas de boucle de remontage.
      t.renderer.forceContextLoss?.();
      el.remove();
    } catch (e) { /* noop */ }
    this._three = null;
  }

  // Profils de révolution (r, y) par forme de bouteille
  _bottleProfile(THREE, kind = "bordeaux") {
    // Profils partagés avec la 2D (BOTTLE_PROFILES) — source unique, normalisés
    // au rayon commun BOTTLE_R (diamètre identique pour toutes les bouteilles)
    return _normProfile(BOTTLE_PROFILES[kind] || BOTTLE_PROFILES.bordeaux).map(([x, y]) => new THREE.Vector2(x, y));
  }

  async _mount3D() {
    this._unmount3D();
    const mountTok = (this._mountTok = (this._mountTok || 0) + 1);
    const stage = this.shadowRoot.getElementById("view3d-stage");
    if (!stage) return;
    // Conserver la hauteur précédente pendant le remontage (évite le saut de scroll)
    const prevH = this._lastH3D || 0;
    if (prevH > 60) stage.style.height = prevH + "px";
    stage.innerHTML = `<div class="three-loading"><span class="mm-spinner"></span> Vue 3D…</div>`;

    let THREE;
    try {
      THREE = await this._loadThree();
    } catch (e) {
      this._showToast("warning", "Vue 3D indisponible (chargement WebGL). Retour à la vue 2D.");
      this._view = "2d";
      this._viewTouched = true;   // ne pas re-basculer en 3D si setConfig est rappelé
      this._render();
      return;
    }
    // Le rendu a pu changer pendant le chargement (ou un montage plus récent a pris la main)
    if (mountTok !== this._mountTok) return;
    if (this._view !== "3d" || !this.shadowRoot.getElementById("view3d-stage")) return;

    const data   = this._data || DEFAULT_DATA();
    const racks = data.cellar?.racks || [];
    const wines  = data.wines || [];
    if (!racks.length) { stage.innerHTML = ""; return; }

    // slot occupé → { wine, slotIdx }
    const slotOf = {};
    wines.forEach(w => w.slots?.forEach((s, si) => {
      slotOf[`${s.rack_id}:${s.slot}`] = { wine: w, slotIdx: si, size: s.size };
    }));

    const width = stage.clientWidth || 360;

    // ── Scène ──
    const scene = new THREE.Scene();

    // ── Lumières (studio doux) ──
    scene.add(new THREE.AmbientLight(0xfff4e0, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(5, 12, 9);
    if (SHADOWS_3D_PCF) {                       // PCF projeté — inactif par défaut
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0004;
      key.shadow.radius = 5;
    }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d4ff, 0.35);
    fill.position.set(-6, 4, 5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe2c0, 0.3);
    rim.position.set(0, 6, -8);
    scene.add(rim);

    // ── Géométries partagées, par forme de bouteille ──
    // Bouteille couchée le long de Z, goulot vers le spectateur (+Z), posée sur le dos.
    // `rest` = rayon max (hauteur de repos) ; l'étiquette est placée sur le bas du fût,
    // bande centrée vers le haut (après rotateX(π/2), "haut" = -cosθ → bande sur θ=π).
    const mkSet = (kind, o) => {
      const xf = (g) => { g.rotateX(Math.PI / 2); g.translate(0, o.rest, -1.86); return g; };
      const set = {
        rest:   o.rest,
        // Extrémité avant (pointe du bouchon, plaque bombée comprise sur
        // l'effervescent) en coordonnées locales — pour l'alignement au bord avant
        tip:    o.corkY + o.corkH / 2 - 1.86 + (o.muselet ? 0.085 : 0),
        body:   xf(new THREE.LatheGeometry(this._bottleProfile(THREE, kind), 48)),
        // capPts (optionnel) : coiffe galbée en profil de révolution (champenoise) —
        // taille resserrée sur le col puis renflement épousant la tête du bouchon.
        // Sinon capsule cylindrique/conique classique (capR/capR2).
        cap:    o.capPts
          ? xf(new THREE.LatheGeometry(o.capPts.map(([r, y]) => new THREE.Vector2(r, y)), 24))
          : xf(new THREE.CylinderGeometry(o.capR, o.capR2 || o.capR, o.capH, 24).translate(0, o.capY, 0)),
        // corkR2 (optionnel) : taille basse ≠ tête → bouchon champignon (champenoise)
        cork:   xf(new THREE.CylinderGeometry(o.corkR, o.corkR2 || o.corkR, o.corkH, 18).translate(0, o.corkY, 0)),
        // Tête bombée + cercles concentriques : réservés au bouchon champignon
        // (sur les vins tranquilles, le petit bouchon droit rendait mieux sans)
        // Calotte écrasée (0.26) : son apex reste SOUS la plaque métallique — seul
        // l'anneau de liège déborde autour, le centre reste métal
        corkTop: o.muselet
          ? xf(new THREE.SphereGeometry(o.corkR, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)
              .scale(1, 0.26, 1).translate(0, o.corkY + o.corkH / 2, 0))
          : null,
        // colR2 (optionnel) : collerette conique épousant le col (champenoise)
        collar: xf(new THREE.CylinderGeometry(o.colR, o.colR2 || o.colR, o.colH, 24, 1, true).translate(0, o.colY, 0)),
        label:  xf(new THREE.CylinderGeometry(o.labelR, o.labelR, o.labelH, 32, 1, true, Math.PI - 1.05, 2.1).translate(0, o.labelY, 0)),
      };
      if (o.muselet) {
        // Muselet : ceinture autour de la bague + 4 brins inclinés sur la tête + plaque
        const ring = new THREE.TorusGeometry(0.19, 0.012, 8, 28);
        ring.rotateX(Math.PI / 2);
        ring.translate(0, 3.67, 0);
        const wires = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => {
          const wg = new THREE.CylinderGeometry(0.012, 0.012, 0.30, 6);
          wg.translate(0, 0.15, 0);    // pied du brin à l'origine
          wg.rotateZ(0.15);            // presque droits, jusqu'au bord de la plaque
          wg.translate(0.19, 3.67, 0);
          wg.rotateY(a);
          return wg;
        });
        // Rebord serti autour de la plaque (définit le cercle, accroche la lumière)
        const rim = new THREE.TorusGeometry(0.145, 0.012, 8, 28);
        rim.rotateX(Math.PI / 2);
        rim.translate(0, 3.964, 0);
        // Les 4 encoches : griffes du fil qui mordent sur le bord de la plaque,
        // dans l'axe de chaque brin
        const clips = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => {
          const cg = new THREE.BoxGeometry(0.075, 0.02, 0.028); // radial × épaisseur × tangentiel
          cg.translate(0.140, 3.976, 0);                        // à cheval sur le rebord
          cg.rotateY(a);
          return cg;
        });
        set.muselet = [ring, rim, ...wires, ...clips].map(xf);
        // Plaque BOMBÉE (emboutie) : une face plate renvoie un reflet uniforme et
        // paraît plate — la calotte fait glisser le reflet sur la courbure
        set.plaque  = xf(new THREE.SphereGeometry(0.145, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2)
          .scale(1, 0.22, 1).translate(0, 3.962, 0));
        // Blason : décalque circulaire posé juste au-dessus de la calotte
        set.plaqueDecal = xf(new THREE.CircleGeometry(0.112, 24).rotateX(-Math.PI / 2).translate(0, 3.999, 0));
      }
      return set;
    };
    // Mêmes 5 formes que la vue 2D (profils partagés normalisés) : diamètre commun
    // BOTTLE_R partout → rest et labelR identiques pour toutes les formes
    const setBordeaux  = mkSet("bordeaux",  { rest: 0.43, capR: 0.165, capH: 0.36, capY: 3.53, corkR: 0.125, corkH: 0.16, corkY: 3.76, colR: 0.15,  colH: 0.18, colY: 3.15, labelR: 0.44, labelH: 0.95, labelY: 1.05 });
    const setLoire     = mkSet("loire",     { rest: 0.43, capR: 0.155, capH: 0.36, capY: 3.53, corkR: 0.12,  corkH: 0.16, corkY: 3.76, colR: 0.16,  colH: 0.16, colY: 3.28, labelR: 0.44, labelH: 0.90, labelY: 1.00 });
    const setFlute     = mkSet("flute",     { rest: 0.43, capR: 0.155, capH: 0.36, capY: 3.53, corkR: 0.12,  corkH: 0.16, corkY: 3.76, colR: 0.155, colH: 0.16, colY: 3.30, labelR: 0.44, labelH: 0.85, labelY: 0.95 });
    const setRose      = mkSet("rose",      { rest: 0.43, capR: 0.16,  capH: 0.40, capY: 3.51, corkR: 0.12,  corkH: 0.16, corkY: 3.76, colR: 0.148, colH: 0.18, colY: 3.05, labelR: 0.44, labelH: 0.90, labelY: 0.98 });
    const setBourgogne = mkSet("bourgogne", { rest: 0.43, capR: 0.17,  capH: 0.36, capY: 3.53, corkR: 0.125, corkH: 0.16, corkY: 3.76, colR: 0.155, colH: 0.18, colY: 3.28, labelR: 0.44, labelH: 0.95, labelY: 1.00 });
    // Champenoise : coiffe conique épousant la pente du col, collerette en jupe
    // descendant loin sur le col (continuité avec la coiffe), bouchon champignon plus large
    const setChampagne = mkSet("champagne", { rest: 0.43,
      capPts: [[0.195, 3.22], [0.175, 3.36], [0.163, 3.50], [0.162, 3.58], [0.174, 3.66], [0.197, 3.72], [0.21, 3.755], [0.205, 3.775], [0.12, 3.78]],
      corkR: 0.195, corkR2: 0.135, corkH: 0.18, corkY: 3.82,
      colR: 0.19, colR2: 0.26, colH: 0.60, colY: 2.92,
      labelR: 0.44, labelH: 0.85, labelY: 0.95, muselet: true });
    const geoByType = {
      red:       setBourgogne,  // bourguignonne — corps large, épaule conique
      white:     setBordeaux,   // bordelaise (verre clair, épaule marquée)
      rose:      setRose,       // bordelaise au col allongé (type Provence/Loire)
      sparkling: setChampagne,
      dessert:   setBordeaux,   // bordelaise aussi (Sauternes/Monbazillac)
    };

    // Emplacement vide : projection à plat d'une bordelaise (couchée comme les
    // bouteilles, orientée selon la parité du slot) — un peu plus étroite que les
    // vraies bouteilles pour bien se distinguer
    const ghostPts = _normProfile(BOTTLE_PROFILES.bordeaux).slice(1, -1)
      .map(([r, y]) => [r * 0.85, y]);
    const ghostShape = new THREE.Shape();
    ghostPts.forEach(([r, y], i) => {
      const yy = 1.86 - y;                       // goulot → +Z après rotateX(-π/2)
      if (i === 0) ghostShape.moveTo(r, yy); else ghostShape.lineTo(r, yy);
    });
    [...ghostPts].reverse().forEach(([r, y]) => ghostShape.lineTo(-r, 1.86 - y));
    const emptyGeo = new THREE.ShapeGeometry(ghostShape);
    emptyGeo.rotateX(-Math.PI / 2);
    // Contour de la silhouette (remplace l'anneau)
    const ghostEdge = new THREE.BufferGeometry().setFromPoints(
      ghostPts.map(([r, y]) => new THREE.Vector3(r, 0, -(1.86 - y)))
        .concat([...ghostPts].reverse().map(([r, y]) => new THREE.Vector3(-r, 0, -(1.86 - y))))
    );

    // ── Ombre de contact (MODE ACTIF, SHADOWS_3D_PCF=false) : halo doux posé sur
    //    la planche, sous chaque bouteille. Léger ; pas d'ombre d'une étagère sur
    //    l'autre. Le matériau/géométrie sont créés ici, le mesh par bouteille n'est
    //    ajouté que si le mode PCF est désactivé (voir plus bas).
    const _shCv = document.createElement("canvas");
    _shCv.width = _shCv.height = 128;
    const _shx = _shCv.getContext("2d");
    const _shg = _shx.createRadialGradient(64, 64, 5, 64, 64, 62);
    _shg.addColorStop(0, "rgba(0,0,0,0.42)");
    _shg.addColorStop(0.6, "rgba(0,0,0,0.16)");
    _shg.addColorStop(1, "rgba(0,0,0,0)");
    _shx.fillStyle = _shg; _shx.fillRect(0, 0, 128, 128);
    const contactTex = new THREE.CanvasTexture(_shCv);
    contactTex.colorSpace = THREE.SRGBColorSpace;
    const contactMat = new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false });
    const contactGeo = new THREE.PlaneGeometry(1.05, 3.5);
    contactGeo.rotateX(-Math.PI / 2);

    // ── Matériaux par type de vin ──
    // TOUTES les bouteilles sont en verre transparent (le vin, à la couleur du
    // type, est visible au travers) — seuls les PROFILS diffèrent selon le type.
    // Teintes du verre : rouge → vert clair, blanc → brun clair (feuille morte),
    // effervescent → vert foncé champenois, rosé → clair, liquoreux → ambré doux
    const GLASS_3D = { red: 0x3E5C4A, white: 0xE4DDB0, rose: 0xF0E6DC, sparkling: 0x2F4A26, dessert: 0xF2EEE0 };
    // Environnement de réflexion réservé aux MÉTAUX (envMap par matériau, pas
    // scene.environment) : les capsules/plaques/muselets ont de vrais reflets,
    // sans rien changer au rendu du verre, du vin, du bois ni à l'éclairage
    const envCv = document.createElement("canvas");
    envCv.width = 256;
    envCv.height = 128;
    const ec = envCv.getContext("2d");
    const envGrad = ec.createLinearGradient(0, 0, 0, 128);
    envGrad.addColorStop(0, "#56503F");
    envGrad.addColorStop(0.5, "#2C2822");
    envGrad.addColorStop(1, "#14120E");
    ec.fillStyle = envGrad;
    ec.fillRect(0, 0, 256, 128);
    ec.fillStyle = "#FFF3DD";                  // « fenêtres » chaudes
    ec.fillRect(30, 16, 26, 36);
    ec.fillRect(150, 12, 40, 26);
    ec.fillStyle = "#D8E4F2";                  // contre-jour froid
    ec.fillRect(224, 30, 16, 32);
    const metalEnv = new THREE.CanvasTexture(envCv);
    metalEnv.mapping = THREE.EquirectangularReflectionMapping;
    metalEnv.colorSpace = THREE.SRGBColorSpace;

    // Godrons : plissé vertical des coiffes/capsules (bump map) — les reflets se
    // strient le long de la courbure, c'est ce qui donne la lecture du volume
    const fluteCv = document.createElement("canvas");
    fluteCv.width = 256;
    fluteCv.height = 64;
    const fc = fluteCv.getContext("2d");
    for (let px = 0; px < 256; px++) {
      const v = 150 + Math.round(90 * Math.sin((px / 256) * Math.PI * 2 * 36));
      fc.fillStyle = `rgb(${v},${v},${v})`;
      fc.fillRect(px, 0, 1, 64);
    }
    const fluteTex = new THREE.CanvasTexture(fluteCv);
    fluteTex.wrapS = fluteTex.wrapT = THREE.RepeatWrapping;

    const mats = {}, capMats = {}, fadedMats = {}, wineInMats = {};
    for (const [k, t] of Object.entries(WINE_TYPES)) {
      // Le verre FILTRE la robe (multiplicatif, comme en 2D) : la teinte est
      // pré-multipliée dans la couleur du vin selon la force du voile. Le calque
      // de verre ne sert plus qu'aux reflets (alpha faible) — un alpha fort ne
      // fait que moyenner les couleurs et délave tout en pastel.
      const voile = GLASS_VOILE[k] ?? 0.42;
      const filt = new THREE.Color(GLASS_3D[k] || 0xE7E2D4).lerp(new THREE.Color(0xffffff), 1 - voile);
      mats[k] = new THREE.MeshPhysicalMaterial({
        color: GLASS_3D[k] || 0xE7E2D4, roughness: 0.06, metalness: 0,
        transparent: true, opacity: k === "sparkling" ? 0.42 : 0.22,
        clearcoat: 1, clearcoatRoughness: 0.08,
      });
      // Translucidité par robe : partagée avec la 2D via WINE_OPACITY.
      // Légère émissivité = lumière transmise par le verre (les robes claires
      // paraissent lumineuses, pas ternies par l'ombre de la scène)
      const wineCol = new THREE.Color(WINE_IN[k] || t.color).multiply(filt);
      wineInMats[k] = new THREE.MeshStandardMaterial({
        color: wineCol,
        emissive: wineCol.clone().multiplyScalar(k === "red" ? 0.06 : k === "white" ? 0.30 : 0.22),
        roughness: 0.35, metalness: 0,
        transparent: true, opacity: WINE_OPACITY[k] ?? 0.88,
      });
      fadedMats[k] = mats[k].clone();
      fadedMats[k].transparent = true;
      fadedMats[k].opacity = 0.13;
      // Feuille métallisée vernie : metalness modéré + clearcoat, sinon un métal
      // pur sans envMap rend un aplat sombre sans aucun modelé
      capMats[k] = new THREE.MeshPhysicalMaterial({
        color: this._shade(t.color, 18), roughness: 0.3, metalness: 0.55,
        clearcoat: 0.85, clearcoatRoughness: 0.25,
        bumpMap: fluteTex, bumpScale: k === "sparkling" ? 0.035 : 0.012,
        envMap: metalEnv, envMapIntensity: 0.9,
      });
    }
    // Liège moucheté (grain + lenticelles) : texture canvas partagée par tous les bouchons
    const corkCv = document.createElement("canvas");
    corkCv.width = corkCv.height = 64;
    const cc = corkCv.getContext("2d");
    cc.fillStyle = "#C8A165";
    cc.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 64, y = Math.random() * 64, r = Math.random() * 1.6 + 0.4;
      cc.fillStyle = Math.random() < 0.72 ? "rgba(122,90,52,0.75)" : "rgba(238,216,172,0.7)";
      cc.beginPath();
      cc.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, 6.3);
      cc.fill();
    }
    const corkTex = new THREE.CanvasTexture(corkCv);
    corkTex.colorSpace = THREE.SRGBColorSpace;
    corkTex.wrapS = corkTex.wrapT = THREE.RepeatWrapping;
    const corkMat  = new THREE.MeshStandardMaterial({
      map: corkTex, roughness: 0.9, metalness: 0,
      bumpMap: corkTex, bumpScale: 0.028,   // grain du liège en relief
    });
    // Muselet : fil métallique sombre, plaque gris métal
    const museletMat = new THREE.MeshStandardMaterial({
      color: 0x807A6A, roughness: 0.35, metalness: 0.85,
      envMap: metalEnv, envMapIntensity: 0.9,
    });
    // Plaque : métal poli — reflets d'environnement appuyés + vernis
    const plaqueMat  = new THREE.MeshPhysicalMaterial({
      color: 0xD8D8D8, roughness: 0.10, metalness: 0.92,
      clearcoat: 1, clearcoatRoughness: 0.08,
      envMap: metalEnv, envMapIntensity: 1.35,
    });
    // Blason imprimé de la plaque (décalque transparent) : couronne, écu à bande
    // et lettrage circulaire factice, encre olive comme les vraies capsules
    const decalCv = document.createElement("canvas");
    decalCv.width = decalCv.height = 256;
    const dc = decalCv.getContext("2d");
    const ink = "#56523A";
    dc.fillStyle = ink;
    dc.beginPath();                                  // couronne
    dc.moveTo(104, 96); dc.lineTo(110, 80); dc.lineTo(120, 92); dc.lineTo(128, 76);
    dc.lineTo(136, 92); dc.lineTo(146, 80); dc.lineTo(152, 96);
    dc.closePath();
    dc.fill();
    dc.beginPath();                                  // écu
    dc.moveTo(100, 102); dc.lineTo(156, 102); dc.lineTo(156, 138);
    dc.quadraticCurveTo(156, 158, 128, 168);
    dc.quadraticCurveTo(100, 158, 100, 138);
    dc.closePath();
    dc.fill();
    dc.save();
    dc.clip();
    dc.strokeStyle = "rgba(255,255,255,0.8)";        // bande diagonale
    dc.lineWidth = 10;
    dc.beginPath(); dc.moveTo(94, 110); dc.lineTo(162, 162); dc.stroke();
    dc.restore();
    dc.strokeStyle = ink;                            // lettrage circulaire factice
    dc.lineWidth = 9;
    dc.lineCap = "round";
    for (let a = -2.55; a <= -0.6; a += 0.21) {
      dc.beginPath(); dc.arc(128, 128, 100, a, a + 0.10); dc.stroke();
    }
    for (let a = 0.6; a <= 2.55; a += 0.21) {
      dc.beginPath(); dc.arc(128, 128, 100, a, a + 0.10); dc.stroke();
    }
    const decalTex = new THREE.CanvasTexture(decalCv);
    decalTex.colorSpace = THREE.SRGBColorSpace;
    decalTex.anisotropy = 8;
    const plaqueDecalMat = new THREE.MeshStandardMaterial({
      map: decalTex, transparent: true, roughness: 0.55, metalness: 0.25,
    });
    const labelMat = new THREE.MeshStandardMaterial({ color: 0xEFE6D0, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });

    // ── Étiquettes texturées : blason, titre et fausses écritures (canvas par type) ──
    const mkLabelTex = (accent, labelName) => {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 256;
      const c2 = cv.getContext("2d");
      // labelName fourni par la bouteille (vrai nom du vin)
      // Fond crème + liseré
      c2.fillStyle = "#EFE6D0"; c2.fillRect(0, 0, 256, 256);
      c2.strokeStyle = accent; c2.lineWidth = 4; c2.strokeRect(13, 13, 230, 230);
      // Couronne
      c2.fillStyle = "#C9A84C";
      c2.beginPath();
      c2.moveTo(108, 40); c2.lineTo(114, 26); c2.lineTo(122, 36); c2.lineTo(128, 22);
      c2.lineTo(134, 36); c2.lineTo(142, 26); c2.lineTo(148, 40);
      c2.closePath(); c2.fill();
      // Écu avec bande diagonale
      c2.fillStyle = accent;
      c2.beginPath();
      c2.moveTo(104, 44); c2.lineTo(152, 44); c2.lineTo(152, 74);
      c2.quadraticCurveTo(152, 92, 128, 100);
      c2.quadraticCurveTo(104, 92, 104, 74);
      c2.closePath(); c2.fill();
      c2.save(); c2.clip();
      c2.strokeStyle = "rgba(255,255,255,0.75)"; c2.lineWidth = 9;
      c2.beginPath(); c2.moveTo(100, 50); c2.lineTo(156, 96); c2.stroke();
      c2.restore();
      // Titre en serif
      c2.fillStyle = "#3A3024"; c2.textAlign = "center";
      // Titre = nom réel du vin, taille auto-ajustée, jusqu'à 2 lignes
      const wineName = (labelName || "Millésime").trim() || "Millésime";
      c2.fillStyle = "#3A3024"; c2.textAlign = "center";
      const words = wineName.split(/\s+/);
      let ln1 = "", ln2 = "";
      for (const w of words) {
        if ((ln1 + " " + w).trim().length <= 14 && !ln2) ln1 = (ln1 + " " + w).trim();
        else ln2 = (ln2 + " " + w).trim();
      }
      if (ln2.length > 16) ln2 = ln2.slice(0, 15) + "…";
      const fsz = Math.max(18, 32 - Math.max(ln1.length, ln2.length));
      c2.font = `bold italic ${fsz}px Georgia, 'Times New Roman', serif`;
      if (ln2) { c2.fillText(ln1, 128, 132); c2.fillText(ln2, 128, 132 + fsz + 2); }
      else c2.fillText(ln1, 128, 142);
      // Lignes de fausse écriture
      c2.fillStyle = "#6B5E4A";
      c2.fillRect(58, 162, 140, 6);
      c2.fillRect(78, 182, 100, 5);
      c2.fillRect(96, 200, 64, 5);
      c2.fillStyle = accent;
      c2.fillRect(88, 222, 80, 7);
      return cv;
    };
    // Texture solidaire de la bouteille : sur une bouteille tête-bêche (lacet 180°),
    // le texte apparaît renversé — il suit le sens bouchon/culot, comme en 2D.
    // Étiquettes générées par (type + nom du vin), mises en cache
    const labelMatCache = new Map();
    const labelMatFor = (tp, name) => {
      const key = tp + "|" + ((name || "").trim() || "Millésime");
      if (labelMatCache.has(key)) return labelMatCache.get(key);
      const tex = new THREE.CanvasTexture(mkLabelTex(WINE_TYPES[tp].color, name));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.center.set(0.5, 0.5);
      tex.rotation = 0;
      const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
      });
      labelMatCache.set(key, mat);
      return mat;
    };
    // Bois texturé : grain en canvas, décliné par essence (RACK_WOODS, une essence
    // par casier via rackStyleOf) — matériaux mis en cache par essence
    const mkWoodTex = (base, dark) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      const c2 = cv.getContext("2d");
      c2.fillStyle = base;
      c2.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 46; i++) {                  // veines horizontales irrégulières
        const yy = Math.random() * 256;
        c2.strokeStyle = Math.random() < 0.72 ? dark : "#FFFFFF";
        c2.globalAlpha = 0.05 + Math.random() * 0.10;
        c2.lineWidth = 0.6 + Math.random() * 1.8;
        c2.beginPath();
        c2.moveTo(0, yy);
        c2.bezierCurveTo(85, yy + (Math.random() * 8 - 4), 170, yy + (Math.random() * 8 - 4), 256, yy + (Math.random() * 6 - 3));
        c2.stroke();
      }
      c2.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    };
    // Fer forgé : métal sombre légèrement verni
    const ironMat = new THREE.MeshPhysicalMaterial({
      color: 0x202027, roughness: 0.42, metalness: 0.6,
      clearcoat: 0.55, clearcoatRoughness: 0.3,
      envMap: metalEnv, envMapIntensity: 0.7,
    });
    const woodMats = {};
    const woodOf = (wood) => {
      if (!woodMats[wood.name]) {
        woodMats[wood.name] = {
          top:  new THREE.MeshStandardMaterial({ map: mkWoodTex(wood.top,  wood.dark), roughness: 0.72, metalness: 0 }),
          side: new THREE.MeshStandardMaterial({ map: mkWoodTex(wood.side, wood.dark), roughness: 0.8,  metalness: 0 }),
        };
      }
      return woodMats[wood.name];
    };
    const PLANK_H = 0.22;
    // Plaque-étiquette (porte-étiquette de cave) fixée au chant avant de chaque
    // planche : taille indépendante de l'épaisseur de la planche, fond crème,
    // cadre couleur d'accent du casier, texte sombre — lisible sur toute essence.
    const mkPlaqueTex = (label, accent, pw, ph) => {
      const cv = document.createElement("canvas");
      cv.width = Math.min(2048, Math.round(pw * 300));
      cv.height = Math.round(ph * 300);
      const c2 = cv.getContext("2d");
      c2.fillStyle = "#F2E8D5";
      c2.fillRect(0, 0, cv.width, cv.height);
      c2.strokeStyle = accent;
      c2.lineWidth = Math.max(6, cv.height * 0.07);
      c2.strokeRect(c2.lineWidth / 2 + 2, c2.lineWidth / 2 + 2, cv.width - c2.lineWidth - 4, cv.height - c2.lineWidth - 4);
      c2.fillStyle = "#2A1C0E";
      let fs = Math.round(cv.height * 0.52);
      c2.font = `700 ${fs}px Inter, sans-serif`;
      while (fs > 20 && c2.measureText(label).width > cv.width - cv.height) {
        fs -= 4;
        c2.font = `700 ${fs}px Inter, sans-serif`;
      }
      c2.textAlign = "center";
      c2.textBaseline = "middle";
      c2.fillText(label, cv.width / 2, cv.height * 0.54);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    const emptyMat = new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const ringMat  = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.9 });
    const goldMat  = new THREE.MeshBasicMaterial({ color: 0xC9A84C });

    // ── Construction des casiers, étagère par étagère (fidèle à la grille 2D) ──
    // Un "rack" de données = un casier indépendant : largeur propre (colonnes ×
    // espacement constant), étagères internes identiques.
    // Les casiers peuvent donc avoir des dimensions et dispositions différentes.
    const SPACING  = 1.06;                     // espacement des bouteilles (constant partout)
    const SHELF_DY   = 2.0;                      // entre étagères d'un même casier
    const RACK_GAP = 1.1;                     // espace entre casiers
    const pickables = [];
    const rackAnchors = [];                   // pour les overlays HTML
    let yCursor = 0;                           // haut du casier courant

    racks.forEach((rack, fi) => {
      const cols  = rack.columns || 8;
      const total = rack.slots || cols * (rack.shelves || 2);
      const shelves  = Math.ceil(total / cols);
      const layout = rack.layout || "side_by_side";
      const halfW = (cols * SPACING) / 2;
      const yTop = yCursor;
      let occ = 0;
      const plankW = cols * SPACING + 1.1;
      const rackName = rack.name || `Casier ${fi + 1}`;
      const showPlate = this._labelMode === "plate" || this._labelMode === "both";
      const st = this._rackLook(rack, fi);         // essence + accent + cadre du casier
      const isIron = st.iron;                      // fer forgé : pas de bois du tout
      const wm = woodOf(st.wood);
      const plaqueEdge = new THREE.MeshStandardMaterial({ color: st.accent, roughness: 0.5, metalness: 0.2 });

      for (let r = 0; r < shelves; r++) {
        const shelfY = yTop - r * SHELF_DY;

        // Étagère : planche en bois (dessus affleurant le repos des bouteilles),
        // ou tôle fine sombre pour les caves en fer forgé
        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(plankW, isIron ? 0.10 : PLANK_H, 4.0),
          isIron ? ironMat : [wm.side, wm.side, wm.top, wm.side, wm.side, wm.side]
        );
        plank.position.set(0, shelfY - (isIron ? 0.05 : PLANK_H / 2), 0);
        if (SHADOWS_3D_PCF) { plank.receiveShadow = true; plank.castShadow = true; }
        scene.add(plank);

        if (isIron) {
          // Lisse avant décorative sous la tôle
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, plankW - 0.2, 10), ironMat);
          rail.rotation.z = Math.PI / 2;
          rail.position.set(0, shelfY - 0.17, 1.92);
          if (SHADOWS_3D_PCF) rail.castShadow = true;
          scene.add(rail);
        }

        // Plaque-étiquette accrochée au chant avant : nom du casier + position de
        // l'étagère (si plusieurs) — taille indépendante de l'épaisseur de la planche
        if (showPlate) {
          const lblTxt = shelves > 1 ? `${rackName} · ${r + 1}` : rackName;
          const pw = Math.min(plankW - 0.6, Math.max(1.4, lblTxt.length * 0.17 + 0.5));
          const ph = 0.42;
          const plaque = new THREE.Mesh(
            new THREE.BoxGeometry(pw, ph, 0.035),
            [plaqueEdge, plaqueEdge, plaqueEdge, plaqueEdge,
             new THREE.MeshStandardMaterial({ map: mkPlaqueTex(lblTxt, st.accent, pw, ph), roughness: 0.6, metalness: 0 }),
             plaqueEdge]
          );
          plaque.position.set(0, shelfY - 0.245, 2.02);
          scene.add(plaque);
        }

        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (i >= total) break;
          const entry = slotOf[`${rack.id}:${i}`];
          const x    = -halfW + SPACING / 2 + c * SPACING;
          // Pas de décalage avant/arrière : bouteilles parallèles, entièrement sur la
          // clayette (3.72 de long pour 4.0 de profondeur — un décalage ferait déborder)
          const stag = 0;
          // Tête-bêche : même parité que la vue 2D (oriente bouteilles ET silhouettes vides)
          const parity = layout === "alternating" ? i % 2
            : (layout === "alternating_2d" || layout === "quinconce") ? (r + c) % 2 : 0;

          if (!entry) {
            // Même alignement au bord avant que les vraies bouteilles (la silhouette
            // n'a pas de bouchon : le verre est placé là où serait celui d'une bordelaise)
            const gdz = parity === 1 ? 2.0 - 1.86 : 2.0 - 1.98;
            const disc = new THREE.Mesh(emptyGeo, emptyMat);
            disc.position.set(x, shelfY + 0.012, stag + gdz);
            const ring = new THREE.LineLoop(ghostEdge, ringMat);
            ring.position.set(x, shelfY + 0.013, stag + gdz);
            if (parity === 1) disc.rotation.y = ring.rotation.y = Math.PI;
            disc.userData = { empty: true, slot: i, rackId: rack.id, base: { x, shelfY, fi, i, parity }, ring };
            pickables.push(disc);
            scene.add(disc, ring);
            continue;
          }
          occ++;

          const wine = entry.wine;
          const tp = WINE_TYPES[wine.type] ? wine.type : "red";
          const filtered =
            (this._filter !== "all" && wine.type !== this._filter) ||
            (this._filterEvent !== "all" && (wine.event || "") !== this._filterEvent);

          const set = geoByType[tp] || setBordeaux;
          const g = new THREE.Group();
          const body = new THREE.Mesh(set.body, filtered ? fadedMats[tp] : mats[tp]);
          if (SHADOWS_3D_PCF) { body.castShadow = !filtered; body.receiveShadow = true; }
          const cap  = new THREE.Mesh(set.cap, capMats[tp]);
          // Tête du champignon en liège : la couronne autour de la plaque (fût évasé
          // + bord de la calotte) est en liège apparent, seul le centre est couvert
          // par la plaque métallique
          const cork = new THREE.Mesh(set.cork, corkMat);
          const corkTop = set.corkTop ? new THREE.Mesh(set.corkTop, corkMat) : null;
          // Collerette : prolonge la coiffe sur l'effervescent, crème sinon
          const col  = new THREE.Mesh(set.collar, tp === "sparkling" ? capMats[tp] : labelMat);
          // Étiquette : texture solidaire de la bouteille (tête-bêche → texte renversé avec elle)
          const lblMat = labelMatFor(tp, wine.name) || labelMat;
          const lbl  = new THREE.Mesh(set.label, lblMat);
          cap.visible = cork.visible = col.visible = lbl.visible = !filtered;
          if (!filtered && !SHADOWS_3D_PCF) {        // ombre de contact (mode actif)
            const csh = new THREE.Mesh(contactGeo, contactMat);
            csh.position.set(x, shelfY + 0.011, stag);
            scene.add(csh);
          }
          g.add(body, cap, cork, col, lbl);
          if (corkTop) {
            corkTop.visible = !filtered;
            g.add(corkTop);
          }
          if (set.muselet) {
            for (const geo of set.muselet) {
              const m = new THREE.Mesh(geo, museletMat);
              m.visible = !filtered;
              g.add(m);
            }
            const pl = new THREE.Mesh(set.plaque, plaqueMat);
            pl.visible = !filtered;
            g.add(pl);
            const dm = new THREE.Mesh(set.plaqueDecal, plaqueDecalMat);
            dm.visible = !filtered;
            g.add(dm);
          }
          if (wineInMats[tp]) {
            // Vin visible dans le verre transparent (même profil, légèrement réduit).
            // renderOrder : le vin se dessine avant le verre pour une superposition correcte.
            const wineIn = new THREE.Mesh(set.body, wineInMats[tp]);
            wineIn.scale.set(0.92, 0.92, 0.97);
            // Le scale réduit vers l'origine du mesh : recale l'axe du vin sur celui
            // du verre (axe bouchon/culot à y = rest, abaissé de 8 % par le scale)
            wineIn.position.y = set.rest * 0.08;
            wineIn.visible = !filtered;
            wineIn.renderOrder = 1;
            body.renderOrder = 2;
            g.add(wineIn);
          }

          if (parity === 1) g.rotation.y = Math.PI;
          // Roulis ±26° (déterministe par slot) : l'étiquette penche différemment d'une
          // bouteille à l'autre. Pas de lacet : la caméra orthographique exige des axes
          // parallèles, sinon chaque bouteille semble avoir son propre point de fuite.
          const h1 = (((i + 1) * 2654435761 + fi * 97) >>> 0) % 1000 / 1000;
          const roll = (h1 - 0.5) * 0.9;
          g.rotation.z = roll;
          // Échelle du format (magnum/demi) : radiale en x/y, longueur en z —
          // bornée par sizeScale pour ne jamais déranger l'entraxe
          const sc = sizeScale(entry.size || wine.size);   // format de LA bouteille
          // Plafond de longueur par forme : bouchon compris, la bouteille ne doit
          // jamais déborder de la planche (profondeur 4.0, marge 0.02)
          const scL = Math.min(sc.l, 3.98 / (set.tip + 1.86));
          g.scale.set(sc.r, sc.r, scL);
          // Alignement au bord avant de la clayette (z = +2) : pointe du bouchon au
          // bord pour les bouteilles à l'endroit, culot au bord pour les tête-bêche.
          // Le pivot du roulis étant le point de contact (l'axe est à y = rest·sc.r),
          // on compense x et y pour que l'axe reste à l'aplomb exact de l'emplacement
          g.position.set(
            x + set.rest * sc.r * Math.sin(roll),
            shelfY + set.rest * sc.r * (1 - Math.cos(roll)),
            stag + (parity === 1 ? 2.0 - 1.86 * scL : 2.0 - set.tip * scL)
          );
          g.userData = {
            wineId: wine.id, slotIdx: entry.slotIdx, slot: i, rackId: rack.id,
            // Pour la dépose optimiste exacte : coordonnées du slot + paramètres
            // de placement de CETTE bouteille (forme/format)
            base: { x, shelfY, fi, i, parity },
            rest: set.rest, tip: set.tip, scR: sc.r, scL,
          };

          if (wine.id === this._selected) {
            const halo = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.60, 40), goldMat);
            halo.rotateX(-Math.PI / 2);
            halo.position.y = 0.015;
            g.add(halo);
          }
          body.userData = g.userData;
          cap.userData = g.userData;
          pickables.push(body);
          scene.add(g);
        }
      }

      const yBot = yTop - (shelves - 1) * SHELF_DY;

      // ── Cadre du casier : éléments composables (montants / croisillons / toit /
      // caisson / pieds), tous rendus dans le matériau du casier (bois ou fer) ──
      const frTop = yTop + 1.0, frBot = yBot - PLANK_H;
      const frH = frTop - frBot;
      const frameMat = isIron ? ironMat : wm.side;
      const addBeam = (w, h, d, x, y, z, rotX = 0) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
        if (rotX) m.rotation.x = rotX;
        m.position.set(x, y, z);
        if (SHADOWS_3D_PCF) m.castShadow = m.receiveShadow = true;
        scene.add(m);
      };
      const px = plankW / 2 - 0.07, pz = 2.0 - 0.07, yMid = (frTop + frBot) / 2;
      if (st.posts) {
        if (isIron) {
          // Fer forgé : montants ronds aux quatre coins, boules de faîtage
          // (pas de boules sous un toit — elles le transperceraient)
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, frH, 10), ironMat);
            post.position.set(sx * px, yMid, sz * pz);
            if (SHADOWS_3D_PCF) post.castShadow = post.receiveShadow = true;
            scene.add(post);
            if (!st.roof) {
              const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), ironMat);
              ball.position.set(sx * px, frTop + 0.07, sz * pz);
              if (SHADOWS_3D_PCF) ball.castShadow = true;
              scene.add(ball);
            }
          }
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1])
            addBeam(0.14, frH, 0.14, sx * px, yMid, sz * pz);
        }
      }
      if (st.cross) {
        // Croisillons en X sur les flancs (dans le plan z/y)
        const L = Math.hypot(3.6, frH), th = Math.atan2(3.6, frH);
        for (const sx of [-1, 1]) {
          addBeam(0.05, L, 0.04, sx * (plankW / 2 + 0.03), yMid, 0,  th);
          addBeam(0.05, L, 0.04, sx * (plankW / 2 + 0.03), yMid, 0, -th);
        }
      }
      if (st.panels) {
        // Caisson fermé : panneaux latéraux pleins
        addBeam(0.10, frH, 4.0, -(plankW / 2 + 0.05), yMid, 0);
        addBeam(0.10, frH, 4.0,  (plankW / 2 + 0.05), yMid, 0);
      }
      if (st.roof || st.panels) {
        // Toit : plateau supérieur sur toute l'emprise
        addBeam(plankW + 0.3, 0.12, 4.0, 0, frTop + 0.06, 0);
      }
      if (st.feet) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          addBeam(0.14, 0.55, 0.14, sx * px, frBot - 0.275, sz * pz);
      }

      rackAnchors.push({ rack, fi, yTop, yBot, halfW, occ, total });
      // Casier suivant : sous la dernière étagère, avec un écart visuel
      // Espace réservé sous le casier pour ses repères (plaque/bulle) → espacement
      // visuel uniforme quel que soit le mode d'affichage des repères 3D.
      const plateReserve  = (this._labelMode === "plate" || this._labelMode === "both") ? 0.55 : 0;
      const bubbleReserve = (this._labelMode === "bubble" || this._labelMode === "both") ? 0.80 : 0;
      const markReserve = Math.max(plateReserve, bubbleReserve);
      yCursor = yBot - SHELF_DY - RACK_GAP - markReserve;
    });

    // Marqueur de dépôt (drag & drop)
    const dropRing = new THREE.Mesh(new THREE.RingGeometry(0.50, 0.62, 40), goldMat.clone());
    dropRing.rotateX(-Math.PI / 2);
    dropRing.visible = false;
    scene.add(dropRing);

    // ── Cadrage au plus juste : pleine largeur, hauteur exacte ──
    const bbox = new THREE.Box3().setFromObject(scene);
    const c3 = bbox.getCenter(new THREE.Vector3());
    const s3 = bbox.getSize(new THREE.Vector3());
    const MARGIN_X = 1.03;
    const PAD_TOP = 0.45, PAD_BOT = 0.95;     // marges monde (bas = place du badge)

    // Lumière clé : viser le centre de la scène. En mode contact (défaut) il n'y a
    // pas de shadow map ; en mode PCF on cadre la shadow camera sur toute la scène.
    key.target.position.copy(c3);
    scene.add(key.target);
    key.position.set(c3.x + 5, c3.y + s3.y / 2 + 8, c3.z + 9);
    if (SHADOWS_3D_PCF) {                       // cadrage de la shadow map — inactif par défaut
      const sc = key.shadow.camera;
      sc.left = -(s3.x / 2 + 3); sc.right = s3.x / 2 + 3;
      sc.top  =  s3.y / 2 + 4;   sc.bottom = -(s3.y / 2 + 4);
      sc.near = 1; sc.far = 90;
      sc.updateProjectionMatrix();
    }

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    // ── Renderer HD ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (SHADOWS_3D_PCF) {                       // shadow map PCF — inactif par défaut
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    stage.innerHTML = "";
    stage.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;border-radius:12px;touch-action:pan-y";

    const glCtx = renderer.getContext();
    const draw = () => {
      // Ne JAMAIS appeler render() sur un contexte perdu : three lit alors
      // gl.getProgramInfoLog() == null et plante sur `null.trim()` (visible via
      // le chemin PMREM de génération de l'env-map au premier rendu). Un contexte
      // peut sauter entre deux remontages (rotation/reconnexion) ; on saute le
      // rendu, le remontage suivant reconstruira une scène saine.
      if (glCtx.isContextLost?.()) return;
      renderer.render(scene, cam);
    };

    // ── Overlays : badge sous chaque clayette + rail vertical à droite ──
    const placeOverlays = (w, h) => {
      stage.querySelectorAll(".t3-badge,.t3-rail").forEach((el) => el.remove());
      const toPx = (x, y, z) => {
        const p = new THREE.Vector3(x, y, z).project(cam);
        return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
      };
      rackAnchors.forEach(({ rack, fi, yTop, yBot, halfW, occ, total }) => {
        const pct = Math.round((occ / total) * 100);

        if (this._labelMode === "bubble" || this._labelMode === "both") {
          // Bulle rattachée à SON casier : sous le bord avant de sa dernière étagère.
          // En mode "both", on la descend un peu plus pour passer sous la plaque.
          const bubbleY = yBot - (this._labelMode === "both" ? 0.62 : 0.40);
          const pb = toPx(0, bubbleY, 2.06);
          const badge = document.createElement("div");
          badge.className = "t3-badge";
          badge.style.left = pb.x + "px";
          badge.style.top  = pb.y + "px";
          badge.innerHTML = `<b>${fi + 1}</b> ${esc(rack.name)} <span>${pct}%</span>`;
          stage.appendChild(badge);
        }

        // Rail vertical aligné sur le haut du casier
        const pr = toPx(halfW, yTop + 0.7, 0);
        const rail = document.createElement("div");
        rail.className = "t3-rail";
        rail.style.top = Math.max(4, pr.y - 50) + "px";
        rail.innerHTML = `
          <button class="icon-btn" data-edit-rack="${esc(rack.id)}" title="Modifier">⚙</button>
          <button class="icon-btn" data-move-rack="${esc(rack.id)}" title="Déplacer le contenu">📦</button>
          <button class="icon-btn" data-del-rack="${esc(rack.id)}" title="Supprimer">✕</button>`;
        stage.appendChild(rail);
      });
      this._bind3DOverlays(stage, data, wines);
    };

    // ── Layout : la largeur dicte l'échelle, la hauteur suit le contenu ──
    let curW = 0;
    const RAIL_PX = 48;                        // zone réservée au rail d'actions
    const layout = (w) => {
      curW = w;
      const usable = Math.max(120, w - RAIL_PX);
      const pxPerUnit = usable / (s3.x * MARGIN_X);
      const h = Math.max(150, Math.round((s3.y + PAD_TOP + PAD_BOT) * pxPerUnit));
      const hW = (s3.x * MARGIN_X) / 2;
      const extra = RAIL_PX / pxPerUnit;       // unités monde à droite (hors clayettes)
      const hH = h / (2 * pxPerUnit);
      const cy = c3.y - (PAD_BOT - PAD_TOP) / 2;
      cam.left = -hW; cam.right = hW + extra; cam.top = hH; cam.bottom = -hH;
      // Cadrage d'origine : élévation ~16° + léger décalage latéral (vue 3/4 douce).
      // La projection orthographique garde toutes les bouteilles parallèles malgré
      // le décalage — pas de point de fuite par bouteille.
      cam.position.set(c3.x + 4.2, cy + 8.0, c3.z + 28);
      cam.lookAt(new THREE.Vector3(c3.x, cy, c3.z));
      cam.updateProjectionMatrix();
      stage.style.height = h + "px";
      this._lastH3D = h;
      renderer.setSize(w, h);
      draw();
      placeOverlays(w, h);
    };
    layout(width);

    // ── Picking + drag & drop (raycaster) ──
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const setPtr = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const pickAt = (e, objs) => {
      setPtr(e);
      ray.setFromCamera(ptr, cam);
      return ray.intersectObjects(objs, false)[0];
    };

    // Clic simple : "click" est synthétisé par iOS après un vrai tap
    // et jamais après un scroll → fiable sur iPhone
    const onPick = (e) => {
      if (this._t3Suppress) return;            // un drag vient de se terminer
      const hit = pickAt(e, pickables);
      if (!hit) return;
      const u = hit.object.userData;
      if (u.empty) {
        this._openModal("bottle", { slot: { rack_id: u.rackId, slot: u.slot } });
      } else {
        const wine = wines.find((w) => w.id === u.wineId);
        if (!wine) return;
        this._selected = wine.id;               // mémorisé pour la vue 2D
        this._openModal("detail", { wine });    // ouverture directe, sans re-render
      }
    };
    renderer.domElement.addEventListener("click", onPick);

    // Drag & drop : déplacer vers un slot vide, permuter sur un slot occupé
    let drag = null;          // { ud, obj, group, orig, sx, sy, active }
    let hoverTarget = null;   // userData du slot survolé pendant le drag
    let hoverObj = null;      // objet 3D correspondant (pour le placement optimiste)

    const onDown = (e) => {
      if (!e.isPrimary) return;
      const hit = pickAt(e, pickables);
      if (!hit || !hit.object.userData.wineId) return;
      drag = {
        ud: hit.object.userData, obj: hit.object,
        group: hit.object.parent, orig: hit.object.parent.position.clone(),
        sx: e.clientX, sy: e.clientY, active: false,
      };
    };

    const onMove = (e) => {
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 7) return;
        drag.active = true;
        // Profondeur NDC de la bouteille : la déprojection doit se faire dans son
        // plan caméra, pas au milieu du frustum (sinon elle saute hors de la vue)
        drag.ndcZ = drag.orig.clone().project(cam).z;
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
      e.preventDefault();
      // La bouteille suit le curseur dans son plan caméra (effet "ghost")
      setPtr(e);
      const wp = new THREE.Vector3(ptr.x, ptr.y, drag.ndcZ).unproject(cam);
      drag.group.position.set(wp.x, wp.y + 0.3, wp.z);
      // Cible survolée : slots vides + bouteilles (sauf la bouteille déplacée)
      const targets = pickables.filter(o =>
        o !== drag.obj &&
        !(o.userData.wineId === drag.ud.wineId && o.userData.slotIdx === drag.ud.slotIdx));
      let hitObj = pickAt(e, targets)?.object || null;
      if (!hitObj) {
        // Rabattement : cible la plus proche du curseur en espace écran (~40 px)
        let bestD = 0.004;
        targets.forEach(o => {
          const p = (o.userData.empty ? o.position : o.parent.position).clone().project(cam);
          const d = (p.x - ptr.x) * (p.x - ptr.x) + (p.y - ptr.y) * (p.y - ptr.y);
          if (d < bestD) { bestD = d; hitObj = o; }
        });
      }
      if (hitObj) {
        hoverTarget = hitObj.userData;
        hoverObj = hitObj;
        const p = hitObj.userData.empty ? hitObj.position : hitObj.parent.position;
        dropRing.position.set(p.x, p.y + 0.02, p.z);
        dropRing.visible = true;
      } else {
        hoverTarget = null;
        hoverObj = null;
        dropRing.visible = false;
      }
      draw();
    };

    // Place un groupe-bouteille EXACTEMENT comme le ferait le prochain rendu pour
    // ce slot (roulis déterministe, parité, alignement au bord selon forme/format)
    // → la confirmation après rafraîchissement ne fait plus bouger d'un pixel
    const placeExact = (group, base) => {
      const ud = group.userData;
      const h = (((base.i + 1) * 2654435761 + base.fi * 97) >>> 0) % 1000 / 1000;
      const roll = (h - 0.5) * 0.9;
      group.rotation.z = roll;
      group.rotation.y = base.parity === 1 ? Math.PI : 0;
      group.position.set(
        base.x + ud.rest * ud.scR * Math.sin(roll),
        base.shelfY + ud.rest * ud.scR * (1 - Math.cos(roll)),
        base.parity === 1 ? 2.0 - 1.86 * ud.scL : 2.0 - ud.tip * ud.scL
      );
    };

    const endDrag = (commit) => {
      if (!drag) return;
      const wasActive = drag.active;
      const src = drag.ud;
      const group = drag.group, orig = drag.orig;
      const t = hoverTarget, tObj = hoverObj;
      hoverTarget = null; hoverObj = null;
      dropRing.visible = false;
      drag = null;
      if (!wasActive) { draw(); return; }      // simple clic → onPick s'en charge
      // Empêcher le "click" synthétisé juste après le drag d'ouvrir une fiche
      this._t3Suppress = true;
      setTimeout(() => { this._t3Suppress = false; }, 80);
      if (!commit || !t || !tObj) {
        group.position.copy(orig);             // drag annulé → retour à l'origine
        draw();
        return;
      }
      // Placement optimiste : la bouteille reste à destination (et la cible d'un
      // swap prend l'ancienne place) en attendant le rafraîchissement des données.
      if (t.empty) {
        // Permutation bouteille ↔ emplacement vide : la bouteille va à destination
        // ET la silhouette vide prend immédiatement la place libérée — l'état
        // affiché est déjà l'état final, le refresh ne change plus rien
        const srcBase = group.userData.base;
        // ⚠ t === tObj.userData : capturer la destination AVANT de réécrire le userData
        const destRackId = t.rackId, destSlot = t.slot;
        placeExact(group, tObj.userData.base);
        const gdz = srcBase.parity === 1 ? 2.0 - 1.86 : 2.0 - 1.98;
        const ry  = srcBase.parity === 1 ? Math.PI : 0;
        tObj.position.set(srcBase.x, srcBase.shelfY + 0.012, gdz);
        tObj.rotation.y = ry;
        if (tObj.userData.ring) {
          tObj.userData.ring.position.set(srcBase.x, srcBase.shelfY + 0.013, gdz);
          tObj.userData.ring.rotation.y = ry;
        }
        // La silhouette représente désormais le slot source (cible valide avant refresh)
        Object.assign(tObj.userData, { slot: src.slot, rackId: src.rackId, base: srcBase });
        draw();
        this._hass.callService(DOMAIN, "move_slot", {
          wine_id: src.wineId, slot_idx: src.slotIdx, rack_id: destRackId, slot: destSlot,
        }).then(() => this._fetchData())
          .catch((err) => {
            this._showToast("error", `Erreur : ${err.message || JSON.stringify(err)}`);
            this._fetchData();
          });
      } else {
        const tgtGroup = tObj.parent;
        const srcBase = group.userData.base;
        placeExact(group, tgtGroup.userData.base);
        placeExact(tgtGroup, srcBase);
        draw();
        this._swapViaTemp(
          { wineId: src.wineId, slotIdx: src.slotIdx, rackId: src.rackId, slot: src.slot },
          { wineId: t.wineId,   slotIdx: t.slotIdx,   rackId: t.rackId,   slot: t.slot }
        );
      }
    };
    const onUp     = () => endDrag(true);
    const onCancel = () => endDrag(false);

    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onCancel);

    // ── Redimensionnement (largeur uniquement) ──
    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth || curW;
      if (Math.abs(w - curW) > 1) layout(w);
    });
    ro.observe(stage);

    // ── Mobile : bascule d'orientation ──
    // 1) La WebView peut perdre le contexte WebGL au changement d'orientation.
    //    Sans preventDefault sur "webglcontextlost", le navigateur ne restaure
    //    JAMAIS le contexte : le canvas reste vide définitivement. On accepte la
    //    restauration puis on remonte toute la scène (les ressources GPU —
    //    textures, géométries, framebuffers — sont invalidées par la perte).
    const canvas = renderer.domElement;
    const onCtxLost     = (e) => e.preventDefault();
    const onCtxRestored = () => {
      if (this._view === "3d") requestAnimationFrame(() => this._mount3D());
    };
    canvas.addEventListener("webglcontextlost", onCtxLost, false);
    canvas.addEventListener("webglcontextrestored", onCtxRestored, false);
    // 2) Certaines WebView Android vident le back-buffer SANS émettre
    //    "webglcontextlost" : on remesure et on redessine une fois la nouvelle
    //    taille stabilisée (double rAF). Couvre aussi le cas où la largeur reste
    //    identique (le ResizeObserver ne se déclencherait alors pas).
    const onOrient = () => requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this._view !== "3d" || !this._three) return;
        const w = stage.clientWidth || curW;
        if (w > 0 && Math.abs(w - curW) > 1) layout(w); else draw();
      }));
    window.addEventListener("orientationchange", onOrient);

    this._three = { renderer, scene, cam, ro, canvas, onCtxLost, onCtxRestored, onOrient, onPick, onDown, onMove, onUp, onCancel };
  }

  _bind3DOverlays(stage, data, wines) {
    stage.querySelectorAll("[data-edit-rack]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rack = data.cellar.racks.find((f) => f.id === btn.dataset.editRack);
        this._openModal("rack", { rack });
      })
    );
    stage.querySelectorAll("[data-move-rack]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rack = data.cellar.racks.find((f) => f.id === btn.dataset.moveRack);
        if (data.cellar.racks.length < 2) {
          this._showToast("warning", "Créez un second casier pour pouvoir déplacer le contenu.");
          return;
        }
        this._openModal("moverack", { rack });
      })
    );
    stage.querySelectorAll("[data-del-rack]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const fid   = btn.dataset.delRack;
        const rack = data.cellar.racks.find((f) => f.id === fid);
        const cnt   = wines.reduce((s, w) => s + (w.slots?.filter(sl => sl.rack_id === fid).length || 0), 0);
        const msg   = cnt > 0
          ? `Supprimer "${rack?.name}" et ses ${cnt} bouteille(s) ?`
          : `Supprimer le casier "${rack?.name}" ?`;
        if (await this._confirm(msg)) await this._callService("remove_rack", { rack_id: fid });
      })
    );
  }

  _shade(hex, pct) {
    // Éclaircit (pct>0) ou assombrit (pct<0) une couleur hex
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + Math.round(2.55 * pct)));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + Math.round(2.55 * pct)));
    const b = Math.min(255, Math.max(0, (n & 255) + Math.round(2.55 * pct)));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  // ── Listeners carte ────────────────────────────────────────────────────────────

  _bindCardListeners(data, wines) {
    const s = this.shadowRoot;

    // Filtres par type et événement (selects)
    s.getElementById("sel-type")?.addEventListener("change", (e) => {
      this._filter = e.target.value;
      this._render();
    });
    s.getElementById("sel-event")?.addEventListener("change", (e) => {
      this._filterEvent = e.target.value;
      this._render();
    });

    s.getElementById("btn-history")?.addEventListener("click", () => this._openModal("history"));
    s.getElementById("sel-view")?.addEventListener("change", (e) => {
      this._viewTouched = true;
      this._view = e.target.value;
      try { localStorage.setItem("millesime-view", this._view); } catch (err) {}
      this._render();
    });
    s.getElementById("btn-options")?.addEventListener("click", () => {
      this._optionsOpen = !this._optionsOpen;
      const el = this.shadowRoot.getElementById("header-options");
      const logo = this.shadowRoot.getElementById("btn-options");
      if (el) el.classList.toggle("open", this._optionsOpen);
      if (logo) logo.classList.toggle("active", this._optionsOpen);
    });
    s.getElementById("sel-labelmode")?.addEventListener("change", (e) => {
      this._labelMode = e.target.value;
      try { localStorage.setItem("millesime-labelmode", this._labelMode); } catch (err) {}
      if (this._view === "3d") this._render();   // re-rendu pour appliquer aux repères 3D
    });
    s.getElementById("btn-search")?.addEventListener("click",  () => this._openModal("search"));
    s.getElementById("btn-journal")?.addEventListener("click", () => this._openModal("journal"));
    s.getElementById("btn-import")?.addEventListener("click", async () => {
      const ok = await this._confirm(
        "Importer le fichier millesime_import_vinotag.csv (export Vinotag) ? " +
        "Les bouteilles seront placées automatiquement dans les emplacements libres " +
        "et le fichier sera effacé après import."
      );
      if (!ok) return;
      if (await this._callService("import_vinotag", {}))
        this._showToast("success", "Import Vinotag effectué ✓");
    });
    s.getElementById("btn-refresh")?.addEventListener("click", async () => {
      const res = await this._confirm(
        "Rafraîchir toutes les fiches ? Les doublons (même nom, millésime, type) seront " +
        "fusionnés avec regroupement des emplacements, puis les champs vides seront " +
        "complétés via Gemini. Les données saisies ne sont jamais écrasées — sauf le " +
        "prix si l'option ci-dessous est cochée. " +
        "L'opération peut prendre plusieurs minutes selon le nombre de vins.",
        { checkbox: "💰 Mettre à jour les prix (prix moyen constaté par Gemini)" }
      );
      if (!res) return;
      this._showToast("info", "Rafraîchissement lancé — la cave se mettra à jour à la fin…");
      if (await this._callService("refresh_wines", { update_prices: !!res.checked }))
        this._showToast("success", "Fiches rafraîchies ✓");
    });
    s.getElementById("btn-add-rack")?.addEventListener("click",   () => this._openModal("rack"));

    s.getElementById("btn-add-bottle")?.addEventListener("click", () => {
      if (!data.cellar.racks.length) {
        this._showToast("error", "Créez d'abord un casier !");
        return;
      }
      this._openModal("bottle");
    });

    s.querySelectorAll(".dot").forEach((dot) =>
      dot.addEventListener("click", () => {
        const slot    = parseInt(dot.dataset.slot);
        const rackId = dot.dataset.rackId;
        const wineId  = dot.dataset.wineId;
        const wine    = wineId ? wines.find(w => w.id === wineId) : null;
        if (wine) {
          if (this._selected === wine.id) {
            this._selected = null;
            this._openModal("detail", { wine });
          } else {
            this._selected = wine.id;
            this._render();
          }
        } else {
          this._openModal("bottle", { slot: { rack_id: rackId, slot } });
        }
      })
    );

    s.querySelectorAll("[data-edit-rack]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rack = data.cellar.racks.find((f) => f.id === btn.dataset.editRack);
        this._openModal("rack", { rack });
      })
    );

    s.querySelectorAll("[data-move-rack]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rack = data.cellar.racks.find((f) => f.id === btn.dataset.moveRack);
        if (data.cellar.racks.length < 2) {
          this._showToast("warning", "Créez un second casier pour pouvoir déplacer le contenu.");
          return;
        }
        this._openModal("moverack", { rack });
      })
    );

    s.querySelectorAll("[data-del-rack]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const fid   = btn.dataset.delRack;
        const rack = data.cellar.racks.find((f) => f.id === fid);
        const cnt   = wines.reduce((s, w) => s + (w.slots?.filter(sl => sl.rack_id === fid).length || 0), 0);
        const msg   = cnt > 0
          ? `Supprimer "${rack?.name}" et ses ${cnt} bouteille(s) ?`
          : `Supprimer le casier "${rack?.name}" ?`;
        if (await this._confirm(msg)) await this._callService("remove_rack", { rack_id: fid });
      })
    );

    // ── Glisser-déposer ────────────────────────────────────────────────────────
    s.querySelectorAll(".dot--filled").forEach((dot) => {
      dot.setAttribute("draggable", "true");
      dot.addEventListener("dragstart", (e) => {
        const wineId  = dot.dataset.wineId;
        const slotIdx = dot.dataset.slotIdx;
        if (!wineId) return;
        this._draggingWineId = wineId;
        e.dataTransfer.setData("text/plain", `${wineId}:${slotIdx}:${dot.dataset.rackId}:${dot.dataset.slot}`);
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => dot.classList.add("dot--dragging"), 0);
      });
      dot.addEventListener("dragend", () => {
        this._draggingWineId = null;
        dot.classList.remove("dot--dragging");
        s.querySelectorAll(".dot--drag-over").forEach(d => d.classList.remove("dot--drag-over"));
      });
      // Swap : dépôt sur un slot occupé
      dot.addEventListener("dragover", (e) => {
        if (dot.dataset.wineId === this._draggingWineId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        dot.classList.add("dot--drag-over");
      });
      dot.addEventListener("dragleave", () => dot.classList.remove("dot--drag-over"));
      dot.addEventListener("drop", async (e) => {
        e.preventDefault();
        dot.classList.remove("dot--drag-over");
        const parts = (e.dataTransfer.getData("text/plain") || "").split(":");
        const srcWineId  = parts[0];
        const srcSlotIdx = parseInt(parts[1]);
        const srcRackId = parts[2];
        const srcSlot    = parseInt(parts[3]);
        const tgtWineId  = dot.dataset.wineId;
        const tgtSlotIdx = parseInt(dot.dataset.slotIdx);
        const tgtRackId = dot.dataset.rackId;
        const tgtSlot    = parseInt(dot.dataset.slot);
        if (!srcWineId || !tgtWineId || srcWineId === tgtWineId) return;
        if (isNaN(srcSlotIdx) || isNaN(srcSlot) || isNaN(tgtSlotIdx) || isNaN(tgtSlot)) return;

        await this._swapViaTemp(
          { wineId: srcWineId, slotIdx: srcSlotIdx, rackId: srcRackId, slot: srcSlot },
          { wineId: tgtWineId, slotIdx: tgtSlotIdx, rackId: tgtRackId, slot: tgtSlot }
        );
      });
    });

    s.querySelectorAll(".dot--empty").forEach((dot) => {
      dot.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        dot.classList.add("dot--drag-over");
      });
      dot.addEventListener("dragleave", () => dot.classList.remove("dot--drag-over"));
      dot.addEventListener("drop", async (e) => {
        e.preventDefault();
        dot.classList.remove("dot--drag-over");
        const [wineId, slotIdxStr] = (e.dataTransfer.getData("text/plain") || "").split(":");
        const slotIdx    = parseInt(slotIdxStr);
        const targetSlot = parseInt(dot.dataset.slot);
        const targetRack = dot.dataset.rackId;
        if (!wineId || isNaN(slotIdx) || isNaN(targetSlot)) return;
        await this._callService("move_slot", { wine_id: wineId, slot_idx: slotIdx, rack_id: targetRack, slot: targetSlot });
      });
    });
  }

  connectedCallback() {
    // HA ré-attache la carte quand il recalcule sa disposition (rotation de
    // l'écran, resize masonry/sections…) : il appelle disconnectedCallback puis
    // reconnecte la MÊME instance sans rappeler setConfig, et `set hass` ne
    // re-rend pas (first=false). Sans ce hook, la vue 3D resterait démontée et
    // la carte ne recevrait plus aucune mise à jour → contenu vide jusqu'à un
    // rechargement manuel (F5). On restaure souscription + rendu.
    if (!this._disconnected || !this._hass) return;   // 1er montage : set hass s'en charge
    this._disconnected = false;
    if (!this._unsubs.length) this._subscribeUpdates();
    if (this._data) this._render();                   // restauration immédiate (re-montage 3D inclus)
    else this._fetchData();
  }

  disconnectedCallback() {
    this._disconnected = true;
    this._unsubs.forEach((f) => f());
    this._unsubs = [];
    this._closeModal();
    this._unmount3D();
    document.querySelector("#mm-toast-css")?.remove();
  }
}

// ── Utilitaires ────────────────────────────────────────────────────────────────

const DEFAULT_DATA = () => ({ cellar: { name: "Millésime", racks: [] }, wines: [] });

function _drow(label, value) {
  if (!value) return "";
  return `<div class="mm-drow">
    <span class="mm-drow-label">${label}</span>
    <span class="mm-drow-value">${esc(String(value))}</span>
  </div>`;
}

// ── CSS de la carte ────────────────────────────────────────────────────────────

const CARD_CSS = `<style>
:host {
  display: block; font-size: var(--fs-base, 13px);
  --red:#C0392B; --red-h:#E74C3C; --gold:#C9A84C;
  --accent: var(--primary-color, #C0392B);
  --accent-h: var(--secondary-color, #E74C3C);
  --bg-0: var(--primary-background-color, #080808);
  --bg-1: var(--card-background-color, #111);
  --bg-2: var(--secondary-background-color, #181818);
  --bg-3: color-mix(in srgb, var(--card-background-color, #222) 70%, var(--primary-text-color, white) 30%);
  --bg-4: color-mix(in srgb, var(--card-background-color, #2A2A2A) 55%, var(--primary-text-color, white) 45%);
  --cream: var(--primary-text-color, #EDE0CC);
  --muted: var(--secondary-text-color, #5A5A5A);
  --border: var(--divider-color, #222);
  --wood-dk: color-mix(in srgb, #1C1208 65%, var(--card-background-color, #000) 35%);
  --wood-md: color-mix(in srgb, #3D2510 65%, var(--card-background-color, #000) 35%);
  --wood-lt: color-mix(in srgb, #6B3A15 65%, var(--card-background-color, #000) 35%);
  /* ── Surcharges configurables via YAML ── */
  --header-accent: var(--accent);
}
* { box-sizing:border-box; margin:0; padding:0; }

.card { background:var(--bg-0); border-radius:18px; overflow:hidden; border:1px solid var(--border); }

.loading-state { display:flex; align-items:center; justify-content:center; height:180px; }
.loading-glass { width:36px; opacity:0.5; animation:pulse-anim 1.4s ease-in-out infinite; }
@keyframes pulse-anim { 0%,100%{opacity:0.3} 50%{opacity:0.8} }

.header {
  display:flex; align-items:flex-start; gap:10px;
  padding:12px 14px 10px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--card-background-color,#111) 75%,var(--header-accent,#C0392B) 25%) 0%,var(--card-background-color,#111) 100%);
  border-bottom:1px solid var(--border); position:relative;
}
.header::after {
  content:''; position:absolute; bottom:0; left:14px; right:14px; height:1px;
  background:linear-gradient(90deg,transparent,var(--header-accent,var(--red))44,transparent);
}
/* Logo + nom empilés à gauche */
.header-left { display:flex; flex-direction:column; align-items:center; gap:4px; flex-shrink:0; padding-top:2px; }
.header-glass {
  width:28px;
  filter:drop-shadow(0 0 8px rgba(192,57,43,0.7));
  animation:float-anim 3s ease-in-out infinite;
}
@keyframes float-anim { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
.header-meta { text-align:center; }
.header-name { font-family:var(--font-serif); font-size:0.77em; color:var(--cream); line-height:1.2; }
.header-tagline { font-size:0.54em; color:var(--red); text-transform:uppercase; letter-spacing:1.5px; margin-top:1px; }
/* Colonne droite : stats en haut, boutons en dessous */
.header-right { display:flex; flex-direction:column; gap:7px; flex:1; min-width:0; }
/* Stats et actions partagent la MÊME grille 3 colonnes → alignement parfait */
.header-stats   { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; align-items:stretch; }
.header-actions { display:grid; grid-template-columns:2fr 1fr; gap:5px; align-items:stretch; }
.stat { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px 6px; background:var(--bg-2); border-radius:8px; border:1px solid var(--border); }
.stat-value { font-size:1.08em; font-weight:700; color:var(--cream); font-family:var(--font-serif); line-height:1; }
.stat-label { font-size:0.54em; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
.stat-clickable { cursor:pointer; transition:all 0.15s; }
.stat-clickable:hover { background:var(--bg-3); border-color:var(--header-accent,var(--red)); }
.stat-clickable:active { transform:scale(0.97); }
/* La rangée d'icônes (vue + 🔍 + 📓) occupe la colonne "Bouteilles" */
.ha-icons { display:flex; gap:5px; }
.ha-icons .btn-icon, .ha-icons .view-select { flex:1; min-width:0; }
.header-actions > .btn-secondary,
.header-actions > .btn-primary { width:100%; }

/* ── Ligne d'options repliable (sous le verre du logo) ── */
.header-options {
  max-height:0; overflow:hidden; opacity:0;
  transition:max-height 0.28s ease, opacity 0.22s ease, padding 0.28s ease;
  background:var(--bg-1); border-bottom:1px solid transparent; padding:0 14px;
}
.header-options.open {
  max-height:140px; opacity:1; padding:10px 14px;
  border-bottom:1px solid var(--border);
}
.opt-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.opt-btn {
  padding:7px 12px; border-radius:8px; border:1px solid var(--border);
  background:var(--bg-2); color:var(--cream); font-size:0.78em; font-weight:600;
  cursor:pointer; transition:all 0.15s; white-space:nowrap; flex:1; min-width:140px;
}
.opt-btn:hover { background:var(--bg-3); border-color:var(--header-accent,var(--red)); }
.opt-btn-accent { background:color-mix(in srgb,var(--accent) 22%,var(--bg-2) 78%); border-color:var(--accent); }
.opt-btn-accent:hover { background:color-mix(in srgb,var(--accent) 34%,var(--bg-2) 66%); }
.opt-select-compact { max-width:150px; flex:0 1 150px; }
.opt-field { display:flex; align-items:center; gap:7px; flex:1; min-width:160px; }
.opt-field-label { font-size:0.6em; color:var(--muted); text-transform:uppercase; letter-spacing:1px; white-space:nowrap; }
.opt-select {
  flex:1; padding:7px 9px; border-radius:8px; border:1px solid var(--border);
  background:var(--bg-2); color:var(--cream); font-size:0.78em; cursor:pointer;
}
.header-glass.active { filter:drop-shadow(0 0 11px rgba(192,57,43,1)); transform:scale(1.08); }
.btn-primary, .btn-secondary {
  padding:7px 12px; border-radius:8px; border:none;
  font-family:var(--font-sans); font-size:0.85em; font-weight:600;
  cursor:pointer; transition:all 0.15s; white-space:nowrap;
}
.btn-primary { background:var(--accent); color:#fff; }
.btn-primary:hover { background:var(--accent-h); transform:translateY(-1px); }
.btn-secondary { background:var(--bg-3); color:var(--cream); border:1px solid var(--border); }
.btn-secondary:hover { background:var(--bg-4); }

.btn-icon {
  padding:0; min-width:32px; border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-size:1.08em; cursor:pointer; transition:all 0.15s;
}
.btn-icon:hover { background:var(--bg-3); }
.view-select {
  flex:1.8; min-width:0; padding:0 4px; border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-family:var(--font-sans); font-size:0.8em;
  cursor:pointer; transition:all 0.15s;
}
.view-select:hover { background:var(--bg-3); }

.filters {
  display:flex; gap:10px; padding:8px 14px;
  background:var(--bg-1); border-bottom:1px solid var(--border);
}
.filter-group { display:flex; flex-direction:column; gap:4px; flex:1; }
.filter-label {
  font-size:0.69em; color:var(--muted); text-transform:uppercase;
  letter-spacing:1.5px; text-align:center;
}
.filter-select {
  width:100%; padding:6px 28px 6px 10px; border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-family:var(--font-sans); font-size:0.92em;
  cursor:pointer; outline:none; -webkit-appearance:none; appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235A5A5A'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right 10px center;
  min-height:36px;
}
.filter-select:focus { border-color:var(--accent); }
.filter-select option { background:var(--bg-1); color:var(--cream); }

.cellar { padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
.empty-state { text-align:center; padding:44px 20px; }
.empty-glass { width:36px; margin:0 auto 12px; opacity:0.4; }
.empty-title { font-family:var(--font-serif); color:var(--cream); font-size:1.15em; margin-bottom:5px; }
.empty-sub { font-size:0.92em; color:var(--muted); }

.rack { margin-bottom:10px; animation:slide-in 0.3s ease-out both; }
@keyframes slide-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

.rack-frame {
  display:flex; align-items:center; gap:6px;
  background:var(--bg-1); border:1px solid var(--border); border-bottom:none;
  border-radius:10px 10px 0 0; padding:8px 9px; min-height:0;
}
.rack-counters { display:flex; flex-direction:column; align-items:flex-end; gap:1px; min-width:24px; }
.type-count { font-size:0.69em; font-weight:700; display:block; }
.rack-actions { display:flex; flex-direction:column; gap:3px; margin-left:2px; }
.icon-btn { background:none; border:none; cursor:pointer; font-size:0.85em; padding:2px; opacity:0.3; color:var(--cream); transition:opacity 0.15s; line-height:1; }
.icon-btn:hover { opacity:1; }

.rack-dots { display:grid; flex:1; gap:4px 3px; align-items:stretch; overflow:visible; }
.dot { height:80px; width:100%; cursor:pointer; transition:transform 0.12s, filter 0.12s; display:flex; align-items:center; justify-content:center; }
.dot--empty { opacity:0.3; }
.dot--empty:hover { opacity:0.55; transform:scale(1.08); }
.dot--filled { filter:drop-shadow(0 2px 4px var(--dot-glow,rgba(192,57,43,0.35))); }
.dot--filled:hover { transform:scale(1.12) translateY(-2px); filter:drop-shadow(0 4px 8px var(--dot-glow,rgba(192,57,43,0.6))); }
.dot--selected { filter:drop-shadow(0 0 5px var(--gold)) drop-shadow(0 2px 5px var(--dot-glow,rgba(192,57,43,0.4))); transform:scale(1.1); }
.dot--alt { transform:rotate(180deg); }
.dot--alt:hover { transform:rotate(180deg) scale(1.12) translateY(2px); }
.dot--alt.dot--selected { transform:rotate(180deg) scale(1.1); }
.dot--dragging { opacity:0.25 !important; cursor:grabbing !important; }
.dot--filled[draggable="true"] { cursor:grab; }
.dot--drag-over { filter:drop-shadow(0 0 6px var(--accent)) !important; transform:scale(1.18) translateY(-2px); opacity:1 !important; }

/* ─── Scène 3D (Three.js) ─── */
.view3d-stage {
  position:relative; background:linear-gradient(180deg,#15100C 0%,#0C0A08 100%);
  border:1px solid var(--border); border-radius:12px; overflow:hidden;
}
.three-loading {
  display:flex; align-items:center; justify-content:center; gap:8px;
  height:170px; color:var(--muted); font-size:0.92em;
}
.view3d-stage .mm-spinner {
  display:inline-block; width:12px; height:12px;
  border:2px solid var(--border); border-top-color:var(--accent);
  border-radius:50%; animation:t3-spin 0.7s linear infinite;
}
@keyframes t3-spin { to{transform:rotate(360deg)} }
.t3-badge {
  position:absolute; transform:translateX(-50%); display:flex; align-items:center; gap:6px;
  background:rgba(14,12,10,0.82); border:1px solid #2E2620;
  border-radius:8px; padding:3px 10px; font-size:0.77em; color:var(--cream);
  letter-spacing:0.5px; pointer-events:none; backdrop-filter:blur(3px);
  white-space:nowrap;
}
.t3-badge b { color:var(--accent); font-family:var(--font-serif); font-size:1.2em; }
.t3-badge span { color:var(--wood-lt); font-size:0.9em; }
.t3-rail {
  position:absolute; right:6px; display:flex; flex-direction:column; gap:10px;
  background:rgba(14,12,10,0.82); border:1px solid #2E2620;
  border-radius:9px; padding:7px 5px; backdrop-filter:blur(3px);
}
.t3-rail .icon-btn { opacity:0.6; font-size:1em; }
.t3-rail .icon-btn:hover { opacity:1; }

.rack-label {
  background:linear-gradient(90deg,var(--wood-dk),var(--wood-md),var(--wood-lt),var(--wood-md),var(--wood-dk));
  border:1px solid var(--wood-lt); border-top:none; border-radius:0 0 10px 10px;
  display:flex; align-items:center; justify-content:center; gap:8px; padding:4px 12px;
  font-size:0.69em; font-weight:600; color:var(--gold); letter-spacing:2px; text-transform:uppercase;
}
.rack-pct { color:var(--wood-lt); font-size:0.62em; }

/* ─── Footer détail : 4 boutons ─── */
.mm-footer-detail { gap:5px; flex-wrap:wrap; }
.mm-footer-detail .mm-btn { flex:1; min-width:0; font-size:0.77em; padding:7px 6px; }


/* ─── Historique valeur ─── */
.hist-summary { display:flex; gap:8px; margin-bottom:8px; }
.hist-stat { flex:1; display:flex; flex-direction:column; align-items:center;
  padding:8px; background:var(--bg-2); border-radius:8px; border:1px solid var(--border); }
.hist-val { font-size:1.23em; font-weight:700; color:var(--cream); font-family:var(--font-serif); }
.hist-lbl { font-size:0.69em; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
.hist-table { margin-top:12px; display:flex; flex-direction:column; gap:4px; }
.hist-row { display:flex; align-items:center; padding:5px 8px; background:var(--bg-2);
  border-radius:6px; border:1px solid var(--border); font-size:0.85em; }
.hist-date { color:var(--muted); flex:1; }
.hist-bottles { color:var(--muted); margin-right:12px; }
.hist-price { color:var(--cream); font-weight:600; font-family:var(--font-serif); }

/* ─── Cellule bouteille (dot-cell) ─── */
.dot-cell {
  display:flex; flex-direction:column; align-items:center;
  justify-content:flex-start; width:100%; overflow:hidden;
}
.dot-cell > .dot {
  flex-shrink:0;
}
.dot-labels {
  width:100%; overflow:hidden; flex-shrink:0;
  display:flex; flex-direction:column; align-items:stretch;
}
.dot-lbl {
  display:block; width:100%; box-sizing:border-box;
  font-size:0.85em; font-weight:700; text-align:center; line-height:1.3;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  text-transform:uppercase; letter-spacing:0.4px; opacity:0.9; padding-top:1px;
  flex:1;
}

/* ─── Responsive mobile ─── */
@media (max-width: 500px) {
  .cellar { padding:6px 5px; }
  .rack-frame { padding:4px 5px; }
  .rack-dots { gap:2px !important; grid-auto-rows:auto !important; }
  .dot-cell { height:auto !important; min-height:0 !important; }
  .dot { height:50px !important; min-height:0 !important; }
  .dot-svg-b { height:50px !important; width:auto !important; }
  .dot-labels { height:auto !important; }
  .dot-lbl { font-size:0.69em; letter-spacing:0; }
  .header { padding:7px 8px 6px; gap:7px; }
  .header-glass { width:22px; }
  .header-name { font-size:0.69em; }
  .stat-value { font-size:0.92em; }
  .stat { padding:3px 4px; }
  .btn-primary, .btn-secondary { font-size:0.77em; padding:5px 7px; }
  .filter-select { font-size:0.85em; min-height:30px; padding:4px 24px 4px 8px; }
  .rack-label { font-size:0.54em; letter-spacing:1px; padding:3px 8px; }
}
</style>`;

// ── CSS du modal ────────────────────────────────────────────────────────────────

const MODAL_CSS = `
@keyframes mm-fade  { from{opacity:0} to{opacity:1} }
@keyframes mm-slide { from{opacity:0;transform:translateY(-18px)} to{opacity:1;transform:translateY(0)} }
@keyframes mm-spin  { to{transform:rotate(360deg)} }

.mm-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:99999;
  display:flex; align-items:flex-start; justify-content:center; padding-top:12px;
  animation:mm-fade 0.15s ease; font-family:var(--font-sans); font-size:var(--fs-base, 13px);
  --mm-bg0: var(--primary-background-color, #080808);
  --mm-bg1: var(--card-background-color, #111);
  --mm-bg2: var(--secondary-background-color, #181818);
  --mm-bg3: color-mix(in srgb, var(--card-background-color, #1A1A1A) 80%, var(--primary-text-color, white) 20%);
  --mm-text: var(--primary-text-color, #EDE0CC);
  --mm-muted: var(--secondary-text-color, #555);
  --mm-border: var(--divider-color, #222);
  --mm-red: var(--primary-color, #C0392B);
  --mm-red-h: var(--secondary-color, #E74C3C);
}
.mm-box {
  background:var(--mm-bg1); border:1px solid var(--mm-border); border-top:none;
  border-radius:0 0 20px 20px;
  width:100%; max-width:520px; max-height:92vh;
  display:flex; flex-direction:column;
  animation:mm-slide 0.22s ease-out; color:var(--mm-text);
  overflow:hidden;
}
.mm-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:16px 20px 12px; border-bottom:1px solid var(--mm-border);
  flex-shrink:0; background:var(--mm-bg1); z-index:2;
}
.mm-title { font-family:var(--font-serif); font-size:1.23em; color:var(--mm-text); }
.mm-close { background:none; border:none; color:var(--mm-muted); cursor:pointer; font-size:1.38em; padding:0 4px; transition:color 0.15s; }
.mm-close:hover { color:var(--mm-text); }
.mm-body  { padding:16px 20px; flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.mm-footer {
  padding:12px 20px; border-top:1px solid var(--mm-border);
  display:flex; gap:8px; justify-content:flex-end; align-items:center;
  flex-shrink:0; background:var(--mm-bg1);
}
.mm-sync-label {
  font-size:0.85em; color:var(--mm-muted); margin-right:auto;
  display:flex; align-items:center; gap:5px; cursor:pointer;
}
.mm-field  { margin-bottom:12px; }
.mm-label  { display:block; font-size:0.77em; text-transform:uppercase; letter-spacing:1px; color:var(--mm-red); margin-bottom:4px; }
.mm-input  {
  width:100%; padding:9px 11px;
  background:var(--mm-bg0); border:1px solid var(--mm-border); border-radius:8px;
  color:var(--mm-text); font-family:var(--font-sans); font-size:1em;
  outline:none; transition:border-color 0.15s; box-sizing:border-box;
}
.mm-input:focus { border-color:var(--mm-red); box-shadow:0 0 0 2px rgba(192,57,43,0.1); }
.mm-input option { background:var(--mm-bg1); }
.mm-textarea { min-height:66px; resize:vertical; }
/* Coup de cœur : étoile jaune pleine si actif, contour gris sinon */
.mm-fav {
  width:100%; min-height:38px; padding:0;
  background:var(--mm-bg0); border:1px solid var(--mm-border); border-radius:8px;
  color:var(--mm-muted,#888); font-size:1.45em; line-height:1; cursor:pointer;
  transition:all 0.15s;
}
.mm-fav:hover { border-color:#F5C518; color:#F5C518; }
.mm-fav.on { color:#F5C518; border-color:#F5C518; background:rgba(245,197,24,0.08); }
.mm-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

.mm-btn { padding:10px 18px; border-radius:8px; border:none; font-family:var(--font-sans); font-size:1em; font-weight:600; cursor:pointer; transition:all 0.15s; }
.mm-btn-primary { background:var(--mm-red); color:#fff; }
.mm-btn-primary:hover { background:var(--mm-red-h); transform:translateY(-1px); }
.mm-btn-ghost { background:var(--mm-bg3); color:var(--mm-text); border:1px solid var(--mm-border); }
.mm-btn-ghost:hover { background:var(--mm-bg2); }
.mm-btn-danger { background:rgba(140,10,10,0.3); color:#ff6b6b; border:1px solid rgba(140,10,10,0.4); }
.mm-btn-danger:hover { background:rgba(140,10,10,0.55); }

/* Bloc recherche */
.mm-search-block { margin-bottom:14px; }
.mm-search-row   { display:flex; gap:8px; align-items:center; }
.mm-search-wrap  { position:relative; display:flex; align-items:center; flex:1; }
.mm-search-icon  { position:absolute; left:11px; font-size:1em; pointer-events:none; }
.mm-search-input { padding-left:32px !important; }

/* Bouton photo */
.mm-btn-photo {
  flex-shrink:0; width:40px; height:40px; border-radius:8px;
  background:var(--mm-bg3); border:1px solid var(--mm-border); cursor:pointer;
  font-size:1.38em; display:flex; align-items:center; justify-content:center;
  transition:all 0.15s;
}
.mm-btn-photo:hover { background:var(--mm-bg2); border-color:rgba(192,57,43,0.27); }

/* Spinner */
.mm-spinner {
  display:inline-block; width:12px; height:12px;
  border:2px solid var(--mm-border); border-top-color:var(--mm-red);
  border-radius:50%; animation:mm-spin 0.7s linear infinite;
  vertical-align:middle; margin-right:6px;
}

/* Résultats */
.mm-viv-results {
  background:var(--mm-bg0); border:1px solid var(--mm-border); border-top:none;
  border-radius:0 0 8px 8px;
  display:none; max-height:220px; overflow-y:auto;
}
.mm-viv-item {
  display:flex; align-items:flex-start; gap:9px;
  padding:10px 12px; cursor:pointer;
  border-bottom:1px solid var(--mm-bg2); transition:background 0.12s;
}
.mm-viv-item:hover { background:var(--mm-bg2); }
.mm-viv-item:last-child { border-bottom:none; }
.mm-viv-name { font-size:1em; color:var(--mm-text); font-weight:500; }
.mm-viv-sub  { font-size:0.77em; color:var(--mm-muted); margin-top:2px; }
.mm-viv-notes { font-size:0.77em; color:var(--mm-muted); margin-top:3px; font-style:italic; line-height:1.4; }
.mm-viv-loading { padding:12px; font-size:0.92em; color:var(--mm-muted); text-align:center; display:flex; align-items:center; justify-content:center; gap:6px; }

/* Bannière erreur/info sous la recherche */
.mm-search-banner {
  font-size:0.85em; line-height:1.5; border-radius:6px;
  padding:8px 10px; margin-top:6px;
}
.mm-search-banner--error   { background:#200808; color:#ff9090; border:1px solid #401010; }
.mm-search-banner--warning { background:#1E1400; color:#ffcc70; border:1px solid #402800; }
.mm-search-banner--info    { background:#080E18; color:#80b4e8; border:1px solid #102030; }

/* Photo */
.mm-photo-loading { text-align:center; padding:10px 0; }
.mm-photo-error {
  font-size:0.92em; color:#ff9090; background:#200808;
  border:1px solid #401010; border-radius:8px;
  padding:10px 12px; margin-bottom:10px; text-align:center;
}

/* Sélecteur de slot */
.sp-picker { margin-top:6px; }
.sp-grid {
  display:grid; gap:5px;
  margin-bottom:6px;
}
.sp-dot {
  aspect-ratio:1; border-radius:50%;
  background:var(--sp-c, var(--mm-bg3, #2a2a2a));
  border:1px solid var(--mm-border, #444);
  transition:transform .12s, box-shadow .12s;
}
.sp-free { cursor:pointer; }
.sp-free:hover { transform:scale(1.15); border-color:var(--mm-muted, #888); }
.sp-sel {
  background:var(--sp-c, #a78bfa) !important;
  border-color:#a78bfa;
  box-shadow:0 0 0 2px #a78bfa55;
}
.sp-taken {
  background:var(--sp-c, var(--mm-bg3, #555)) !important;
  opacity:0.75;
  cursor:not-allowed;
}
.sp-label { font-size:0.77em; color:var(--mm-muted); }

/* Badges d'emplacement (fiche détail + recherche) */
.mm-slot-badges {
  display:flex; flex-wrap:wrap; gap:4px; align-items:center;
  font-size:var(--fs-base, 13px);
}
.mm-slot-badge {
  background:var(--mm-bg2); border:1px solid var(--mm-border); border-radius:6px;
  padding:2px 7px; font-size:0.77em; white-space:nowrap; color:var(--mm-text);
}
.mm-slot-badge--edit { cursor:pointer; }
.mm-slot-badge--edit:hover { border-color:var(--mm-gold,#C9A84C); color:var(--mm-gold,#C9A84C); }

/* Détail */
.mm-detail-hero  { text-align:center; margin-bottom:18px; }
.mm-detail-name  { font-family:var(--font-serif); font-size:1.54em; color:var(--mm-text); margin-bottom:4px; }
.mm-detail-sub   { font-size:0.92em; color:var(--mm-muted); }
.mm-vivino-link  { display:inline-block; margin-top:8px; color:var(--mm-red); font-size:0.85em; text-decoration:none; border:1px solid rgba(192,57,43,0.3); padding:3px 10px; border-radius:20px; }
.mm-detail-grid  { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:10px; }
.mm-drow         { background:var(--mm-bg2); border-radius:8px; padding:9px 11px; border:1px solid var(--mm-border); }
.mm-drow-label   { display:block; font-size:0.69em; text-transform:uppercase; letter-spacing:1px; color:var(--mm-muted); margin-bottom:2px; }
.mm-drow-value   { font-size:1em; color:var(--mm-text); font-weight:500; }
.mm-notes        { font-size:0.92em; color:var(--mm-muted); background:var(--mm-bg2); padding:10px 12px; border-radius:8px; border-left:2px solid var(--mm-red); line-height:1.55; margin-bottom:6px; }
.mm-notes--empty { font-style:italic; opacity:0.55; border-left-color:var(--mm-border); }
.mm-tasting      { border-left-color:var(--mm-red); font-style:italic; }
.mm-pairing      { border-left-color:#27AE8F; font-style:normal; }

/* ── Footer fiche détail : bouton "J'ai bu" pleine largeur + ligne d'actions ── */
.mm-footer-wrap { flex-direction:column; gap:8px; }
.mm-footer-row { display:flex; gap:6px; width:100%; }
.mm-footer-row .mm-btn { flex:1; min-width:0; font-size:0.85em; padding:8px 6px; }
.mm-btn-drink {
  width:100%; background:linear-gradient(135deg,#7B1D2E,#A02838); color:#F4D5D5;
  border:1px solid #C0394A; font-size:1em; padding:11px;
}
.mm-btn-drink:hover { background:linear-gradient(135deg,#8B2030,#B83042); transform:translateY(-1px); }

/* ── Sélecteur d'étoiles ── */
.mm-stars { display:flex; gap:6px; font-size:2.3em; line-height:1; cursor:pointer; }
.mm-star { color:var(--mm-muted,#444); transition:color 0.12s, transform 0.12s; user-select:none; }
.mm-star:hover { transform:scale(1.15); }
.mm-star--on { color:#E8B84B; }

/* ── Stats en tête de modale (historique valeur + journal) ── */
.hist-summary { display:flex; gap:8px; margin-bottom:8px; }
.hist-stat { flex:1; display:flex; flex-direction:column; align-items:center;
  padding:8px; background:var(--mm-bg2); border-radius:8px; border:1px solid var(--mm-border); }
.hist-val { font-size:1.23em; font-weight:700; color:var(--mm-text); font-family:var(--font-serif); }
.hist-lbl { font-size:0.69em; color:var(--mm-muted); text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
.hist-table { margin-top:12px; display:flex; flex-direction:column; gap:4px; }
.hist-row { display:flex; align-items:center; padding:5px 8px; background:var(--mm-bg2);
  border-radius:6px; border:1px solid var(--mm-border); font-size:0.85em; }
.hist-date { color:var(--mm-muted); flex:1; }
.hist-bottles { color:var(--mm-muted); margin-right:12px; }
.hist-price { color:var(--mm-text); font-weight:600; font-family:var(--font-serif); }

/* ── Journal de dégustation ── */
.journal-list { display:flex; flex-direction:column; gap:8px; }
.journal-row {
  background:var(--mm-bg2); border:1px solid var(--mm-border); border-radius:10px;
  padding:10px 12px;
}
.journal-main { display:flex; align-items:flex-start; gap:9px; }
.journal-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; margin-top:5px; }
.journal-name { font-size:1em; color:var(--mm-text); font-weight:600; }
.journal-sub { font-size:0.77em; color:var(--mm-muted); margin-top:2px; }
.journal-comment { font-size:0.85em; color:var(--mm-muted); font-style:italic; margin-top:5px; line-height:1.45; }
.journal-del {
  background:none; border:none; color:var(--mm-muted); cursor:pointer; font-size:1em;
  padding:2px 4px; flex-shrink:0; transition:color 0.15s;
}
.journal-del:hover { color:#ff6b6b; }
.journal-meta {
  display:flex; align-items:center; gap:12px; margin-top:8px;
  padding-top:8px; border-top:1px solid var(--mm-border);
}
.journal-stars { font-size:1.08em; letter-spacing:1px; }
.journal-date { font-size:0.77em; color:var(--mm-muted); }
.journal-price { font-size:0.85em; color:var(--mm-text); font-weight:600; margin-left:auto; font-family:var(--font-serif); }

`;

// ── Enregistrement ─────────────────────────────────────────────────────────────

console.info(
  "%c 🍷 MILLESIME-CARD %c v" + MILLESIME_CARD_VERSION + " ",
  "background:#7B1D2E;color:#F4D5D5;font-weight:700;border-radius:3px 0 0 3px;padding:2px 0",
  "background:#2A2A2A;color:#C9A84C;font-weight:700;border-radius:0 3px 3px 0;padding:2px 0"
);

// Garde anti-double-définition : la carte est désormais auto-enregistrée par
// l'intégration. Si une ancienne ressource Lovelace manuelle (/local/…) coexiste
// encore, le second chargement échouerait sur "already defined" — on l'évite.
if (!customElements.get("millesime-card")) {
  customElements.define("millesime-card", MillesimeCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type:        "millesime-card",
  name:        "Millésime — Cave à Vin",
  description: "Cave à vin — Gemini AI (texte + photo), journal de dégustation (v" + MILLESIME_CARD_VERSION + ")",
  preview:     true,
});