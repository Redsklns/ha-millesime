/**
 * Millésime Card v7.1.11
 * Cave à vin pour Home Assistant
 * - Recherche texte avec suggestions temps réel
 * - Lecture d'étiquette par photo (Gemini Vision)
 * - Messages d'erreur pro : quota, clé invalide, indisponibilité
 * - Journal de dégustation, recherche dans la cave, déplacement de casier
 */

const MILLESIME_CARD_VERSION = "7.1.11";

// ── Budget quotidien Gemini (free tier) ─────────────────────────────────────
// Estimation codée en dur : ~250 requêtes/jour (Gemini 2.5 Flash, quotas
// resserrés fin 2025) × ~2 000 tokens par appel Millésime ≈ 500 000 tokens/j.
// Google modifie ces quotas SANS préavis : la valeur s'ajuste ici uniquement.
const GEMINI_FREE_TIER_DAILY_BUDGET = 500000;

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
  { v: "gift",          l: "Cadeau",           emoji: "🎁" },
];
const EVENT_LABEL = Object.fromEntries(EVENT_TYPES.map(e => [e.v, e]));

// ── Bibliothèque d'accords mets/vin (locale, hors-ligne) ─────────────────────
// 2 familles (Aliments, Recettes) → catégories → plats. Pour chaque plat :
//   kw    = mots-clés cherchés dans le champ food_pairing (généré par l'IA à l'ajout)
//   types = types de vin idéaux (red/white/rose/sparkling/dessert)
//   notes = mots-clés cherchés dans les notes de dégustation (caractéristiques)
const FOOD_LIBRARY_BASE = {
  "Aliments": {
    "Poissons": {
      "Poisson blanc":         { kw:["poisson blanc","cabillaud","bar","sole","dorade","colin","merlu","poisson"], types:["white"], notes:["vif","frais","minéral"] },
      "Poisson gras / saumon": { kw:["saumon","thon","maquereau","sardine","poisson gras"], types:["white","rose"], notes:["gras","rond","fruité"] },
      "Poisson fumé":          { kw:["fumé","saumon fumé","truite fumée"], types:["white","sparkling"], notes:["vif","minéral"] },
      "Poisson en sauce":      { kw:["poisson","sauce","beurre blanc"], types:["white"], notes:["rond","gras","beurré"] },
    },
    "Fruits de mer": {
      "Huîtres":               { kw:["huître","huitre","coquillage"], types:["white","sparkling"], notes:["minéral","vif","iodé"] },
      "Crustacés (homard, crabe)": { kw:["homard","crabe","langouste","crustacé","crustace","écrevisse"], types:["white","sparkling"], notes:["rond","gras","minéral"] },
      "Crevettes / gambas":    { kw:["crevette","gambas","scampi"], types:["white","rose"], notes:["vif","frais"] },
      "Coquilles Saint-Jacques":{ kw:["saint-jacques","noix de saint-jacques","coquille"], types:["white","sparkling"], notes:["rond","beurré","minéral"] },
      "Moules":                { kw:["moule","moules"], types:["white"], notes:["vif","minéral"] },
    },
    "Fromages": {
      "Pâte dure (comté, gruyère)": { kw:["comté","gruyère","pâte dure","pâte pressée","cantal","beaufort"], types:["white","red"], notes:["rond","fruité"] },
      "Pâte molle (camembert, brie)": { kw:["camembert","brie","pâte molle","coulommiers","croûte fleurie"], types:["red","white"], notes:["souple","fruité"] },
      "Fromage bleu":          { kw:["bleu","roquefort","gorgonzola","fourme","persillé"], types:["dessert","red"], notes:["liquoreux","puissant"] },
      "Chèvre":                { kw:["chèvre","chevre","crottin"], types:["white","rose"], notes:["vif","frais","minéral"] },
      "Fromage à croûte lavée (munster)": { kw:["munster","époisses","maroilles","croûte lavée"], types:["white","dessert"], notes:["aromatique","puissant"] },
    },
    "Desserts": {
      "Dessert au chocolat":   { kw:["chocolat","fondant","mousse au chocolat","brownie"], types:["dessert","red"], notes:["liquoreux","puissant","fruité"] },
      "Tarte aux fruits":      { kw:["tarte","fruits","pomme","poire","abricot","tatin"], types:["dessert","sparkling"], notes:["liquoreux","fruité","sucré"] },
      "Pâtisserie crémeuse":   { kw:["crème","crème brûlée","flan","pâtisserie","mille-feuille"], types:["dessert"], notes:["liquoreux","sucré"] },
      "Fruits rouges":         { kw:["fruits rouges","fraise","framboise"], types:["dessert","sparkling","rose"], notes:["fruité","sucré"] },
      "Foie gras (dessert sucré)": { kw:["foie gras"], types:["dessert"], notes:["liquoreux","sucré","gras"] },
    },
    "Apéritif & entrées": {
      "Apéritif / amuse-bouches": { kw:["apéritif","aperitif","amuse-bouche","apéro","tapas"], types:["sparkling","white","rose"], notes:["vif","léger","frais"] },
      "Salade / crudités":     { kw:["salade","crudité","légumes crus","vinaigrette"], types:["white","rose"], notes:["vif","frais"] },
      "Foie gras (entrée)":    { kw:["foie gras","terrine de foie"], types:["dessert","white"], notes:["liquoreux","rond"] },
      "Soupe / velouté":       { kw:["soupe","velouté","potage"], types:["white"], notes:["rond","souple"] },
      "Quiche / tarte salée":  { kw:["quiche","tarte salée","tarte aux légumes"], types:["white","rose"], notes:["vif","rond"] },
    },
    "Végétarien & légumes": {
      "Légumes grillés":       { kw:["légumes grillés","aubergine","courgette","ratatouille","poivron"], types:["rose","red","white"], notes:["fruité","souple"] },
      "Champignons":           { kw:["champignon","cèpe","girolle","morille"], types:["red","white"], notes:["terreux","rond"] },
      "Truffe":                { kw:["truffe"], types:["red","white"], notes:["puissant","aromatique"] },
      "Plats à base d'œuf":    { kw:["œuf","oeuf","omelette","quiche"], types:["white","red"], notes:["souple","vif"] },
      "Risotto / pâtes":       { kw:["risotto","pâtes","pasta","gnocchi"], types:["white","red"], notes:["rond","fruité"] },
    },
  },
  "Recettes": {
    "Plats mijotés français": {
      "Bœuf bourguignon":      { kw:["boeuf","bœuf","bourguignon","mijoté","sauce","vin rouge"], types:["red"], notes:["corsé","charpenté"] },
      "Coq au vin":            { kw:["coq","volaille","vin rouge","sauce","mijoté"], types:["red"], notes:["corsé","fruité"] },
      "Daube provençale":      { kw:["daube","boeuf","bœuf","mijoté","provençal"], types:["red"], notes:["épicé","corsé"] },
      "Pot-au-feu":            { kw:["pot-au-feu","boeuf","bœuf","bouilli","légumes"], types:["red","white"], notes:["souple","fruité"] },
      "Blanquette de veau":    { kw:["blanquette","veau","crème","sauce blanche"], types:["white"], notes:["rond","gras","beurré"] },
      "Cassoulet":             { kw:["cassoulet","haricot","confit","saucisse"], types:["red"], notes:["corsé","rustique","puissant"] },
      "Pot-au-feu / bœuf braisé": { kw:["braisé","boeuf","bœuf","mijoté"], types:["red"], notes:["corsé"] },
    },
    "Rôtis & grillades": {
      "Magret de canard":      { kw:["magret","canard"], types:["red"], notes:["fruité","épicé","corsé"] },
      "Confit de canard":      { kw:["confit","canard"], types:["red"], notes:["corsé","fruité"] },
      "Steak frites":          { kw:["steak","frites","boeuf","bœuf","grillade"], types:["red"], notes:["tannique","fruité"] },
      "Côte de bœuf":          { kw:["côte de bœuf","boeuf","bœuf","grillade"], types:["red"], notes:["tannique","puissant"] },
      "Gigot d'agneau":        { kw:["gigot","agneau"], types:["red"], notes:["tannique","épicé"] },
      "Poulet rôti":           { kw:["poulet","rôti","volaille"], types:["white","red"], notes:["souple","fruité"] },
      "Barbecue / grillades":  { kw:["barbecue","bbq","grillade","grillé"], types:["red","rose"], notes:["fruité","épicé"] },
    },
    "Plats régionaux & montagne": {
      "Raclette":              { kw:["raclette","fromage fondu","charcuterie"], types:["white","red"], notes:["vif","fruité"] },
      "Fondue savoyarde":      { kw:["fondue","fromage fondu"], types:["white"], notes:["vif","minéral"] },
      "Tartiflette":           { kw:["tartiflette","reblochon","pomme de terre"], types:["white","red"], notes:["vif","fruité"] },
      "Choucroute":            { kw:["choucroute","chou","saucisse","porc"], types:["white"], notes:["vif","aromatique"] },
      "Aligot":                { kw:["aligot","fromage","pomme de terre"], types:["red","white"], notes:["fruité","souple"] },
    },
    "Pâtes, pizza & gratins": {
      "Lasagnes / bolognaise": { kw:["lasagne","bolognaise","tomate","viande","pâtes"], types:["red"], notes:["fruité","souple"] },
      "Pizza":                 { kw:["pizza","tomate","mozzarella"], types:["red","rose"], notes:["fruité","souple"] },
      "Pâtes à la carbonara":  { kw:["carbonara","pâtes","crème","lard"], types:["white","red"], notes:["rond","vif"] },
      "Gratin dauphinois":     { kw:["gratin","pomme de terre","crème"], types:["white","red"], notes:["rond","souple"] },
      "Risotto":               { kw:["risotto","riz","parmesan"], types:["white"], notes:["rond","gras"] },
    },
    "Mer & iodé": {
      "Plateau de fruits de mer": { kw:["fruits de mer","huître","huitre","crustacé","coquillage"], types:["white","sparkling"], notes:["minéral","vif","iodé"] },
      "Bouillabaisse":         { kw:["bouillabaisse","poisson","soupe de poisson"], types:["white","rose"], notes:["vif","aromatique"] },
      "Moules-frites":         { kw:["moule","frites"], types:["white"], notes:["vif","minéral"] },
      "Paella":                { kw:["paella","riz","fruits de mer","safran"], types:["rose","white"], notes:["fruité","vif"] },
      "Sushi / sashimi":       { kw:["sushi","sashimi","poisson cru","riz"], types:["white","sparkling"], notes:["vif","minéral","frais"] },
    },
    "Desserts": {
      "Fondant au chocolat":   { kw:["chocolat","fondant"], types:["dessert","red"], notes:["liquoreux","puissant"] },
      "Tarte Tatin":           { kw:["tatin","pomme","tarte"], types:["dessert"], notes:["liquoreux","sucré"] },
      "Crème brûlée":          { kw:["crème brûlée","crème","vanille"], types:["dessert"], notes:["liquoreux","sucré"] },
      "Salade de fruits":      { kw:["fruits","salade de fruits"], types:["dessert","sparkling"], notes:["fruité","frais"] },
    },
  },
};

// ── Table d'ingrédients / préparations / cuisines → profil de vin ─────────────
// Sert à la RECHERCHE LIBRE : on découpe le texte saisi, on reconnaît ces mots,
// et on agrège un profil de vin idéal. Couvre des milliers de plats sans les lister.
// Chaque entrée : [ [synonymes], { types:[...], notes:[...] } ]
const PAIR_KEYWORDS = [
  // Viandes
  [["boeuf","bœuf","steak","entrecôte","bavette","rumsteck","faux-filet","tournedos","chateaubriand","onglet","hampe","araignée","paleron","picanha","rosbif"], { types:["red"], notes:["tannique","corsé","charpenté"] }],
  [["agneau","gigot","mouton","souris d'agneau","carré d'agneau","côtelette"], { types:["red"], notes:["tannique","épicé","corsé"] }],
  [["veau","escalope","osso buco","blanquette"], { types:["white","red"], notes:["rond","souple"] }],
  [["porc","échine","filet mignon","rôti de porc","travers","jambon","pluma","secreto","presa","jambonneau"], { types:["red","white","rose"], notes:["fruité","souple"] }],
  [["canard","magret","confit","cuisse de canard"], { types:["red"], notes:["fruité","épicé","corsé"] }],
  [["poulet","volaille","poule","chapon","pintade","coquelet"], { types:["white","red"], notes:["souple","fruité"] }],
  [["dinde","oie"], { types:["white","red"], notes:["rond","souple"] }],
  [["lapin"], { types:["white","red"], notes:["souple","fruité"] }],
  [["gibier","chevreuil","sanglier","biche","venaison","faisan","perdrix"], { types:["red"], notes:["puissant","épicé","corsé"] }],
  [["saucisse","merguez","chipolata","andouillette","boudin","saucisson"], { types:["red","white"], notes:["fruité","vif"] }],
  [["charcuterie","jambon","pâté","terrine","rillettes","chorizo","salami"], { types:["red","white","rose"], notes:["fruité","vif"] }],
  [["tartare","carpaccio","viande crue"], { types:["red","white"], notes:["fruité","léger"] }],
  [["bœuf bourguignon","boeuf bourguignon","daube","ragoût","pot-au-feu","braisé","mijoté","navarin","goulash"], { types:["red"], notes:["corsé","charpenté"] }],
  [["cassoulet","choucroute","potée","confit"], { types:["red","white"], notes:["corsé","rustique"] }],
  // Poissons & mer
  [["poisson","cabillaud","bar","loup","dorade","sole","colin","merlu","lieu","églefin","limande"], { types:["white"], notes:["vif","frais","minéral"] }],
  [["saumon","truite","thon","maquereau","sardine","hareng","anguille"], { types:["white","rose"], notes:["gras","rond","fruité"] }],
  [["fumé","saumon fumé","truite fumée","haddock"], { types:["white","sparkling"], notes:["vif","minéral"] }],
  [["huître","huitre","coquillage","bulot","bigorneau"], { types:["white","sparkling"], notes:["minéral","vif","iodé"] }],
  [["homard","langouste","crabe","tourteau","écrevisse","langoustine"], { types:["white","sparkling"], notes:["rond","gras","minéral"] }],
  [["crevette","gambas","scampi"], { types:["white","rose"], notes:["vif","frais"] }],
  [["saint-jacques","coquille saint-jacques","noix de saint-jacques","pétoncle"], { types:["white","sparkling"], notes:["rond","beurré","minéral"] }],
  [["moule","palourde","praire"], { types:["white"], notes:["vif","minéral"] }],
  [["calamar","calmar","poulpe","seiche","encornet"], { types:["white","rose"], notes:["vif","frais"] }],
  [["sushi","sashimi","maki","poisson cru","ceviche","tartare de poisson","poke"], { types:["white","sparkling"], notes:["vif","minéral","frais"] }],
  [["bouillabaisse","soupe de poisson","paella","fruits de mer","plateau de fruits de mer"], { types:["white","rose"], notes:["vif","aromatique"] }],
  // Fromages
  [["comté","gruyère","emmental","beaufort","cantal","pâte dure","tomme","abondance"], { types:["white","red"], notes:["rond","fruité"] }],
  [["camembert","brie","coulommiers","pâte molle","brillat-savarin"], { types:["red","white"], notes:["souple","fruité"] }],
  [["bleu","roquefort","gorgonzola","fourme","stilton","persillé"], { types:["dessert","red"], notes:["liquoreux","puissant"] }],
  [["chèvre","chevre","crottin","sainte-maure","bûche de chèvre"], { types:["white","rose"], notes:["vif","frais","minéral"] }],
  [["munster","époisses","maroilles","langres","croûte lavée","reblochon"], { types:["white","dessert"], notes:["aromatique","puissant"] }],
  [["raclette","fondue","tartiflette","fromage fondu","mont d'or"], { types:["white","red"], notes:["vif","minéral"] }],
  // Desserts & sucré
  [["chocolat","fondant","mousse au chocolat","brownie","truffe en chocolat","forêt-noire"], { types:["dessert","red"], notes:["liquoreux","puissant"] }],
  [["tarte","tatin","tarte aux pommes","tarte aux fruits","clafoutis","crumble"], { types:["dessert","sparkling"], notes:["liquoreux","fruité","sucré"] }],
  [["crème","crème brûlée","flan","panna cotta","île flottante","mille-feuille","éclair"], { types:["dessert"], notes:["liquoreux","sucré"] }],
  [["fruits rouges","fraise","framboise","cerise","myrtille"], { types:["dessert","sparkling","rose"], notes:["fruité","sucré"] }],
  [["citron","agrume","tarte au citron","lemon"], { types:["dessert","sparkling"], notes:["vif","sucré"] }],
  [["foie gras"], { types:["dessert","white"], notes:["liquoreux","rond","gras"] }],
  [["macaron","pâtisserie","gâteau","cake","biscuit"], { types:["dessert","sparkling"], notes:["sucré","fruité"] }],
  // Bases / préparations
  [["sauce","mijoté","crème","beurre blanc","velouté"], { types:["red","white"], notes:["rond","charpenté"] }],
  [["grillade","grillé","barbecue","bbq","plancha","brochette"], { types:["red","rose"], notes:["fruité","épicé"] }],
  [["rôti","roti","au four"], { types:["red","white"], notes:["souple","fruité"] }],
  [["friture","frit","tempura","beignet"], { types:["white","sparkling"], notes:["vif","frais"] }],
  [["champignon","cèpe","girolle","morille","truffe","pleurote"], { types:["red","white"], notes:["terreux","rond","puissant"] }],
  [["truffe"], { types:["red","white"], notes:["puissant","aromatique"] }],
  [["œuf","oeuf","omelette","quiche","brouillade"], { types:["white","red"], notes:["souple","vif"] }],
  [["risotto","pâtes","pasta","spaghetti","tagliatelle","gnocchi","lasagne","raviolis"], { types:["white","red"], notes:["rond","fruité"] }],
  [["pizza","focaccia"], { types:["red","rose"], notes:["fruité","souple"] }],
  [["tomate","ratatouille","sauce tomate","bolognaise"], { types:["red","rose"], notes:["fruité","souple"] }],
  [["gratin","pomme de terre","dauphinois","purée","aligot"], { types:["white","red"], notes:["rond","souple"] }],
  [["salade","crudité","vinaigrette"], { types:["white","rose"], notes:["vif","frais"] }],
  [["soupe","potage","velouté","bouillon"], { types:["white"], notes:["rond","souple"] }],
  [["légumes","aubergine","courgette","poivron","asperge","artichaut"], { types:["white","rose","red"], notes:["fruité","frais"] }],
  [["végétarien","vegan","tofu","légumineuse","lentille","pois chiche","houmous"], { types:["white","rose","red"], notes:["fruité","frais"] }],
  // Épices & cuisines du monde
  [["épicé","piment","pimenté","relevé","harissa"], { types:["rose","white"], notes:["fruité","demi-sec","frais"] }],
  [["curry","massala","masala","tikka","tandoori","indien"], { types:["white","rose"], notes:["aromatique","demi-sec","fruité"] }],
  [["thaï","thai","coco","lait de coco","citronnelle","gingembre","wok"], { types:["white","rose"], notes:["aromatique","demi-sec"] }],
  [["chinois","cantonais","aigre-doux","nem","nouilles sautées","canard laqué"], { types:["white","red"], notes:["fruité","demi-sec"] }],
  [["japonais","ramen","yakitori","teriyaki","miso"], { types:["white","sparkling"], notes:["vif","minéral"] }],
  [["sushi","maki","sashimi"], { types:["white","sparkling"], notes:["vif","minéral","frais"] }],
  [["mexicain","taco","fajita","chili","guacamole","burrito"], { types:["red","rose"], notes:["fruité","épicé"] }],
  [["libanais","mezze","taboulé","falafel","kebab"], { types:["rose","white"], notes:["vif","frais","fruité"] }],
  [["marocain","tajine","couscous","semoule","pastilla"], { types:["red","rose"], notes:["épicé","fruité"] }],
  [["italien","parmesan","mozzarella","burrata","antipasti","osso"], { types:["red","white"], notes:["fruité","souple"] }],
  [["espagnol","tapas","paella","gambas","jambon serrano"], { types:["red","rose"], notes:["fruité","épicé"] }],
  [["américain","burger","hot-dog","ribs","pulled pork","frites"], { types:["red"], notes:["fruité","corsé"] }],
  [["vietnamien","pho","bo bun","rouleau de printemps","bobun"], { types:["white","rose"], notes:["vif","frais"] }],
  [["apéritif","apéro","aperitif","amuse-bouche","tapas","chips","cacahuète","olive"], { types:["sparkling","white","rose"], notes:["vif","léger","frais"] }],
];

// ── Bibliothèque d'accords GÉNÉRÉE (~850 plats, tri alphabétique) ─────────────
// Construite par combinaison au chargement (protéines × préparations réelles,
// fromages nommés, desserts, cuisines du monde…). Les profils de vin sont
// dérivés par règles, puis la bibliothèque manuelle (FOOD_LIBRARY_BASE) est
// fusionnée — sans doublons de nom.
const FOOD_LIBRARY = (() => {
  const L = {}, seen = new Set();
  const add = (fam, cat, name, kw, types, notes) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ((L[fam] ??= {})[cat] ??= {})[name] = { kw, types, notes };
  };
  // Accord du participe : base (-é/-i/-t) + e (fém.) + s (pluriel)
  const acc = (base, g, pl) => base + (g === "f" ? "e" : "") + (pl ? "s" : "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // — VIANDES : pièces de boucherie nommées, profil de vin par pièce —
  // Fini les combinaisons génériques « animal × cuisson » : chaque pièce réelle
  // a sa propre entrée ; la préparation n'apparaît que lorsqu'elle est canonique
  // (joue braisée, souris confite, travers caramélisés…).
  const CUT = (cat, arr) => arr.forEach(([n, kw, ty, no]) => add("Aliments", cat, n, kw, ty, no));
  CUT("Bœuf", [
    ["Côte de bœuf",              ["côte de bœuf","boeuf","grillade"],       ["red"], ["tannique","puissant"]],
    ["Entrecôte",                 ["entrecôte","boeuf","grillade"],          ["red"], ["tannique","corsé"]],
    ["Faux-filet",                ["faux-filet","boeuf","grillade"],         ["red"], ["tannique","corsé"]],
    ["Filet de bœuf",             ["filet","boeuf"],                          ["red"], ["élégant","souple"]],
    ["Tournedos",                 ["tournedos","filet","boeuf"],             ["red"], ["élégant","corsé"]],
    ["Chateaubriand",             ["chateaubriand","filet","boeuf"],         ["red"], ["élégant","puissant"]],
    ["Rumsteck",                  ["rumsteck","boeuf","grillade"],           ["red"], ["fruité","corsé"]],
    ["Bavette à l'échalote",      ["bavette","échalote","boeuf"],            ["red"], ["fruité","tannique"]],
    ["Onglet à l'échalote",       ["onglet","échalote","boeuf"],             ["red"], ["fruité","corsé"]],
    ["Hampe grillée",             ["hampe","boeuf","grillade"],              ["red"], ["fruité","corsé"]],
    ["Araignée de bœuf",          ["araignée","boeuf","grillade"],           ["red"], ["fruité","souple"]],
    ["Poire de bœuf",             ["poire","boeuf","grillade"],              ["red"], ["fruité","souple"]],
    ["Merlan de bœuf",            ["merlan","boeuf","grillade"],             ["red"], ["fruité","souple"]],
    ["Paleron braisé",            ["paleron","braisé","boeuf"],              ["red"], ["charpenté","corsé"]],
    ["Joue de bœuf braisée",      ["joue","braisé","boeuf"],                 ["red"], ["charpenté","puissant"]],
    ["Queue de bœuf en ragoût",   ["queue de bœuf","ragoût","boeuf"],        ["red"], ["charpenté","corsé"]],
    ["Jarret de bœuf mijoté",     ["jarret","mijoté","boeuf"],               ["red"], ["charpenté","corsé"]],
    ["Plat de côtes",             ["plat de côtes","boeuf","mijoté"],        ["red"], ["corsé","rustique"]],
    ["Macreuse braisée",          ["macreuse","braisé","boeuf"],             ["red"], ["charpenté","souple"]],
    ["Tartare de bœuf",           ["tartare","cru","boeuf"],                 ["red","white"], ["fruité","léger"]],
    ["Rosbif",                    ["rosbif","rôti","boeuf"],                 ["red"], ["fruité","corsé"]],
    ["Picanha grillée",           ["picanha","boeuf","grillade"],            ["red"], ["fruité","corsé"]],
    ["T-bone",                    ["t-bone","boeuf","grillade"],             ["red"], ["tannique","puissant"]],
    ["Côte de bœuf maturée",      ["maturé","côte de bœuf","boeuf"],         ["red"], ["puissant","complexe"]],
  ]);
  CUT("Veau", [
    ["Escalope de veau",          ["escalope","veau"],                        ["white","red"], ["rond","souple"]],
    ["Côte de veau",              ["côte de veau","veau"],                    ["white","red"], ["rond","souple"]],
    ["Filet mignon de veau",      ["filet mignon","veau"],                    ["white","red"], ["élégant","souple"]],
    ["Grenadin de veau",          ["grenadin","veau"],                        ["white","red"], ["rond","élégant"]],
    ["Tendron de veau",           ["tendron","veau","mijoté"],                ["white","red"], ["rond","souple"]],
    ["Quasi de veau rôti",        ["quasi","rôti","veau"],                    ["red","white"], ["souple","fruité"]],
    ["Noix de veau",              ["noix de veau","veau"],                    ["white","red"], ["rond","élégant"]],
    ["Épaule de veau confite",    ["épaule","confit","veau"],                 ["red","white"], ["souple","rond"]],
    ["Jarret de veau",            ["jarret","veau","mijoté"],                 ["white","red"], ["rond","souple"]],
  ]);
  CUT("Agneau", [
    ["Gigot d'agneau",            ["gigot","agneau"],                         ["red"], ["tannique","épicé"]],
    ["Carré d'agneau",            ["carré","agneau"],                         ["red"], ["élégant","épicé"]],
    ["Côtelettes d'agneau grillées", ["côtelette","agneau","grillade"],       ["red"], ["fruité","épicé"]],
    ["Souris d'agneau confite",   ["souris","confit","agneau"],               ["red"], ["charpenté","épicé"]],
    ["Épaule d'agneau confite",   ["épaule","confit","agneau"],               ["red"], ["charpenté","épicé"]],
    ["Selle d'agneau",            ["selle","agneau"],                         ["red"], ["élégant","corsé"]],
    ["Filet d'agneau",            ["filet","agneau"],                         ["red"], ["élégant","fruité"]],
    ["Collier d'agneau mijoté",   ["collier","mijoté","agneau"],              ["red"], ["charpenté","épicé"]],
  ]);
  CUT("Porc", [
    ["Araignée de porc",          ["araignée","porc","grillade"],             ["red","rose"], ["fruité","souple"]],
    ["Échine de porc",            ["échine","porc"],                          ["red","white"], ["fruité","souple"]],
    ["Filet mignon de porc",      ["filet mignon","porc"],                    ["white","red"], ["rond","fruité"]],
    ["Côte de porc",              ["côte de porc","porc","grillade"],         ["red","rose"], ["fruité","souple"]],
    ["Travers de porc caramélisés", ["travers","caramélisé","porc"],          ["red"], ["fruité","épicé"]],
    ["Pluma ibérique",            ["pluma","ibérique","porc"],                ["red"], ["fruité","élégant"]],
    ["Secreto ibérique",          ["secreto","ibérique","porc"],              ["red"], ["fruité","corsé"]],
    ["Presa ibérique",            ["presa","ibérique","porc"],                ["red"], ["fruité","corsé"]],
    ["Palette de porc à la diable", ["palette","diable","porc"],              ["red","white"], ["fruité","vif"]],
    ["Rôti de porc au four",      ["rôti","four","porc"],                     ["red","white"], ["fruité","souple"]],
    ["Poitrine de porc laquée",   ["poitrine","laqué","porc"],                ["red"], ["fruité","épicé"]],
    ["Jarret de porc (jambonneau)", ["jarret","jambonneau","porc"],           ["white","red"], ["vif","fruité"]],
    ["Carré de porc",             ["carré","porc"],                           ["red","white"], ["fruité","souple"]],
    ["Joue de porc confite",      ["joue","confit","porc"],                   ["red"], ["charpenté","souple"]],
    ["Cochon de lait rôti",       ["cochon de lait","rôti","porc"],           ["red","white"], ["fruité","élégant"]],
  ]);
  CUT("Volailles", [
    ["Suprême de volaille",       ["suprême","volaille","poulet"],            ["white"], ["rond","élégant"]],
    ["Cuisses de poulet rôties",  ["cuisse","rôti","poulet"],                 ["white","red"], ["souple","fruité"]],
    ["Ailes de poulet grillées",  ["aile","grillé","poulet"],                 ["red","rose"], ["fruité","souple"]],
    ["Coquelet rôti",             ["coquelet","rôti","volaille"],             ["white","red"], ["souple","fruité"]],
    ["Chapon rôti",               ["chapon","rôti","volaille"],               ["white","red"], ["rond","élégant"]],
    ["Dinde rôtie farcie",        ["dinde","farci","rôti"],                   ["white","red"], ["rond","souple"]],
    ["Aiguillettes de canard",    ["aiguillette","canard"],                   ["red"], ["fruité","souple"]],
    ["Cuisse de canard confite",  ["confit","cuisse","canard"],               ["red"], ["corsé","fruité"]],
    ["Foie gras poêlé",           ["foie gras","poêlé"],                      ["dessert","white"], ["liquoreux","rond"]],
    ["Pintade aux choux",         ["pintade","chou","volaille"],              ["red","white"], ["fruité","souple"]],
    ["Râble de lapin",            ["râble","lapin"],                          ["white","red"], ["souple","fruité"]],
  ]);
  CUT("Abats", [
    ["Ris de veau",               ["ris de veau","abats"],                    ["white","red"], ["rond","élégant"]],
    ["Rognons de veau",           ["rognon","veau","abats"],                  ["red"], ["corsé","épicé"]],
    ["Foie de veau",              ["foie de veau","abats"],                   ["red"], ["fruité","souple"]],
    ["Langue de bœuf sauce piquante", ["langue","sauce piquante","abats"],    ["red","white"], ["vif","souple"]],
    ["Gésiers confits",           ["gésier","confit","abats"],                ["red","rose"], ["fruité","corsé"]],
  ]);

  // — POISSONS : nom (genre, pluriel) × préparations —
  const FISHES = [
    ["saumon","m",0],["thon","m",0],["cabillaud","m",0],["bar","m",0],["dorade","f",0],
    ["sole","f",0],["truite","f",0],["merlu","m",0],["lieu jaune","m",0],["sardines","f",1],
    ["maquereau","m",0],["lotte","f",0],["églefin","m",0],["saint-pierre","m",0],
    ["turbot","m",0],["rouget","m",0],["colin","m",0],["raie","f",0],
  ];
  const FISH_PREPS = [
    ["grillé",1,["grillé"],["vif","frais"],null],
    ["au four",0,["four"],["frais","minéral"],null],
    ["en papillote",0,["papillote"],["frais","léger"],null],
    ["poché",1,["poché"],["léger","minéral"],null],
    ["à la plancha",0,["plancha"],["vif"],null],
    ["en tartare",0,["tartare","cru"],["vif","minéral"],["white","sparkling"]],
    ["fumé",1,["fumé"],["minéral"],["white","sparkling"]],
    ["meunière",0,["meunière","beurre"],["rond","beurré"],null],
    ["en sauce",0,["sauce","beurre blanc"],["rond","gras"],null],
    ["en croûte de sel",0,["croûte de sel","four"],["minéral"],null],
  ];
  for (const [n, g, pl] of FISHES)
    for (const [p, a, pkw, pno, pty] of FISH_PREPS)
      add("Aliments", "Poissons", cap(`${n} ${a ? acc(p, g, pl) : p}`),
        ["poisson", n.split(" ")[0], ...pkw], pty || ["white"], pno);

  // — FRUITS DE MER —
  [["Huîtres nature",["huître"],["sparkling","white"],["iodé","minéral"]],
   ["Huîtres gratinées",["huître","gratiné"],["white"],["rond","iodé"]],
   ["Moules marinières",["moule"],["white"],["vif","minéral"]],
   ["Moules à la crème",["moule","crème"],["white"],["rond"]],
   ["Crevettes grillées",["crevette","grillé"],["white","rose"],["vif","frais"]],
   ["Gambas à l'ail",["gambas","ail"],["white","rose"],["vif","aromatique"]],
   ["Homard grillé",["homard"],["white","sparkling"],["rond","gras"]],
   ["Homard thermidor",["homard","crème"],["white"],["rond","beurré"]],
   ["Langouste",["langouste"],["white","sparkling"],["rond","minéral"]],
   ["Langoustines",["langoustine"],["white","sparkling"],["minéral","frais"]],
   ["Crabe / tourteau",["crabe","tourteau"],["white"],["vif","iodé"]],
   ["Saint-Jacques poêlées",["saint-jacques"],["white","sparkling"],["rond","beurré"]],
   ["Saint-Jacques gratinées",["saint-jacques","gratiné"],["white"],["rond","beurré"]],
   ["Plateau de fruits de mer",["fruits de mer","huître","crustacé"],["white","sparkling"],["iodé","minéral","vif"]],
   ["Bulots mayonnaise",["bulot"],["white"],["vif","iodé"]],
   ["Calamars frits",["calamar","frit"],["white","sparkling"],["vif","frais"]],
   ["Calamars à la romaine",["calamar","frit"],["white","rose"],["vif"]],
   ["Poulpe grillé",["poulpe","grillé"],["white","rose"],["vif","frais"]],
   ["Seiche à la plancha",["seiche","plancha"],["white","rose"],["vif"]],
   ["Palourdes farcies",["palourde","farci"],["white"],["iodé","aromatique"]],
   ["Oursins",["oursin"],["white","sparkling"],["iodé","minéral"]],
   ["Tarama et blinis",["tarama"],["white","sparkling"],["vif","frais"]],
  ].forEach(([n, kw, ty, no]) => add("Aliments", "Fruits de mer", n, kw, ty, no));

  // — FROMAGES (60 nommés, profil par famille) —
  const FROM = {
    "pâte dure":      [["white","red"],["rond","fruité"]],
    "bleu":           [["dessert","red"],["liquoreux","puissant"]],
    "pâte molle":     [["red","white"],["souple","fruité"]],
    "croûte lavée":   [["white","dessert"],["aromatique","puissant"]],
    "chèvre":         [["white","rose"],["vif","frais","minéral"]],
    "italien":        [["red","white"],["fruité","souple"]],
    "brebis":         [["red","white"],["rond","fruité"]],
  };
  const CHEESES = [
    ["Comté","pâte dure"],["Beaufort","pâte dure"],["Gruyère","pâte dure"],["Emmental","pâte dure"],
    ["Abondance","pâte dure"],["Cantal","pâte dure"],["Salers","pâte dure"],["Laguiole","pâte dure"],
    ["Tomme de Savoie","pâte dure"],["Mimolette","pâte dure"],["Morbier","pâte dure"],["Saint-Nectaire","pâte dure"],
    ["Roquefort","bleu"],["Bleu d'Auvergne","bleu"],["Fourme d'Ambert","bleu"],["Gorgonzola","bleu"],
    ["Stilton","bleu"],["Bleu de Gex","bleu"],
    ["Camembert","pâte molle"],["Brie de Meaux","pâte molle"],["Brie de Melun","pâte molle"],
    ["Coulommiers","pâte molle"],["Chaource","pâte molle"],["Neufchâtel","pâte molle"],["Brillat-Savarin","pâte molle"],
    ["Munster","croûte lavée"],["Époisses","croûte lavée"],["Maroilles","croûte lavée"],["Langres","croûte lavée"],
    ["Livarot","croûte lavée"],["Pont-l'Évêque","croûte lavée"],["Reblochon","croûte lavée"],["Vacherin Mont-d'Or","croûte lavée"],
    ["Chèvre frais","chèvre"],["Crottin de Chavignol","chèvre"],["Sainte-Maure","chèvre"],["Valençay","chèvre"],
    ["Picodon","chèvre"],["Pélardon","chèvre"],["Rocamadour","chèvre"],["Chabichou","chèvre"],
    ["Mozzarella","italien"],["Burrata","italien"],["Parmesan","italien"],["Pecorino","italien"],
    ["Manchego","brebis"],["Ossau-Iraty","brebis"],["Pérail","brebis"],["Feta","chèvre"],["Halloumi","brebis"],
  ];
  for (const [n, famC] of CHEESES) {
    const [ty, no] = FROM[famC];
    add("Aliments", "Fromages", n, [n.toLowerCase(), "fromage"], ty, no);
  }

  // — LÉGUMES × préparations —
  const VEGS = [
    ["aubergines","f",1],["courgettes","f",1],["poivrons","m",1],["tomates","f",1],["champignons","m",1],
    ["asperges","f",1],["artichauts","m",1],["poireaux","m",1],["chou-fleur","m",0],["brocolis","m",1],
    ["épinards","m",1],["potiron","m",0],["carottes","f",1],["haricots verts","m",1],["petits pois","m",1],
    ["fenouil","m",0],["betteraves","f",1],["endives","f",1],["navets","m",1],["panais","m",1],
  ];
  const VEG_PREPS = [
    ["grillé",1,["grillé"],["fruité","frais"]],
    ["rôti",1,["rôti"],["fruité"]],
    ["en gratin",0,["gratin","crème"],["rond"]],
    ["en velouté",0,["velouté","soupe"],["rond","souple"]],
    ["farci",1,["farci"],["fruité","souple"]],
    ["poêlé",1,[],["frais"]],
    ["à la vapeur",0,["vapeur"],["léger","frais"]],
    ["en purée",0,["purée"],["rond","souple"]],
  ];
  for (const [n, g, pl] of VEGS)
    for (const [p, a, pkw, pno] of VEG_PREPS)
      add("Aliments", "Légumes", cap(`${n} ${a ? acc(p, g, pl) : p}`),
        ["légume", n.split(" ")[0], ...pkw], ["white","rose","red"], pno);

  // — ŒUFS, TARTES, CHARCUTERIE, SALADES, SOUPES —
  [["Omelette nature",["œuf","omelette"]],["Omelette aux champignons",["œuf","omelette","champignon"]],
   ["Œufs brouillés",["œuf"]],["Œufs cocotte",["œuf","crème"]],["Œufs mimosa",["œuf"]],
   ["Quiche lorraine",["quiche","lard"]],["Quiche aux légumes",["quiche","légume"]],
   ["Tarte à l'oignon",["tarte","oignon"]],["Pissaladière",["oignon","anchois"]],
   ["Soufflé au fromage",["soufflé","fromage"]],["Croque-monsieur",["croque","jambon","fromage"]],
   ["Croque-madame",["croque","œuf"]],
  ].forEach(([n, kw]) => add("Aliments", "Œufs & tartes salées", n, kw, ["white","red"], ["souple","vif"]));

  [["Saucisson sec"],["Jambon de Bayonne"],["Jambon blanc"],["Chorizo"],["Coppa"],["Bresaola"],
   ["Pâté en croûte"],["Terrine de campagne"],["Rillettes"],["Boudin noir"],["Boudin blanc"],
   ["Andouillette"],["Foie gras mi-cuit"],["Jambon serrano"],
  ].forEach(([n]) => add("Aliments", "Charcuterie", n, [n.toLowerCase(), "charcuterie"],
    n.includes("Foie gras") ? ["dessert","white"] : ["red","white","rose"],
    n.includes("Foie gras") ? ["liquoreux","rond"] : ["fruité","vif"]));

  [["Salade César",["salade","poulet","parmesan"]],["Salade de chèvre chaud",["salade","chèvre"]],
   ["Salade périgourdine",["salade","gésier","foie gras"]],["Salade caprese",["tomate","mozzarella"]],
   ["Salade de quinoa",["salade","quinoa"]],["Salade de lentilles",["salade","lentille"]],
   ["Coleslaw",["chou","salade"]],["Salade landaise",["salade","canard"]],
  ].forEach(([n, kw]) => add("Aliments", "Salades", n, kw, ["white","rose"], ["vif","frais"]));

  [["Velouté de potiron",["velouté","potiron"]],["Soupe à l'oignon",["soupe","oignon","gratiné"]],
   ["Soupe de poisson",["soupe","poisson"]],["Velouté de champignons",["velouté","champignon"]],
   ["Soupe miso",["miso","soupe"]],["Gaspacho",["gaspacho","tomate","froid"]],
   ["Velouté d'asperges",["velouté","asperge"]],["Bisque de homard",["bisque","homard"]],
  ].forEach(([n, kw]) => add("Aliments", "Soupes & veloutés", n, kw, ["white"], ["rond","souple"]));

  // — GIBIER —
  [["Chevreuil rôti",["chevreuil","gibier"]],["Civet de sanglier",["sanglier","civet","gibier"]],
   ["Biche en sauce",["biche","gibier","sauce"]],["Faisan rôti",["faisan","gibier"]],
   ["Perdrix aux choux",["perdrix","chou","gibier"]],["Lièvre à la royale",["lièvre","gibier","sauce"]],
   ["Marcassin braisé",["marcassin","gibier","braisé"]],["Pigeon rôti",["pigeon"]],
   ["Caille rôtie",["caille"]],["Terrine de gibier",["gibier","terrine"]],
  ].forEach(([n, kw]) => add("Aliments", "Gibier", n, kw, ["red"], ["puissant","corsé","épicé"]));

  // — FRUITS —
  [["Fraises au sucre",["fraise"]],["Framboises fraîches",["framboise"]],["Salade de fruits frais",["fruits","salade de fruits"]],
   ["Melon",["melon"]],["Melon jambon cru",["melon","jambon"]],["Figues rôties",["figue","rôti"]],
   ["Pêches rôties",["pêche","rôti"]],["Abricots rôtis",["abricot","rôti"]],["Ananas rôti",["ananas","rôti"]],
   ["Pommes au four",["pomme","four"]],["Poires pochées au vin",["poire","poché","vin"]],
   ["Raisin frais",["raisin"]],["Mangue fraîche",["mangue"]],["Agrumes en salade",["agrume","orange","salade"]],
   ["Compote de pommes",["compote","pomme"]],
  ].forEach(([n, kw]) => add("Aliments", "Fruits", n, kw, ["dessert","sparkling","rose"], ["fruité","sucré","frais"]));

  // — APÉRITIF —
  [["Gougères",["gougère","fromage"]],["Verrines apéritives",["verrine"]],["Feuilletés apéritifs",["feuilleté"]],
   ["Olives marinées",["olive"]],["Tapenade",["tapenade","olive"]],["Planche mixte",["planche","charcuterie","fromage"]],
   ["Chips et dips",["chips"]],["Mini-quiches",["quiche"]],["Cake salé",["cake","salé"]],
   ["Bâtonnets de légumes",["légume","crudité"]],
  ].forEach(([n, kw]) => add("Aliments", "Apéritif", n, kw, ["sparkling","white","rose"], ["vif","léger","frais"]));

  // — RECETTES : listes réelles par catégorie —
  const R = (cat, arr, defT, defN) => arr.forEach((e) => {
    const [n, kw, ty, no] = Array.isArray(e) ? e : [e, null, null, null];
    add("Recettes", cat, n, kw || n.toLowerCase().split(/[\s,']+/).filter(w => w.length > 2), ty || defT, no || defN);
  });
  R("Grands classiques français", [
    "Bœuf bourguignon","Coq au vin","Blanquette de veau","Pot-au-feu","Hachis parmentier",
    "Gratin dauphinois","Cassoulet","Choucroute garnie","Tartiflette","Fondue savoyarde",
    "Fondue bourguignonne","Aligot","Truffade","Potée auvergnate","Petit salé aux lentilles",
    "Navarin d'agneau","Daube provençale","Ratatouille","Bouillabaisse","Quenelles de brochet",
    "Baeckeoffe","Flammekueche","Garbure","Poule au pot","Poulet chasseur",
    "Poulet vallée d'Auge","Lapin à la moutarde","Sole meunière","Brandade de morue","Grand aïoli",
    "Moules-frites","Coquilles Saint-Jacques à la bretonne","Œufs en meurette","Salade lyonnaise","Salade niçoise",
    "Steak frites","Entrecôte bordelaise","Magret sauce au poivre","Confit de canard pommes sarladaises","Tête de veau",
    "Paupiettes de veau","Bœuf stroganoff","Tomates farcies","Endives au jambon","Gratin de courgettes",
    "Pieds paquets","Tripes à la mode de Caen","Rognons à la moutarde","Foie de veau persillé","Pain de viande",
  ], ["red"], ["charpenté","fruité"]);
  R("Cuisine italienne", [
    ["Spaghetti carbonara",["carbonara","pâtes","lard"],["white","red"],["rond"]],
    ["Pâtes bolognaise",["bolognaise","pâtes","tomate"],["red"],["fruité"]],
    ["Penne arrabiata",["arrabiata","pâtes","piment"],["red","rose"],["fruité","épicé"]],
    ["Pâtes au pesto",["pesto","pâtes","basilic"],["white"],["vif","aromatique"]],
    ["Cacio e pepe",["pâtes","pecorino","poivre"],["white"],["vif"]],
    ["Pâtes all'amatriciana",["pâtes","tomate","lard"],["red"],["fruité"]],
    ["Spaghetti alle vongole",["pâtes","palourde"],["white"],["minéral","vif"]],
    "Lasagnes","Cannelloni","Raviolis ricotta-épinards",
    ["Gnocchis au gorgonzola",["gnocchi","gorgonzola"],["white","red"],["rond"]],
    "Risotto aux champignons","Risotto milanais","Risotto aux asperges",
    ["Risotto aux fruits de mer",["risotto","fruits de mer"],["white"],["minéral","rond"]],
    "Osso buco","Saltimbocca","Escalope milanaise",
    ["Vitello tonnato",["veau","thon"],["white"],["rond","vif"]],
    "Polenta crémeuse","Pizza margherita","Pizza quattro formaggi","Pizza napolitaine",
    "Pizza calzone","Pizza prosciutto","Pizza végétarienne","Focaccia","Bruschetta",
    "Antipasti","Carpaccio de bœuf",["Burrata tomates",["burrata","tomate"],["white","rose"],["frais"]],
    "Minestrone","Arancini","Panzanella","Involtini","Piccata de veau","Tagliata de bœuf",
  ], ["red","white"], ["fruité","souple"]);
  R("Cuisine asiatique", [
    ["Sushis saumon",["sushi","saumon"],["white","sparkling"],["vif","minéral"]],
    ["Sushis thon",["sushi","thon"],["white","sparkling"],["vif","minéral"]],
    ["Sashimi",["sashimi","cru"],["white","sparkling"],["minéral"]],
    ["Maki variés",["maki","sushi"],["white","sparkling"],["vif"]],
    ["Chirashi",["chirashi","riz","cru"],["white"],["vif","frais"]],
    ["Ramen",["ramen","bouillon","nouilles"],["white"],["souple"]],
    ["Yakitori",["yakitori","brochette"],["red","white"],["fruité"]],
    ["Tempura",["tempura","frit"],["white","sparkling"],["vif","frais"]],
    ["Saumon teriyaki",["teriyaki","saumon"],["white","rose"],["fruité","demi-sec"]],
    ["Gyozas",["gyoza","raviolis"],["white"],["vif"]],
    ["Poke bowl",["poke","cru","riz"],["white","rose"],["frais","vif"]],
    ["Pad thaï",["pad thaï","nouilles","cacahuète"],["white","rose"],["aromatique","demi-sec"]],
    ["Curry vert thaï",["curry","coco","thaï"],["white","rose"],["aromatique","demi-sec"]],
    ["Curry rouge thaï",["curry","coco","thaï"],["white","rose"],["aromatique","demi-sec"]],
    ["Soupe tom yum",["tom yum","citronnelle","épicé"],["white"],["vif","aromatique"]],
    ["Riz sauté à l'ananas",["riz","ananas"],["white","rose"],["fruité"]],
    ["Pho",["pho","bouillon","bœuf"],["white","red"],["souple"]],
    ["Bo bun",["bo bun","bœuf","nouilles"],["white","rose"],["frais","fruité"]],
    ["Nems",["nem","frit"],["white","rose"],["vif","frais"]],
    ["Rouleaux de printemps",["rouleau de printemps","frais"],["white","rose"],["frais","léger"]],
    ["Banh mi",["banh mi","sandwich"],["rose","white"],["frais"]],
    ["Porc au caramel",["porc","caramel"],["red","white"],["fruité","demi-sec"]],
    ["Canard laqué",["canard","laqué"],["red"],["fruité","épicé"]],
    ["Porc aigre-doux",["porc","aigre-doux"],["white","rose"],["fruité","demi-sec"]],
    ["Poulet général Tao",["poulet","frit","épicé"],["white","rose"],["demi-sec","fruité"]],
    ["Nouilles sautées",["nouilles","wok"],["white","red"],["fruité"]],
    ["Riz cantonais",["riz","cantonais"],["white"],["souple"]],
    ["Dim sum",["dim sum","vapeur"],["white","sparkling"],["vif"]],
    ["Mapo tofu",["tofu","épicé"],["white","rose"],["demi-sec"]],
    ["Bœuf aux oignons",["bœuf","oignon","wok"],["red"],["fruité"]],
    ["Crevettes sel et poivre",["crevette","frit"],["white","sparkling"],["vif"]],
    ["Poulet tikka masala",["tikka","curry","poulet"],["white","rose"],["aromatique","demi-sec"]],
    ["Butter chicken",["curry","poulet","crème"],["white","rose"],["rond","demi-sec"]],
    ["Curry d'agneau",["curry","agneau"],["red","rose"],["épicé","fruité"]],
    ["Dahl de lentilles",["dahl","lentille","épices"],["white","rose"],["aromatique"]],
    ["Biryani",["biryani","riz","épices"],["white","rose"],["aromatique","demi-sec"]],
    ["Poulet tandoori",["tandoori","poulet"],["rose","white"],["fruité","épicé"]],
    ["Samoussas",["samoussa","frit","épices"],["white","rose"],["vif","aromatique"]],
    ["Korma",["korma","curry","crème"],["white"],["rond","demi-sec"]],
    ["Bibimbap",["bibimbap","riz","coréen"],["white","rose"],["frais","fruité"]],
    ["Bulgogi",["bulgogi","bœuf","coréen"],["red"],["fruité"]],
    ["Poulet frit coréen",["poulet","frit","coréen"],["white","sparkling"],["vif","frais"]],
  ], ["white","rose"], ["aromatique","frais"]);
  R("Méditerranée & Orient", [
    ["Couscous royal",["couscous","semoule","merguez"],["red","rose"],["épicé","fruité"]],
    ["Couscous poulet",["couscous","poulet"],["rose","red"],["fruité"]],
    ["Couscous végétarien",["couscous","légume"],["rose","white"],["fruité","frais"]],
    ["Tajine d'agneau aux pruneaux",["tajine","agneau","pruneau"],["red"],["épicé","fruité"]],
    ["Tajine de poulet au citron confit",["tajine","poulet","citron"],["white","rose"],["aromatique","vif"]],
    ["Tajine de kefta",["tajine","kefta","bœuf"],["red","rose"],["épicé"]],
    ["Pastilla",["pastilla","volaille","amande"],["white","rose"],["aromatique","demi-sec"]],
    ["Méchoui",["méchoui","agneau"],["red"],["épicé","corsé"]],
    ["Chorba / harira",["chorba","harira","soupe"],["rose","red"],["épicé"]],
    ["Bricks à l'œuf",["brick","œuf","frit"],["white","rose"],["vif"]],
    ["Mezze libanais",["mezze","houmous","taboulé"],["rose","white"],["frais","vif"]],
    ["Falafels",["falafel","pois chiche","frit"],["rose","white"],["frais","vif"]],
    ["Chawarma",["chawarma","kebab"],["rose","red"],["fruité","épicé"]],
    ["Moussaka",["moussaka","aubergine","agneau"],["red"],["fruité","épicé"]],
    ["Gyros",["gyros","porc","grec"],["red","rose"],["fruité"]],
    ["Salade grecque",["salade","feta","olive"],["white","rose"],["frais","vif"]],
    ["Feta rôtie au miel",["feta","miel","rôti"],["white","rose"],["fruité"]],
    ["Dolmas",["dolma","riz","feuille de vigne"],["white","rose"],["frais"]],
    ["Paella valencienne",["paella","riz","poulet"],["rose","red"],["fruité"]],
    ["Paella aux fruits de mer",["paella","fruits de mer"],["rose","white"],["vif","fruité"]],
    ["Tortilla espagnole",["tortilla","œuf","pomme de terre"],["red","rose"],["fruité"]],
    ["Gambas al ajillo",["gambas","ail"],["white"],["vif","aromatique"]],
    ["Patatas bravas",["pomme de terre","épicé"],["red","rose"],["fruité"]],
    ["Pulpo a la gallega",["poulpe","paprika"],["white","rose"],["vif"]],
    ["Pan con tomate",["pain","tomate"],["rose","red"],["frais"]],
  ], ["rose","red"], ["fruité","épicé"]);
  R("Amériques", [
    ["Burger classique",["burger","bœuf"],["red"],["fruité","corsé"]],
    ["Cheeseburger",["burger","fromage"],["red"],["fruité"]],
    ["Bacon burger",["burger","bacon"],["red"],["corsé"]],
    ["Pulled pork",["porc","effiloché","barbecue"],["red"],["fruité","épicé"]],
    ["Ribs barbecue",["ribs","travers","barbecue"],["red"],["corsé","fruité"]],
    ["Brisket fumé",["bœuf","fumé","barbecue"],["red"],["corsé"]],
    ["Hot-dog",["hot-dog","saucisse"],["red","rose"],["fruité"]],
    ["Mac and cheese",["pâtes","fromage"],["white","red"],["rond"]],
    ["Poulet frit",["poulet","frit"],["white","sparkling"],["vif","frais"]],
    ["Wings barbecue",["poulet","barbecue","épicé"],["red","rose"],["fruité","épicé"]],
    ["Chili con carne",["chili","bœuf","haricot","épicé"],["red"],["épicé","fruité"]],
    ["Fajitas de poulet",["fajitas","poulet"],["rose","white"],["fruité","épicé"]],
    ["Fajitas de bœuf",["fajitas","bœuf"],["red","rose"],["fruité","épicé"]],
    ["Tacos al pastor",["tacos","porc"],["red","rose"],["épicé"]],
    ["Tacos de poisson",["tacos","poisson"],["white","rose"],["vif","frais"]],
    ["Burritos",["burrito","haricot"],["red","rose"],["fruité"]],
    ["Quesadillas",["quesadilla","fromage"],["rose","red"],["fruité"]],
    ["Enchiladas",["enchilada","épicé"],["red","rose"],["épicé"]],
    ["Guacamole et nachos",["guacamole","nachos","avocat"],["rose","white"],["frais"]],
    ["Ceviche",["ceviche","poisson","cru","citron"],["white","sparkling"],["vif","minéral"]],
    ["Empanadas",["empanada","viande"],["red","rose"],["fruité"]],
    ["Fish and chips",["poisson","frit"],["white","sparkling"],["vif","frais"]],
  ], ["red"], ["fruité"]);
  R("Europe & montagnes", [
    ["Goulash hongrois",["goulash","bœuf","paprika"],["red"],["épicé","corsé"]],
    ["Wiener schnitzel",["escalope","panée","veau"],["white","red"],["vif"]],
    ["Shepherd's pie",["hachis","agneau"],["red"],["fruité"]],
    ["Irish stew",["ragoût","agneau"],["red"],["corsé"]],
    ["Bortsch",["betterave","soupe"],["red","rose"],["fruité"]],
    ["Pierogi",["raviolis","pomme de terre"],["white"],["souple"]],
    ["Boulettes suédoises",["boulette","crème"],["red","white"],["rond"]],
    ["Raclette au fromage fumé",["raclette","fumé"],["white","red"],["vif"]],
    ["Rösti",["pomme de terre","poêlé"],["white","red"],["souple"]],
    ["Croziflette",["crozets","reblochon"],["white","red"],["vif","fruité"]],
  ], ["red","white"], ["fruité"]);
  R("Afrique & Créole", [
    ["Mafé",["mafé","cacahuète","bœuf"],["red"],["épicé","corsé"]],
    ["Thiéboudienne",["riz","poisson"],["white","rose"],["épicé"]],
    ["Poulet yassa",["yassa","poulet","citron","oignon"],["white","rose"],["vif","aromatique"]],
    ["Colombo de poulet",["colombo","poulet","épices"],["white","rose"],["aromatique","épicé"]],
    ["Rougail saucisse",["rougail","saucisse","épicé"],["red","rose"],["épicé","fruité"]],
    ["Accras de morue",["accras","morue","frit"],["white","sparkling"],["vif","frais"]],
    ["Poulet boucané",["poulet","fumé","créole"],["rose","red"],["épicé","fruité"]],
    ["Gombo",["gombo","ragoût"],["red","rose"],["épicé"]],
  ], ["rose","red"], ["épicé","fruité"]);
  // Desserts : classiques + fruits × préparations
  R("Desserts", [
    ["Fondant au chocolat",["chocolat","fondant"],["dessert","red"],["liquoreux","puissant"]],
    ["Mousse au chocolat",["chocolat","mousse"],["dessert","red"],["liquoreux"]],
    ["Profiteroles",["chocolat","chou","glace"],["dessert"],["liquoreux","sucré"]],
    ["Éclair au chocolat",["chocolat","éclair"],["dessert"],["sucré"]],
    ["Forêt-noire",["chocolat","cerise"],["dessert","red"],["liquoreux","fruité"]],
    ["Brownie",["chocolat","brownie"],["dessert","red"],["liquoreux"]],
    ["Crème brûlée",["crème brûlée","vanille"],["dessert"],["liquoreux","sucré"]],
    ["Crème caramel",["crème","caramel"],["dessert"],["sucré"]],
    ["Île flottante",["île flottante","crème"],["dessert","sparkling"],["sucré","léger"]],
    ["Riz au lait",["riz au lait"],["dessert"],["sucré"]],
    ["Panna cotta",["panna cotta","crème"],["dessert","sparkling"],["sucré","fruité"]],
    ["Flan pâtissier",["flan","vanille"],["dessert"],["sucré"]],
    ["Paris-Brest",["praliné","chou"],["dessert"],["sucré","liquoreux"]],
    ["Mille-feuille",["mille-feuille","crème"],["dessert","sparkling"],["sucré"]],
    ["Saint-Honoré",["chou","crème"],["dessert","sparkling"],["sucré"]],
    ["Opéra",["chocolat","café"],["dessert"],["liquoreux","puissant"]],
    ["Fraisier",["fraise","crème"],["dessert","sparkling"],["fruité","sucré"]],
    ["Baba au rhum",["baba","rhum"],["dessert"],["liquoreux","puissant"]],
    ["Kouign-amann",["beurre","caramel"],["dessert"],["sucré","liquoreux"]],
    ["Canelés",["canelé","rhum","vanille"],["dessert"],["sucré"]],
    ["Macarons",["macaron"],["dessert","sparkling"],["sucré","fruité"]],
    ["Tiramisu",["tiramisu","café","mascarpone"],["dessert"],["liquoreux","sucré"]],
    ["Cheesecake",["cheesecake","fromage frais"],["dessert","sparkling"],["sucré","fruité"]],
    ["Pavlova",["pavlova","meringue","fruits"],["dessert","sparkling"],["fruité","léger"]],
    ["Crêpes Suzette",["crêpe","orange","flambé"],["dessert"],["fruité","liquoreux"]],
    ["Gaufres chantilly",["gaufre","chantilly"],["dessert","sparkling"],["sucré"]],
    ["Churros",["churros","frit","sucre"],["dessert"],["sucré"]],
    ["Pain perdu",["pain perdu","caramel"],["dessert"],["sucré"]],
    ["Galette des rois",["frangipane","amande"],["dessert","sparkling"],["sucré"]],
    ["Mont-Blanc",["marron","meringue"],["dessert"],["sucré","liquoreux"]],
    ["Nougat glacé",["nougat","glacé","miel"],["dessert"],["sucré"]],
    ["Pêche Melba",["pêche","glace","framboise"],["dessert","sparkling"],["fruité"]],
    ["Poire Belle-Hélène",["poire","chocolat"],["dessert"],["fruité","liquoreux"]],
  ], ["dessert"], ["sucré"]);
  const FRUITS = ["pommes","poires","abricots","cerises","fraises","framboises","mirabelles","pêches","rhubarbe","citron"];
  for (const f of FRUITS) {
    add("Recettes", "Desserts", cap(`tarte aux ${f}`), ["tarte", f], ["dessert","sparkling"], ["fruité","sucré"]);
    add("Recettes", "Desserts", cap(`clafoutis aux ${f}`), ["clafoutis", f], ["dessert"], ["fruité","sucré"]);
    add("Recettes", "Desserts", cap(`crumble aux ${f}`), ["crumble", f], ["dessert"], ["fruité","sucré"]);
  }
  // Desserts glacés
  [["Glace vanille",["glace","vanille"]],["Glace chocolat",["glace","chocolat"]],
   ["Sorbet citron",["sorbet","citron"]],["Sorbet framboise",["sorbet","framboise"]],
   ["Banana split",["banane","glace","chocolat"]],["Coupe glacée",["glace","chantilly"]],
   ["Café gourmand",["café","mignardise"]],["Omelette norvégienne",["glace","meringue","flambé"]],
  ].forEach(([n, kw]) => add("Recettes", "Desserts", n, kw, ["dessert","sparkling"], ["sucré","fruité"]));
  // Déclinaisons transversales (curry / wok / brochettes / risotto / tajine de X)
  const DECL = [
    ["Curry de", ["crevettes","légumes","poisson","bœuf","porc"], ["curry"], ["white","rose"], ["aromatique","demi-sec"]],
    ["Wok de",   ["bœuf","poulet","crevettes","légumes","canard"], ["wok"], ["white","rose"], ["fruité","frais"]],
    ["Brochettes de", ["bœuf","poulet","agneau","crevettes","légumes","canard"], ["brochette","grillade"], ["red","rose"], ["fruité"]],
    ["Risotto aux", ["asperges vertes","cèpes","truffes","courgettes","crevettes","poireaux"], ["risotto"], ["white"], ["rond"]],
    ["Tajine de", ["légumes","bœuf","canard"], ["tajine"], ["red","rose"], ["épicé","fruité"]],
  ];
  for (const [pre, items, kw, ty, no] of DECL)
    for (const it of items)
      add("Recettes", "Déclinaisons du monde", `${pre} ${it}`, [...kw, it.split(" ")[0]], ty, no);
  // Street food & brunch
  R("Street food & brunch", [
    ["Club sandwich",["sandwich","poulet"],["white","rose"],["frais"]],
    ["Panini",["panini","fromage"],["red","rose"],["fruité"]],
    ["Wrap au poulet",["wrap","poulet"],["white","rose"],["frais"]],
    ["Bagel au saumon",["bagel","saumon"],["white","sparkling"],["vif","frais"]],
    ["Burger végétarien",["burger","végétarien"],["rose","red"],["fruité"]],
    ["Œufs Bénédicte",["œuf","hollandaise"],["white","sparkling"],["rond","vif"]],
    ["Pancakes au sirop d'érable",["pancake","sirop"],["dessert","sparkling"],["sucré"]],
    ["Avocado toast",["avocat","toast"],["white","sparkling"],["frais","vif"]],
    ["Granola et fruits",["granola","fruits","yaourt"],["sparkling","dessert"],["fruité","léger"]],
    ["Pan bagnat",["pan bagnat","thon"],["rose","white"],["frais"]],
  ], ["white","rose"], ["frais"]);
  // Occasions
  R("Occasions", [
    ["Apéritif dînatoire",["apéritif","tapas","amuse-bouche"],["sparkling","white","rose"],["vif","léger","frais"]],
    ["Brunch du dimanche",["brunch","œuf","viennoiserie"],["sparkling","white"],["léger","fruité"]],
    ["Pique-nique",["pique-nique","sandwich","salade"],["rose","white"],["frais","léger"]],
    ["Barbecue entre amis",["barbecue","grillade"],["red","rose"],["fruité","épicé"]],
    ["Dîner romantique",["gastronomique"],["sparkling","red"],["élégant","fruité"]],
    ["Repas de fête",["fête","festif","foie gras"],["sparkling","dessert","red"],["élégant","liquoreux"]],
    ["Réveillon",["réveillon","huître","foie gras"],["sparkling","white","dessert"],["élégant","minéral"]],
    ["Plateau télé",["plateau","fromage","charcuterie"],["red","white"],["fruité","souple"]],
    ["Raclette party",["raclette","fromage"],["white","red"],["vif","fruité"]],
    ["Soirée pizza",["pizza"],["red","rose"],["fruité","souple"]],
  ], ["sparkling","white"], ["vif","frais"]);

  // — Fusion de la bibliothèque manuelle (soignée), sans doublons —
  // Les anciennes catégories proches sont fusionnées dans les nouvelles.
  const CAT_MAP = { "Porc & charcuterie": "Porc", "Apéritif & entrées": "Apéritif", "Végétarien & légumes": "Légumes" };
  for (const [fam, cats] of Object.entries(FOOD_LIBRARY_BASE))
    for (const [cat, dishes] of Object.entries(cats))
      for (const [name, prof] of Object.entries(dishes)) {
        const tFam = (fam === "Aliments" && cat === "Desserts") ? "Recettes" : fam;
        add(tFam, CAT_MAP[cat] || cat, name, prof.kw, prof.types, prof.notes);
      }

  // — Tri alphabétique (fr) : catégories puis plats ; familles en ordre fixe —
  const sorted = {};
  for (const fam of Object.keys(L)) {
    sorted[fam] = {};
    for (const cat of Object.keys(L[fam]).sort((a, b) => a.localeCompare(b, "fr"))) {
      sorted[fam][cat] = {};
      for (const name of Object.keys(L[fam][cat]).sort((a, b) => a.localeCompare(b, "fr")))
        sorted[fam][cat][name] = L[fam][cat][name];
    }
  }
  return sorted;
})();
// Nombre total de plats référencés (affiché dans l'onglet Accords)
const FOOD_COUNT = Object.values(FOOD_LIBRARY)
  .reduce((a, cats) => a + Object.values(cats).reduce((b, d) => b + Object.keys(d).length, 0), 0);
// Messages d'erreur affichés à l'utilisateur selon le code retourné par le backend
const ERROR_MESSAGES = {
  quota_exceeded:      "⚠️ Quota Gemini dépassé (1 500/jour). Les résultats viennent d'Open Food Facts — ajoutez votre clé demain ou vérifiez votre quota sur aistudio.google.com.",
  invalid_key:         "🔑 Clé Gemini invalide ou expirée. Allez dans Paramètres → Appareils → Millésime → ⚙️ pour la mettre à jour.",
  service_unavailable: "🔄 Gemini temporairement indisponible. Les résultats viennent d'Open Food Facts.",
  parse_error:         "⚠️ Réponse Gemini inattendue. Réessayez ou remplissez manuellement.",
  // v7.1.5 : deux causes qui se cachaient derrière « service indisponible »
  no_model:            "🚫 Votre clé Gemini n'a accès à aucun modèle compatible. Vérifiez votre projet sur aistudio.google.com (l'API Generative Language doit être activée).",
  timeout:             "⏱️ Gemini a mis trop de temps à répondre. Réessayez — si cela persiste, réduisez la taille de la demande.",
  truncated:           "✂️ Réponse Gemini incomplète (trop longue). Réessayez, ou simplifiez la demande (moins de plats, description plus courte).",
  no_key:              "ℹ️ Résultats Open Food Facts. Configurez une clé Gemini pour obtenir notes de dégustation et accords mets-vins.",
  no_wine_found:       "📷 Aucune étiquette de vin reconnue. Assurez-vous que l'étiquette est nette et bien éclairée.",
};

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = url => /^https?:\/\//i.test(url ?? "") ? url : "#";
// Profils de bouteilles [rayon, hauteur] — SOURCE UNIQUE des deux vues : la 3D
// les tourne (LatheGeometry), la 2D les projette à plat (silhouette SVG).
// ── v7.1.0 : PROFILS RECALCULÉS SUR DIMENSIONS RÉELLES 75 cl ─────────────────
// Tables sources en MILLIMÈTRES (cotes CETIE/verriers), converties en unités de
// scène via K_MM. Fini le gabarit unique : chaque forme a désormais SON rayon
// et SA longueur — une flûte d'Alsace (360×⌀60, ratio 6:1) est réellement plus
// longue et plus fine qu'une champenoise (310×⌀88). L'entraxe des emplacements
// (SPACING) reste inchangé : la plus large (champenoise, 2r = 0,99) tient dans
// les 1,06 unités avec du jour.
const K_MM = 0.0113;                       // unités de scène par millimètre
const BOTTLE_MM = {
  // Bordelaise 300×⌀75 — fût droit ~62 %, épaule haute et courte (galbe validé)
  bordeaux: { H: 300, D: 75, pts: [[10,0], [2,19.3], [4,26], [7,31.7], [11,34.7], [15,36.3], [22,37.4], [46,37.5], [70,37.3], [94,37.5], [118,37.3], [142,37.5], [166,37.5], [168,37.5], [171,37.5], [174,37.5], [177,37.5], [180,37.1], [183,36.8], [186,36.2], [189,35.3], [192,34.3], [195,33], [198,31.3], [201,29.3], [204,27.1], [207,24.4], [210,21.5], [213,19], [216,17.4], [219,16.1], [222,15.4], [225,15.2], [228,15], [236,14.8], [244,14.6], [252,14.4], [262,13.8], [272,13.8], [280,13.6], [285,14.8], [289,14.8], [293,13.7], [296,13.5], [298,12.1], [300,0]] },
  // Bourguignonne 295×⌀80 — SANS épaule : fût conique, longue pente fuyante
  bourgogne: { H: 295, D: 80, pts: [[12,0], [0,24], [4,36], [9,39.5], [14,40], [130,40], [134,39.9], [138,39.8], [141,39.6], [145,39.5], [149,39.3], [153,39.1], [157,38.9], [160,38.7], [164,38.4], [168,38.2], [173,38], [177,37.5], [182,36.6], [187,35.5], [191,34.1], [196,32.4], [201,30.6], [205,28.6], [210,26.6], [215,24.6], [219,22.6], [224,20.8], [229,19.1], [233,17.7], [238,16.6], [243,15.7], [247,15.2], [252,15], [280,14.5], [285,14.3], [288,15.5], [293,15.5], [295,14.5], [295,0]] },
  // Champenoise 310×⌀88 — verre épais, piqûre profonde, pente très longue
  champagne: { H: 310, D: 88, pts: [[22,0], [0,27], [5,40], [11,43.5], [17,44], [140,44], [146,43.8], [152,43.3], [158,42.5], [164,41.4], [170,40], [175,38.4], [181,36.6], [187,34.7], [193,32.6], [199,30.5], [205,28.4], [211,26.3], [217,24.4], [223,22.6], [228,21], [234,19.6], [240,18.5], [246,17.7], [252,17.2], [258,17], [288,16.5], [293,16.5], [296,18.8], [303,19.2], [308,18.4], [310,13.5], [310,0]] },
  // Flûte d'Alsace 360×⌀60 — ratio 6:1, col et fût qui se confondent
  flute: { H: 360, D: 60, pts: [[8,0], [0,18], [4,27], [8,29.5], [12,30], [150,30], [158,29.9], [165,29.6], [172,29.1], [180,28.5], [188,27.6], [195,26.7], [202,25.6], [210,24.4], [218,23.2], [225,21.9], [232,20.6], [240,19.4], [248,18.2], [255,17.1], [262,16.2], [270,15.3], [278,14.7], [285,14.2], [292,13.9], [300,13.8], [344,13.2], [349,13], [352,14.2], [357,14.2], [360,13.3], [360,0]] },
  // Ligérienne 310×⌀73 — élancée, épaule douce intermédiaire
  loire: { H: 310, D: 73, pts: [[10,0], [0,22], [4,32], [8,35.8], [12,36.5], [170,36.5], [174,36.3], [178,35.7], [182,34.7], [186,33.3], [189,31.7], [193,29.8], [197,27.8], [201,25.7], [205,23.5], [209,21.5], [213,19.6], [216,18], [220,16.6], [224,15.6], [228,15], [232,14.8], [290,14.3], [295,14.1], [298,15.3], [305,15.3], [308,14.4], [310,14.2], [310,0]] },
  // Provençale (rosé) 300×⌀72 — fine, col allongé
  rose: { H: 300, D: 72, pts: [[9,0], [0,21], [4,31], [8,35.2], [12,36], [160,36], [164,35.7], [167,34.9], [171,33.6], [175,31.9], [179,29.8], [182,27.5], [186,25.1], [190,22.7], [193,20.4], [197,18.3], [201,16.6], [205,15.3], [208,14.5], [212,14.2], [282,13.6], [287,13.4], [290,14.6], [296,14.6], [300,13.7], [300,0]] },
};

// Métadonnées en unités de scène, calculées une fois : rayon de pose (r),
// hauteur (h), demi-longueur (half) — utilisées PARTOUT (3D, 2D, fantômes,
// positionnement, pyramide) : source unique, zéro littéral à désynchroniser.
const BOTTLE_METAS = {};
const BOTTLE_PROFILES = {};   // profils en unités [rayon, hauteur] (points du Lathe)
for (const [kind, m] of Object.entries(BOTTLE_MM)) {
  BOTTLE_PROFILES[kind] = m.pts.map(([h, r]) => [+(r * K_MM).toFixed(4), +(h * K_MM).toFixed(4)]);
  BOTTLE_METAS[kind] = {
    r:    +((m.D / 2) * K_MM).toFixed(4),
    h:    +(m.H * K_MM).toFixed(4),
    half: +((m.H * K_MM) / 2).toFixed(4),
  };
}
// Rayon de la bordelaise = référence historique (pose, pyramide, fantômes)
const BOTTLE_R = BOTTLE_METAS.bordeaux.r;
// Les profils sont DÉJÀ en unités réelles : plus aucune re-normalisation
// radiale (c'était le gabarit unique d'avant v7.1.0) — passe-plat conservé
// pour ne pas toucher les appelants.
const _normProfile = (pts) => pts;

// v7.0.2 : bordelaise par DÉFAUT pour rouges et blancs — c'est la forme la plus
// répandue et celle attendue dans une cave à dominante bordelaise. Les autres
// silhouettes restent choisies par la fiche (champ shape, détecté par Gemini ou
// manuel) ou déduites de la RÉGION via shapeKindOf ci-dessous.
const TYPE_SHAPE = { red: "bordeaux", white: "bordeaux", rose: "rose", sparkling: "champagne", dessert: "loire" };

// Déduction de la silhouette par région (v7.0.2) — appliquée UNIQUEMENT quand la
// fiche ne précise pas de forme : un bourgogne reste bourguignon, un alsace en
// flûte, un sauternes en bordelaise… Testée sur le champ region normalisé
// (minuscules sans accents). Source unique pour la 3D ET la 2D.
const REGION_SHAPES = [
  [/bourgogne|beaujolais|chablis|macon|mercurey|pommard|meursault|volnay|gevrey|nuits|beaune|rhone|chateauneuf|gigondas|vacqueyras|hermitage|cote.?rotie|cornas|crozes|saint.?joseph|condrieu/, "bourgogne"],
  [/alsace|riesling|gewurz/, "flute"],
  [/sauternes|barsac|monbazillac|loupiac|cadillac|sainte.?croix/, "bordeaux"],
  [/champagne|cremant|prosecco|cava|bulle/, "champagne"],
];
const shapeKindOf = (wine) => {
  if (wine?.shape && BOTTLE_PROFILES[wine.shape]) return wine.shape;   // choix explicite de la fiche
  if ((wine?.type || "red") === "sparkling") return "champagne";       // verre épais obligatoire
  const reg = normKey(wine?.region || "") + " " + normKey(wine?.appellation || "");
  if (reg.trim()) for (const [re, kind] of REGION_SHAPES) if (re.test(reg)) return kind;
  return TYPE_SHAPE[wine?.type || "red"] || "bordeaux";
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

// Formats les plus courants : [valeur stockée, libellé affiché]
const BOTTLE_SIZES = [
  ["37.5cl", "Demi / Fillette — 37,5 cl"],
  ["75cl",   "Bouteille — 75 cl"],
  ["150cl",  "Magnum — 150 cl"],
  ["300cl",  "Jéroboam — 300 cl"],
  ["450cl",  "Réhoboam — 450 cl"],
  ["600cl",  "Mathusalem — 600 cl"],
];
// Formes de bouteille manuelles : [clé profil, libellé]
const BOTTLE_SHAPE_LABELS = [
  ["bordeaux",  "Bordelaise (épaules marquées)"],
  ["bourgogne", "Bourguignonne (épaules tombantes)"],
  ["champagne", "Champenoise (base large)"],
  ["flute",     "Flûte d'Alsace (fine et haute)"],
  ["rose",      "Provence / rosé"],
  ["loire",     "Ligérienne (Loire)"],
];
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
const BOTTLE_MINI = (color, w = null, type = "red", flipped = false, size = null, shapeOverride = "") => {
  const sp = BOTTLE_SHAPES[(shapeOverride && BOTTLE_SHAPES[shapeOverride]) ? shapeOverride : (TYPE_SHAPE[type] || "bordeaux")];
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
  return `<svg class="dot-svg-b" viewBox="0 0 10 26" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet" style="${w ? `width:${w}px;height:${Math.round(w * 2.6)}px` : 'width:100%;height:auto'};display:block;${tf}">
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

// Icône tire-bouchon colorée (manche bois + spirale métal) pour le bouton « À ouvrir »

// ── Référentiel viticole mondial (v7.1.9) ────────────────────────────────────
// POURQUOI : les champs Région et Pays étaient invisibles (type="hidden") et
// remplis uniquement par l'IA. Quand le scan échouait, l'utilisateur ne pouvait
// RIEN saisir — c'est le blocage remonté par la communauté. Ces champs sont
// désormais visibles, et ce référentiel normalise la saisie : une orthographe
// unique par région évite les doublons et donne à Gemini un contexte fiable.
// Hiérarchie PAYS → RÉGION → APPELLATION : chaque liste est filtrée par le
// niveau supérieur, donc l'utilisateur voit 15 à 40 propositions pertinentes
// au lieu de 765. La saisie libre reste toujours possible.
// ── Référentiel viticole mondial (v7.1.9) ────────────────────────────────────
// Pays → régions → appellations. Sert à NORMALISER la saisie : une orthographe
// stable aide Gemini à identifier le bon vin et évite les doublons de région
// signalés par la communauté. La saisie reste TOUJOURS libre (datalist, jamais
// select) : une appellation absente peut être tapée telle quelle.
// 16 pays · 140 régions · 1158 appellations · 277 cépages
// SOURCE UNIQUE : ne jamais réintroduire de seconde liste en parallèle, sous
// peine de divergences (une même région classée différemment selon la liste).
const WINE_WORLD = {"France":{"Bordeaux":["Bordeaux","Bordeaux Supérieur","Médoc","Haut-Médoc","Pauillac","Margaux","Saint-Julien","Saint-Estèphe","Listrac-Médoc","Moulis-en-Médoc","Pessac-Léognan","Graves","Graves Supérieures","Saint-Émilion","Saint-Émilion Grand Cru","Pomerol","Lalande-de-Pomerol","Fronsac","Canon-Fronsac","Castillon Côtes de Bordeaux","Francs Côtes de Bordeaux","Blaye Côtes de Bordeaux","Côtes de Bourg","Cadillac Côtes de Bordeaux","Entre-Deux-Mers","Sauternes","Barsac","Loupiac","Sainte-Croix-du-Mont","Cérons","Cadillac","Crémant de Bordeaux","Montagne-Saint-Émilion","Lussac-Saint-Émilion","Puisseguin-Saint-Émilion","Saint-Georges-Saint-Émilion","Sainte-Foy Côtes de Bordeaux","Bordeaux Clairet","Bordeaux Rosé","Graves de Vayres","Premières Côtes de Bordeaux","Sainte-Foy-Bordeaux"],"Bourgogne":["Bourgogne","Bourgogne Aligoté","Bourgogne Passe-Tout-Grains","Coteaux Bourguignons","Chablis","Petit Chablis","Chablis Premier Cru","Chablis Grand Cru","Irancy","Saint-Bris","Marsannay","Fixin","Gevrey-Chambertin","Chambertin","Chambertin-Clos de Bèze","Morey-Saint-Denis","Clos de la Roche","Clos de Tart","Chambolle-Musigny","Musigny","Bonnes-Mares","Vougeot","Clos de Vougeot","Vosne-Romanée","Romanée-Conti","La Tâche","Richebourg","Échézeaux","Grands Échézeaux","Nuits-Saint-Georges","Ladoix","Aloxe-Corton","Corton","Corton-Charlemagne","Pernand-Vergelesses","Savigny-lès-Beaune","Chorey-lès-Beaune","Beaune","Pommard","Volnay","Monthélie","Auxey-Duresses","Saint-Romain","Meursault","Puligny-Montrachet","Chassagne-Montrachet","Montrachet","Bâtard-Montrachet","Saint-Aubin","Santenay","Maranges","Rully","Mercurey","Givry","Montagny","Bouzeron","Mâcon","Mâcon-Villages","Pouilly-Fuissé","Pouilly-Loché","Pouilly-Vinzelles","Saint-Véran","Viré-Clessé","Crémant de Bourgogne","Bourgogne Côte d'Or","Bourgogne Hautes Côtes de Beaune","Bourgogne Hautes Côtes de Nuits","Bourgogne Chitry","Bourgogne Épineuil","Bourgogne Tonnerre","Bourgogne Côte Chalonnaise","Latricières-Chambertin","Mazis-Chambertin","Charmes-Chambertin","Griotte-Chambertin","Ruchottes-Chambertin","Chapelle-Chambertin","Mazoyères-Chambertin","Clos Saint-Denis","Clos des Lambrays","Romanée-Saint-Vivant","La Grande Rue","Chevalier-Montrachet","Bienvenues-Bâtard-Montrachet","Criots-Bâtard-Montrachet","Charlemagne","Blagny","Pernand-Vergelesses Île des Vergelesses"],"Beaujolais":["Beaujolais","Beaujolais-Villages","Brouilly","Côte de Brouilly","Chénas","Chiroubles","Fleurie","Juliénas","Morgon","Moulin-à-Vent","Régnié","Saint-Amour"],"Vallée du Rhône":["Côtes du Rhône","Côtes du Rhône Villages","Côte-Rôtie","Condrieu","Château-Grillet","Saint-Joseph","Crozes-Hermitage","Hermitage","Cornas","Saint-Péray","Châteauneuf-du-Pape","Gigondas","Vacqueyras","Vinsobres","Beaumes-de-Venise","Rasteau","Cairanne","Lirac","Tavel","Costières de Nîmes","Ventoux","Luberon","Grignan-les-Adhémar","Clairette de Die","Crémant de Die","Saint-Maurice","Muscat de Beaumes-de-Venise","Duché d'Uzès","Côtes du Vivarais","Laudun","Plan de Dieu","Signargues","Sablet","Séguret","Valréas","Visan","Chusclan","Massif d'Uchaux","Roaix"],"Provence":["Côtes de Provence","Côtes de Provence Sainte-Victoire","Côtes de Provence Fréjus","Côtes de Provence La Londe","Coteaux d'Aix-en-Provence","Coteaux Varois en Provence","Les Baux-de-Provence","Bandol","Cassis","Bellet","Palette","Pierrevert","Côtes de Provence Notre-Dame des Anges","Côtes de Provence Pierrefeu"],"Languedoc":["Languedoc","Corbières","Corbières-Boutenac","Minervois","Minervois La Livinière","Fitou","Faugères","Saint-Chinian","Picpoul de Pinet","Pic Saint-Loup","La Clape","Terrasses du Larzac","Limoux","Blanquette de Limoux","Crémant de Limoux","Cabardès","Malepère","Clairette du Languedoc","Muscat de Frontignan","Muscat de Lunel","Maury","Banyuls","Collioure","Côtes du Roussillon","Côtes du Roussillon Villages","Rivesaltes","Muscat de Rivesaltes","Grès de Montpellier","Pézenas","Sommières","Quatourze","Saint-Georges-d'Orques","Cabrières","Montpeyroux","Saint-Saturnin","Saint-Drézéry","Vérargues","Saint-Christol","Maury Sec","Côtes du Roussillon Les Aspres","Muscat de Mireval","Muscat de Saint-Jean-de-Minervois"],"Vallée de la Loire":["Muscadet","Muscadet Sèvre et Maine","Muscadet Côtes de Grandlieu","Gros Plant du Pays Nantais","Anjou","Anjou-Villages","Savennières","Coteaux du Layon","Chaume","Quarts de Chaume","Bonnezeaux","Saumur","Saumur-Champigny","Crémant de Loire","Coteaux de Saumur","Touraine","Vouvray","Montlouis-sur-Loire","Chinon","Bourgueil","Saint-Nicolas-de-Bourgueil","Cheverny","Cour-Cheverny","Valençay","Sancerre","Pouilly-Fumé","Pouilly-sur-Loire","Menetou-Salon","Quincy","Reuilly","Coteaux du Giennois","Rosé d'Anjou","Cabernet d'Anjou","Rosé de Loire","Jasnières","Coteaux du Vendômois","Saint-Pourçain","Coteaux de l'Aubance","Anjou Coteaux de la Loire","Savennières Roche aux Moines","Savennières Coulée de Serrant","Saumur Puy-Notre-Dame","Haut-Poitou","Châteaumeillant","Orléans","Orléans-Cléry","Coteaux du Loir","Fiefs Vendéens","Touraine-Amboise","Touraine-Mesland","Touraine-Azay-le-Rideau","Touraine-Chenonceaux","Touraine-Oisly","Touraine Noble Joué","Côte Roannaise","Côtes du Forez"],"Alsace":["Alsace","Alsace Grand Cru","Crémant d'Alsace","Alsace Riesling","Alsace Gewurztraminer","Alsace Pinot Gris","Alsace Pinot Noir","Alsace Muscat","Alsace Sylvaner","Alsace Pinot Blanc","Alsace Edelzwicker"],"Champagne":["Champagne","Coteaux Champenois","Rosé des Riceys","Champagne Grand Cru","Champagne Premier Cru","Champagne Blanc de Blancs","Champagne Blanc de Noirs","Champagne Rosé"],"Sud-Ouest":["Cahors","Madiran","Pacherenc du Vic-Bilh","Jurançon","Jurançon Sec","Irouléguy","Gaillac","Fronton","Bergerac","Côtes de Bergerac","Monbazillac","Pécharmant","Saussignac","Montravel","Buzet","Marcillac","Côtes de Duras","Côtes du Marmandais","Saint-Mont","Tursan","Béarn","Brulhois","Estaing","Entraygues-Le Fel","Coteaux du Quercy","Côtes de Millau","Rosette","Côtes de Montravel","Haut-Montravel","Floc de Gascogne","Béarn-Bellocq","Vins de Lavilledieu"],"Jura":["Côtes du Jura","Arbois","Château-Chalon","L'Étoile","Crémant du Jura","Macvin du Jura"],"Savoie":["Vin de Savoie","Roussette de Savoie","Seyssel","Crémant de Savoie","Bugey","Roussette du Bugey"],"Corse":["Vin de Corse","Patrimonio","Ajaccio","Vin de Corse Figari","Vin de Corse Porto-Vecchio","Vin de Corse Calvi","Vin de Corse Sartène","Muscat du Cap Corse"],"Lorraine":["Côtes de Toul","Moselle"],"Roussillon":["Banyuls","Banyuls Grand Cru","Collioure","Côtes du Roussillon","Côtes du Roussillon Villages","Maury","Muscat de Rivesaltes","Rivesaltes"]},"Italie":{"Toscane":["Chianti","Chianti Classico","Brunello di Montalcino","Rosso di Montalcino","Vino Nobile di Montepulciano","Rosso di Montepulciano","Bolgheri","Bolgheri Sassicaia","Carmignano","Vernaccia di San Gimignano","Morellino di Scansano","Maremma Toscana","Toscana IGT","Vin Santo del Chianti Classico","Chianti Rufina","Chianti Colli Senesi","Chianti Colli Fiorentini","Montecucco","Suvereto","Val di Cornia","Cortona","Terre di Pisa","Colli dell'Etruria Centrale","Elba Aleatico Passito"],"Piémont":["Barolo","Barbaresco","Barbera d'Alba","Barbera d'Asti","Dolcetto d'Alba","Langhe","Roero","Nebbiolo d'Alba","Gavi","Moscato d'Asti","Asti","Brachetto d'Acqui","Alta Langa","Grignolino d'Asti","Ruché di Castagnole Monferrato","Barbera del Monferrato","Dogliani","Diano d'Alba","Verduno Pelaverga","Colli Tortonesi","Cortese dell'Alto Monferrato","Nizza","Terre Alfieri","Gattinara","Ghemme","Boca","Bramaterra","Lessona","Carema","Dolcetto di Dogliani","Monferrato","Ruchè di Castagnole Monferrato"],"Vénétie":["Amarone della Valpolicella","Valpolicella","Valpolicella Ripasso","Recioto della Valpolicella","Soave","Soave Classico","Bardolino","Prosecco","Conegliano Valdobbiadene Prosecco","Asolo Prosecco","Lugana","Bianco di Custoza","Lessini Durello","Amarone della Valpolicella Classico","Valpolicella Classico","Soave Superiore","Gambellara","Breganze","Colli Euganei","Bagnoli","Piave","Arcole","Prosecco di Conegliano-Valdobbiadene","Recioto di Soave"],"Frioul-Vénétie Julienne":["Collio","Colli Orientali del Friuli","Friuli Grave","Friuli Isonzo","Ramandolo","Carso"],"Trentin-Haut-Adige":["Alto Adige","Trentino","Teroldego Rotaliano","Lago di Caldaro","Trento DOC"],"Lombardie":["Franciacorta","Oltrepò Pavese","Valtellina Superiore","Sforzato di Valtellina","Lugana"],"Émilie-Romagne":["Lambrusco di Sorbara","Lambrusco Grasparossa di Castelvetro","Sangiovese di Romagna","Albana di Romagna","Colli Bolognesi"],"Ombrie":["Orvieto","Sagrantino di Montefalco","Montefalco Rosso","Torgiano","Montefalco Sagrantino","Colli del Trasimeno","Colli Perugini","Assisi"],"Marches":["Verdicchio dei Castelli di Jesi","Verdicchio di Matelica","Rosso Conero","Rosso Piceno","Offida"],"Abruzzes":["Montepulciano d'Abruzzo","Trebbiano d'Abruzzo","Cerasuolo d'Abruzzo"],"Latium":["Frascati","Est! Est!! Est!!! di Montefiascone","Cesanese del Piglio"],"Campanie":["Taurasi","Fiano di Avellino","Greco di Tufo","Falanghina del Sannio","Aglianico del Taburno","Lacryma Christi del Vesuvio","Vesuvio","Costa d'Amalfi","Cilento","Irpinia","Sannio"],"Pouilles":["Primitivo di Manduria","Salice Salentino","Castel del Monte","Negroamaro","Locorotondo","Gioia del Colle","Primitivo di Manduria Dolce Naturale","Copertino","Brindisi","Squinzano","Nardò","Leverano","Manduria"],"Sicile":["Etna","Nero d'Avola","Cerasuolo di Vittoria","Marsala","Passito di Pantelleria","Sicilia DOC","Faro","Etna Rosso","Etna Bianco","Etna Rosato","Vittoria","Noto","Menfi","Contea di Sclafani","Alcamo","Erice"],"Sardaigne":["Vermentino di Gallura","Cannonau di Sardegna","Carignano del Sulcis","Vermentino di Sardegna","Turriga"],"Basilicate":["Aglianico del Vulture"],"Ligurie":["Cinque Terre","Rossese di Dolceacqua"],"Calabre":["Cirò"],"Frioul":["Carso","Colli Orientali del Friuli","Collio","Friuli Grave","Friuli Isonzo"]},"Espagne":{"Rioja":["Rioja","Rioja Alta","Rioja Alavesa","Rioja Oriental"],"Castille-et-León":["Ribera del Duero","Rueda","Toro","Bierzo","Cigales","Arribes","Tierra de León","Sierra de Salamanca","Valles de Benavente","Valtiendas"],"Catalogne":["Priorat","Montsant","Penedès","Cava","Terra Alta","Costers del Segre","Empordà","Conca de Barberà","Alella","Pla de Bages","Tarragona","Cava de Paraje Calificado","Corpinnat","Clàssic Penedès"],"Galice":["Rías Baixas","Ribeiro","Ribeira Sacra","Valdeorras","Monterrei"],"Andalousie":["Jerez-Xérès-Sherry","Manzanilla-Sanlúcar de Barrameda","Montilla-Moriles","Málaga","Sierras de Málaga","Condado de Huelva","Jerez Fino","Jerez Amontillado","Jerez Oloroso","Jerez Palo Cortado","Jerez Pedro Ximénez","Jerez Cream"],"Aragon":["Cariñena","Campo de Borja","Calatayud","Somontano"],"Navarre":["Navarra"],"Castille-La Manche":["La Mancha","Valdepeñas","Méntrida","Manchuela","Almansa"],"Communauté valencienne":["Valencia","Utiel-Requena","Alicante","Clariano","Terrazas de Contiendas"],"Murcie":["Jumilla","Yecla","Bullas"],"Canaries":["Lanzarote","Tacoronte-Acentejo","Ycoden-Daute-Isora"],"Baléares":["Binissalem","Pla i Llevant"],"Pays basque":["Txakoli de Getaria","Txakoli de Bizkaia","Txakoli de Álava"],"Madrid":["Vinos de Madrid","Arganda","Navalcarnero","San Martín de Valdeiglesias"],"Estrémadure":["Ribera del Guadiana"],"Levant":["Alicante","Bullas","Jumilla","Utiel-Requena","Valencia","Yecla"],"Îles Canaries":["Lanzarote","Tacoronte-Acentejo","Ycoden-Daute-Isora"],"Îles Baléares":["Binissalem","Pla i Llevant"]},"Portugal":{"Douro":["Douro","Porto","Porto Vintage","Porto Tawny","Porto LBV"],"Alentejo":["Alentejo","Alentejano","Borba","Reguengos","Vidigueira","Redondo"],"Vinho Verde":["Vinho Verde","Monção e Melgaço","Alvarinho de Monção e Melgaço"],"Dão":["Dão"],"Bairrada":["Bairrada"],"Lisbonne":["Bucelas","Colares","Óbidos","Alenquer","Carcavelos","Lisboa"],"Setúbal":["Setúbal","Palmela","Moscatel de Setúbal"],"Madère":["Madeira","Madeira Sercial","Madeira Verdelho","Madeira Bual","Madeira Malmsey"],"Açores":["Pico","Biscoitos","Graciosa"],"Tejo":["Tejo"],"Algarve":["Lagoa","Portimão","Tavira"],"Beiras":["Beira Interior","Távora-Varosa","Lafões"],"Península de Setúbal":["Península de Setúbal"],"Trás-os-Montes":["Trás-os-Montes","Chaves","Valpaços","Planalto Mirandês"]},"Allemagne":{"Mosel":["Mosel","Bernkasteler Doctor","Wehlener Sonnenuhr","Piesporter Goldtröpfchen","Ürziger Würzgarten","Erdener Treppchen","Graacher Himmelreich","Zeltinger Sonnenuhr","Brauneberger Juffer","Scharzhofberger","Saar","Ruwer"],"Rheingau":["Rheingau","Johannisberg","Rüdesheim","Hochheim","Erbach","Marcobrunn","Steinberg","Assmannshausen","Kiedrich","Oestrich"],"Rheinhessen":["Rheinhessen","Nierstein","Oppenheim","Nackenheim"],"Pfalz":["Pfalz","Forst","Deidesheim","Ruppertsberg","Wachenheim","Kallstadt","Bad Dürkheim","Gimmeldingen","Königsbach"],"Nahe":["Nahe","Schlossböckelheim","Niederhausen"],"Baden":["Baden","Kaiserstuhl","Ortenau","Tuniberg"],"Württemberg":["Württemberg","Bottwartal","Remstal"],"Franken":["Franken","Würzburger Stein","Escherndorfer Lump"],"Ahr":["Ahr","Walporzheim"],"Saale-Unstrut":["Saale-Unstrut"],"Sachsen":["Sachsen"]},"Autriche":{"Basse-Autriche":["Wachau","Kremstal","Kamptal","Traisental","Wagram","Weinviertel","Carnuntum","Thermenregion"],"Burgenland":["Neusiedlersee","Leithaberg","Mittelburgenland","Eisenberg","Ruster Ausbruch","Rust"],"Styrie":["Südsteiermark","Vulkanland Steiermark","Weststeiermark"],"Vienne":["Wiener Gemischter Satz"]},"États-Unis":{"Californie":["Napa Valley","Oakville","Rutherford","Stags Leap District","Howell Mountain","Spring Mountain District","Mount Veeder","Diamond Mountain District","Calistoga","Yountville","Los Carneros","Sonoma Valley","Russian River Valley","Alexander Valley","Dry Creek Valley","Knights Valley","Chalk Hill","Sonoma Coast","Anderson Valley","Paso Robles","Santa Barbara County","Santa Rita Hills","Santa Maria Valley","Santa Lucia Highlands","Monterey","Lodi","Sierra Foothills","Livermore Valley","Mendocino","Carneros","Green Valley of Russian River Valley","Bennett Valley","Fort Ross-Seaview","Petaluma Gap","Ballard Canyon","Happy Canyon of Santa Barbara","Edna Valley","Arroyo Grande Valley","Arroyo Seco","Chalone","Mount Harlan","Temecula Valley","Amador County","El Dorado","Clarksburg","Suisun Valley","Coombsville","Atlas Peak","Chiles Valley","St. Helena","Wild Horse Valley","Oak Knoll District","Lake County","Santa Ynez Valley"],"Oregon":["Willamette Valley","Dundee Hills","Ribbon Ridge","Yamhill-Carlton","Eola-Amity Hills","Umpqua Valley","Rogue Valley","Chehalem Mountains","McMinnville","Van Duzer Corridor","Laurelwood District","Tualatin Hills","Applegate Valley","Columbia Gorge"],"Washington":["Columbia Valley","Yakima Valley","Walla Walla Valley","Red Mountain","Horse Heaven Hills","Rattlesnake Hills","Wahluke Slope","Royal Slope","Candy Mountain","Snipes Mountain","Lake Chelan","Naches Heights","Ancient Lakes"],"New York":["Finger Lakes","Long Island","North Fork of Long Island","Hudson River Region","Cayuga Lake","Seneca Lake"],"Virginie":["Monticello","Shenandoah Valley (VA)","Middleburg","Shenandoah Valley"],"Texas":["Texas Hill Country","Texas High Plains"],"Idaho":["Snake River Valley"]},"Argentine":{"Mendoza":["Mendoza","Luján de Cuyo","Valle de Uco","Maipú","San Rafael","Tupungato","Agrelo","Gualtallary","Paraje Altamira","Los Chacayes","Vista Flores","Perdriel","Las Compuertas","Medrano","San Carlos","Tunuyán","Vistalba"],"Salta":["Cafayate","Valles Calchaquíes","Molinos"],"San Juan":["San Juan","Valle de Tulum","Pedernal","Valle de Pedernal","Valle de Zonda"],"Patagonie":["Río Negro","Neuquén","Patagonia","Chubut"],"La Rioja (AR)":["La Rioja"],"La Rioja":["Famatina"],"Catamarca":["Fiambalá"]},"Chili":{"Vallée Centrale":["Maipo Valley","Rapel Valley","Cachapoal Valley","Colchagua Valley","Curicó Valley","Maule Valley","Apalta","Marchigüe","Peumo","Requínoa","Los Lingues","Pumanque"],"Aconcagua":["Aconcagua Valley","Casablanca Valley","San Antonio Valley","Leyda Valley","Casablanca","Leyda","San Antonio"],"Coquimbo":["Elqui Valley","Limarí Valley","Choapa Valley","Choapa","Elqui","Limarí"],"Sud":["Itata Valley","Bío-Bío Valley","Malleco Valley","Bío Bío","Itata","Malleco"],"Valle Central":["Alto Maipo","Apalta","Cachapoal","Colchagua","Curicó","Maipo","Maule","Rapel"],"Austral":["Cautín","Osorno"]},"Australie":{"Australie-Méridionale":["Barossa Valley","Eden Valley","Clare Valley","McLaren Vale","Coonawarra","Adelaide Hills","Padthaway","Langhorne Creek","Wrattonbully","Southern Fleurieu","Kangaroo Island","Riverland","Currency Creek"],"Nouvelle-Galles du Sud":["Hunter Valley","Mudgee","Orange","Riverina","Canberra District","Hilltops"],"Victoria":["Yarra Valley","Mornington Peninsula","Rutherglen","Heathcote","Geelong","Grampians","Beechworth","King Valley","Macedon Ranges","Gippsland","Pyrenees","Alpine Valleys","Goulburn Valley","Nagambie Lakes","Strathbogie Ranges"],"Australie-Occidentale":["Margaret River","Great Southern","Frankland River","Pemberton","Mount Barker","Swan Valley"],"Tasmanie":["Tasmania","Tamar Valley","Coal River Valley","Pipers River"]},"Nouvelle-Zélande":{"Île du Sud":["Marlborough","Central Otago","Nelson","Canterbury","Waipara Valley","Awatere Valley","Wairau Valley","Southern Valleys","Bannockburn","Gibbston","Bendigo","Waitaki Valley","North Canterbury","Waipara"],"Île du Nord":["Hawke's Bay","Gimblett Gravels","Martinborough","Wairarapa","Gisborne","Auckland","Waiheke Island","Northland","Te Awanga","Bridge Pa Triangle","Matakana","Kumeu"]},"Afrique du Sud":{"Western Cape":["Stellenbosch","Paarl","Franschhoek","Constantia","Swartland","Walker Bay","Hemel-en-Aarde","Elgin","Robertson","Durbanville","Wellington","Tulbagh","Darling","Breedekloof","Cederberg","Simonsberg-Stellenbosch","Jonkershoek Valley","Banghoek","Devon Valley","Bottelary","Polkadraai Hills","Voor Paardeberg","Riebeekberg","Malmesbury","Piekenierskloof","Overberg","Sutherland-Karoo (WC)"],"Northern Cape":["Douglas","Sutherland-Karoo"],"Coastal Region":["Constantia","Darling","Durbanville","Franschhoek","Paarl","Stellenbosch","Swartland","Tygerberg"],"Cape South Coast":["Cape Agulhas","Elgin","Elim","Hemel-en-Aarde","Walker Bay"],"Breede River Valley":["Breedekloof","Robertson","Worcester"],"Olifants River":["Citrusdal Mountain","Lutzville Valley"],"Klein Karoo":["Calitzdorp","Langeberg-Garcia"]},"Suisse":{"Valais":["Valais","Fendant","Dôle","Chamoson","Fully"],"Vaud":["Lavaux","Dézaley","Calamin","Chablais","La Côte"],"Genève":["Genève"],"Neuchâtel":["Neuchâtel"],"Tessin":["Ticino"],"Grisons":["Bündner Herrschaft"]},"Hongrie":{"Tokaj":["Tokaji","Tokaji Aszú","Tokaji Szamorodni","Tokaji Eszencia","Tokaji Fordítás","Mád"],"Villány":["Villány"],"Eger":["Egri Bikavér"],"Somló":["Somló"],"Badacsony":["Badacsony"],"Balaton":["Balatonfüred-Csopak","Balaton-felvidék","Nagy-Somló","Badacsony"],"Szekszárd":["Szekszárd"]},"Grèce":{"Macédoine":["Naoussa","Amyndeon","Goumenissa","Amynteo"],"Péloponnèse":["Nemea","Mantinia","Patras","Nemea Grande Réserve","Monemvasia"],"Îles":["Santorini","Samos","Paros","Limnos","Rhodes","Nykteri","Vinsanto de Santorin","Muscat de Samos"],"Crète":["Peza","Archanes","Dafnes"],"Attique":["Retsina","Attiki"],"Cyclades":["Paros","Santorini"],"Îles Ioniennes":["Céphalonie","Robola de Céphalonie"],"Samos":["Muscat de Samos"]},"Autres pays":{"Europe":["Moldavie","Roumanie","Bulgarie","Croatie","Slovénie","Géorgie","Angleterre","Luxembourg","Serbie","République tchèque","Slovaquie","Macédoine du Nord","Monténégro","Ukraine","Russie","Turquie","Chypre","Malte","Kakhétie","Moselle luxembourgeoise","Sussex"],"Monde":["Canada","Uruguay","Brésil","Mexique","Pérou","Bolivie","Chine","Japon","Inde","Liban","Israël","Maroc","Algérie","Tunisie","Égypte","Thaïlande","Vietnam"],"Amériques":["Bolivie","Brésil","Canada","Canelones","Mexique","Niagara Peninsula","Okanagan Valley","Prince Edward County","Pérou","Serra Gaúcha","Uruguay","Vale dos Vinhedos","Valle de Guadalupe"],"Asie & Afrique":["Algérie","Chine","Galilée","Inde","Israël","Japon","Judean Hills","Liban","Maroc","Nashik","Ningxia","Thaïlande","Tunisie","Vallée de la Bekaa","Yamanashi"]}};
const WINE_GRAPES = ["Abouriou","Agiorgitiko","Aglianico","Aidani","Airén","Albariño","Alfrocheiro","Alicante Bouschet","Aligoté","Altesse","Alvarinho","Amigne","Antão Vaz","Arbane","Areni","Arinarnoa","Arinto","Arneis","Arrufiac","Assyrtiko","Athiri","Auxerrois","Bacchus","Baga","Barbera","Baroque","Bical","Blaufränkisch","Bobal","Bonarda","Bourboulenc","Bovale","Boğazkere","Braucol","Braucol (Fer Servadou)","Bual","Cabernet Franc","Cabernet Sauvignon","Caladoc","Cannonau","Carignan","Carignano","Cariñena","Carménère","Carricante","Casavecchia","Castelão","Castets","Catarratto","Catawba","Cereza","Chardonnay","Chasselas","Chenin","Chenin Blanc","Cinsault","Clairette","Coda di Volpe","Colombard","Completer","Concord","Cortese","Corvina","Counoise","Courbu","Criolla","Croatina","Côt","Dolcetto","Dornfelder","Duras","Elbling","Encruzado","Erbaluce","Falanghina","Favorita","Fer Servadou","Fernão Pires","Fiano","Folle Blanche","Frappato","Freisa","Friulano","Furmint","Gaglioppo","Gamay","Garganega","Garnacha","Garnacha Tinta","Gewurztraminer","Glera","Godello","Graciano","Greco","Grenache","Grenache (Garnacha)","Grenache Blanc","Grignolino","Grillo","Gringet","Grolleau","Gros Manseng","Grüner Veltliner","Humagne","Huxelrebe","Hárslevelű","Jacquère","Jaen","Juhfark","Jurançon Noir","Kadarka","Kerner","Kisi","Kékfrankos","Lagrein","Lemberger","Limnio","Loin de l'Œil","Loureiro","Macabeo","Malagousia","Malbec","Malbec (Côt)","Malmsey","Malvasia","Malvasia Istriana","Malvasía","Marsanne","Marselan","Mauzac","Mavrodaphne","Mazuelo","Melon","Melon de Bourgogne","Mencía","Merlot","Molette","Molinara","Monastrell","Mondeuse","Montepulciano","Moscatel","Moscato Bianco","Moschofilero","Mourvèdre","Mourvèdre (Monastrell)","Mtsvane","Muscadelle","Muscardin","Muscat","Muscat d'Alexandrie","Muscat d'Alsace","Muscat Ottonel","Muscat à Petits Grains","Müller-Thurgau","Nebbiolo","Negroamaro","Nerello Cappuccio","Nerello Mascalese","Nero d'Avola","Neuburger","Niagara","Nielluccio","Norton","Nuragus","Négrette","Palomino","Parellada","Passerina","Pecorino","Pedro Giménez","Pedro Ximénez","Perricone","Persan","Petit Courbu","Petit Manseng","Petit Meslier","Petit Verdot","Petite Arvine","Petite Sirah","Picolit","Picpoul","Piedirosso","Pineau d'Aunis","Pinot Blanc","Pinot Gris","Pinot Meunier","Pinot Noir","Pinotage","Plavac Mali","Portugieser","Poulsard","Prieto Picudo","Primitivo","Primitivo (Zinfandel)","Prunelard","Ramisco","Refosco","Ribolla Gialla","Riesling","Rivaner","Rkatsiteli","Robola","Roditis","Rolle","Rolle (Vermentino)","Romorantin","Rondinella","Rotgipfler","Roussanne","Ruchè","Ruché","Sacy","Sagrantino","Sangiovese","Sankt Laurent","Saperavi","Sauvignon Blanc","Sauvignon Gris","Sauvignonasse","Savagnin","Savatiano","Scheurebe","Schiava","Sciaccarello","Semillon","Sercial","Seyval Blanc","Spätburgunder","St. Laurent","Susumaniello","Sylvaner","Syrah","Syrah (Shiraz)","Sémillon","Tannat","Tempranillo","Teran","Teroldego","Terret Noir","Tibouren","Tinta Barroca","Tinta Roriz","Tinto Cão","Torrontés","Touriga Franca","Touriga Nacional","Trebbiano","Treixadura","Trincadeira","Trollinger","Trousseau","Ugni Blanc","Vaccarèse","Verdejo","Verdelho","Verdicchio","Vermentino","Vernaccia","Vidal","Vidiano","Vignoles","Vilana","Viognier","Vitovska","Viura","Viura (Macabeo)","Vranac","Welschriesling","Xarel·lo","Xinomavro","Zalema","Zibibbo","Zierfandler","Zinfandel","Zweigelt","Öküzgözü"];

// Index inverses : depuis une appellation, retrouver sa région et son pays.
const _WW_APP2 = (() => {
  const m = {};
  for (const [pays, regs] of Object.entries(WINE_WORLD))
    for (const [reg, apps] of Object.entries(regs))
      for (const a of apps) if (!m[normKey(a)]) m[normKey(a)] = { region: reg, country: pays };
  return m;
})();
const _WW_REG2 = (() => {
  const m = {};
  for (const [pays, regs] of Object.entries(WINE_WORLD))
    for (const reg of Object.keys(regs)) if (!m[normKey(reg)]) m[normKey(reg)] = pays;
  return m;
})();
const wwCountries = () => Object.keys(WINE_WORLD).sort((a, b) =>
  a === "Autres pays" ? 1 : b === "Autres pays" ? -1 : a.localeCompare(b));
const wwRegions = (pays) => {
  if (pays && WINE_WORLD[pays]) return Object.keys(WINE_WORLD[pays]).sort((a, b) => a.localeCompare(b));
  return Object.keys(_WW_REG2).length ? [...new Set(
    Object.values(WINE_WORLD).flatMap(r => Object.keys(r)))].sort((a, b) => a.localeCompare(b)) : [];
};
const wwAppellations = (pays, region) => {
  if (region) {
    const p = pays && WINE_WORLD[pays] && WINE_WORLD[pays][region] ? pays : _WW_REG2[normKey(region)];
    const list = p ? ((WINE_WORLD[p] || {})[region] || []) : [];
    if (list.length) return [...list].sort((a, b) => a.localeCompare(b));
  }
  if (pays && WINE_WORLD[pays])
    return [...new Set(Object.values(WINE_WORLD[pays]).flat())].sort((a, b) => a.localeCompare(b));
  return [...new Set(Object.values(WINE_WORLD).flatMap(r => Object.values(r).flat()))]
    .sort((a, b) => a.localeCompare(b));
};
const wwResolve = (appellation) => _WW_APP2[normKey(appellation || "")] || null;
const wwCountryOfRegion = (region) => _WW_REG2[normKey(region || "")] || "";

// ── Icônes HD des boutons du header (v7.1.0) ─────────────────────────────────
// Tracés vectoriels 512×512 de game-icons.net (Delapouite & Lorc, CC BY 3.0 —
// crédit dans le README). Choix utilisateur dans ⚙️ Options → Personnalisation,
// mémorisé par appareil (localStorage).
const HDR_ICON_PATHS = {
  "corkscrew": "M263.1 35.94c-1.5.5-4.2 1.73-7.4 3.77-6.9 4.38-15.8 11.85-24 19.98-8.1 8.13-15.6 17.03-20 23.92-2 3.16-3.2 5.81-3.7 7.31 15.7 15.38 31.3 25.88 44.6 33.88 13.9 8.3 25.1 13.4 32.9 21.1l.6.7.5.7c45.5 68.3 19.7 42.6 88 88l.7.5.7.6c7.7 7.8 12.8 19.1 21.1 32.9 8 13.3 18.5 28.9 33.9 44.6 1.5-.5 4.2-1.7 7.3-3.7 6.9-4.4 15.8-11.9 24-20 8.1-8.2 15.6-17.1 20-24 2-3.2 3.2-5.9 3.7-7.4-11.6-11.6-32.3-31.3-62.6-41.4l-3.6-1.1-1.7-3.4c-21.5-43.1-66-87.5-109-109.2l-3.3-1.6-1.2-3.48c-10.2-30.37-29.9-51.02-41.5-62.68zm32.5 157.86l-26.4 26.4 32.5 32.5 26.4-26.3c-16.7-11.1-21.4-15.9-32.5-32.6zm-34.9 43.3c-7.4 9.5-8.4 17-7.5 34.5.5 9.8-2.6 18.7-3.3 19.2-.8.7-2.3.6-6.7-.9-4.1-1.4-10.6-4.7-17.4-8.2-7-3.5-14.7-7.5-22.9-10-8.1-2.4-17.6-2.9-23 2.4-5.6 5.6-4.5 15.7-1.8 24 2.7 8.2 7.1 16.1 10.7 23.3 3.8 7.1 6.9 13.5 8.2 17.1 1.4 3.9 1.1 3.9.6 4.5-.4.4-.5.6-4.4-.7-3.7-1.2-10-4.4-17.2-8.1-7.1-3.7-15-8.1-23.2-10.7-8.3-2.8-18.4-3.8-24 1.8-5.5 5.5-4.5 15.6-1.7 23.9 2.6 8.2 7.1 16.1 10.7 23.2 3.6 7.2 6.8 13.5 8.2 17.1 1.2 4 1 4.1.5 4.6s-.5.7-4.4-.7c-3.7-1.2-10.1-4.4-17.1-8.2-7.2-3.6-15.1-8-23.3-10.7-8.29-2.7-18.41-3.8-23.99 1.8-5.45 5.5-4.88 15.1-2.26 23.3 2.61 8.2 6.71 16 10.32 23 3.68 7 6.79 13.4 8.34 17.5 5.66 15-58.55 14.4-68.09 12.2 6.43 16.5 80.48 34 94.38 16.4 4.4-6.3 3-16 .2-24.3-2.9-8.2-7-16-10.7-22.9-3.4-6.8-6.5-12.9-7.6-16.6-1.1-3.6-.9-3.8-.3-4.3.5-.5.5-.7 4.4.5 3.7 1.4 10.1 4.5 17.2 8.2 7.1 3.7 14.9 8 23.3 10.7 8.2 2.8 18.4 3.8 23.9-1.7 5.6-5.6 4.5-15.7 1.8-24s-7.1-16.1-10.7-23.2c-3.8-7.2-7-13.5-8.3-17.2-1.2-3.9-1-4-.6-4.4.6-.6.7-.8 4.5.5 3.7 1.4 10 4.5 17.2 8.3 7.1 3.6 15 7.9 23.2 10.7 8.3 2.7 18.4 3.8 23.9-1.7 5.7-5.7 4.6-15.8 1.9-24.1-2.8-8.3-7.1-16.1-10.7-23.2-3.8-7.1-6.9-13.5-8.3-17.2-1.2-3.8-1-3.9-.5-4.4.6-.6.8-.9 4.4.2 3.5 1.2 9.3 4 16.2 7.3 6.7 3.5 14.5 7.7 22.6 10.4 8.1 3 17.5 4.5 24.4.9 11.1-6.4 11.6-21.4 9.6-33-1.7-10.2-.1-16.8 3.8-22.6z",
  "wine-bottle": "M133.99 28v23.512h52.02V28h-52.02zm0 41.51v90.705c-26.01 17.34-43.347 39.014-43.347 56.353v260.735S90.64 494 107.98 494h103.967c17.411 0 17.41-17.34 17.41-17.34V216.568c0-17.34-17.338-39.014-43.347-56.353V69.51h-52.02zM107 252h106v162H107V252zm194.514 3l-2.051 6.154c-8.474 25.423-12.793 58.44-6.233 86.87 3.28 14.215 9.429 27.45 19.846 37.273 8.61 8.118 20.105 13.533 33.924 15.172v74.64C327.601 479.296 302 494 302 494h108s-25.601-14.705-45-18.89v-74.641c13.82-1.639 25.314-7.054 33.924-15.172 10.417-9.822 16.565-23.058 19.846-37.274 6.56-28.43 2.241-61.446-6.233-86.869l-2.05-6.154H301.513zM125 270v126h70V270h-70zm189.703 3h82.594c2.639 9.261 4.629 19.565 5.68 30h-93.954c1.051-10.435 3.041-20.739 5.68-30zm-6.486 48h95.566c-.116 8.04-.907 15.846-2.553 22.977-2.72 11.784-7.571 21.548-14.654 28.226C379.494 378.881 370.126 383 356 383c-14.125 0-23.494-4.12-30.576-10.797-7.083-6.678-11.935-16.442-14.654-28.226-1.646-7.131-2.437-14.938-2.553-22.977z",
  "champagne-cork": "M255.4 23.36c4.3 9.66 13.2 22.08 25.9 34.75 18 17.99 42.6 36.94 68.5 53.39 25.9 16.5 53 30.6 75.6 39.2 11.3 4.2 21.6 7.1 29.7 8.3 3.4.5 6.4.7 8.9.6-22.2-33.8-56.4-66.36-94.5-91.13-37.3-24.25-78.1-40.9-114.1-45.11zm-18.1 4.13c-41.7 28.17-56 76.31-65.5 124.01 8.1 17.3 35.4 46.3 71.3 72.1 36.6 26.3 81.9 50.1 123.5 60.3 34.5-8.8 56.1-26.4 71.3-48.1 12.4-17.6 20.4-38 26.7-58.1-3.9.1-8-.3-12.2-.9-10-1.4-21.2-4.7-33.4-9.3-22.6-8.6-48.2-21.8-73.3-37.3l-52.5 48.1 24.4-66.8c-18.3-13.05-35.2-26.88-49-40.67-14.7-14.63-26.3-28.9-31.3-43.34zM184 197.5L48.21 359l-.22.3c-.5.5-.63.6-.63 1.7s.28 3.2 1.45 6c2.35 5.6 7.92 13.6 15.85 22.2.57.6 1.18 1.3 1.78 1.9l27.01-22.9-19.34 30.6c15.51 15 36.19 31.3 57.99 45.7 21.1 14 43.4 26.3 62.6 34.3l37.8-71.3-12.1 79.6c6 1.3 11.2 1.7 14.9 1.4 6-.6 7.6-1.8 8.9-5.1l.1-.2 87.2-191.3c-8.4-3.1-16.9-6.6-25.3-10.5L278.9 308l11.8-34.1c-20.6-10.6-40.3-22.9-58.1-35.7-18.7-13.4-35.3-27.2-48.6-40.7z",
  "bow-tie": "M51.855 169.203C31.677 191.101 21 223.381 21 256s10.677 64.9 30.855 86.797c15.674-.505 44.822-4.243 73.961-11.527 21.772-5.443 43.342-13.134 58.973-21.8-5.558-6.025-8.448-13.975-10.55-22.91a107.81 107.81 0 0 1-1.323-6.603l-58.443 16.697-4.946-17.308 61.588-17.596c-.068-1.912-.115-3.83-.115-5.75s.047-3.838.115-5.75l-61.588-17.596 4.946-17.308 58.443 16.697a107.81 107.81 0 0 1 1.322-6.604c2.103-8.934 4.993-16.884 10.551-22.91-15.631-8.665-37.2-16.356-58.973-21.799-29.14-7.284-58.287-11.022-73.96-11.527zm408.29 0c-15.674.505-44.822 4.243-73.961 11.527-21.772 5.443-43.342 13.134-58.973 21.8 5.558 6.025 8.448 13.975 10.55 22.91.505 2.14.94 4.35 1.323 6.603l58.443-16.697 4.946 17.308-61.588 17.596c.068 1.912.115 3.83.115 5.75s-.047 3.838-.115 5.75l61.588 17.596-4.946 17.308-58.443-16.697a107.81 107.81 0 0 1-1.322 6.604c-2.103 8.934-4.993 16.884-10.551 22.91 15.631 8.665 37.2 16.356 58.973 21.799 29.14 7.284 58.287 11.022 73.96 11.527C480.324 320.899 491 288.619 491 256s-10.677-64.9-30.855-86.797zM256 205c-13.571 0-27.173.992-37.957 2.867-10.784 1.876-18.862 5.678-19.68 6.496-1.878 1.879-4.809 7.578-6.601 15.198C189.969 237.18 189 246.6 189 256c0 9.4.969 18.82 2.762 26.44 1.792 7.619 4.723 13.318 6.601 15.197.818.818 8.896 4.62 19.68 6.496C228.827 306.008 242.429 307 256 307c13.571 0 27.173-.992 37.957-2.867 10.784-1.876 18.862-5.678 19.68-6.496 1.878-1.879 4.809-7.578 6.601-15.198C322.031 274.82 323 265.4 323 256c0-9.4-.969-18.82-2.762-26.44-1.792-7.619-4.723-13.318-6.601-15.197-.818-.818-8.896-4.62-19.68-6.496C283.173 205.992 269.571 205 256 205z",
  "grapes": "M277.28 18.094c2.42 33.67-.094 66.692-8.967 99.187-.552-2.168-1.15-4.308-1.813-6.436-9.355-30.034-29.53-55.765-61.313-75.313-21.642-16.548-60.26-23.695-113.437-8.343 2.25 22.26 45.452 24.822 60.156 26.844C123.012 60.4 91.11 85.214 48.53 90.25c39.324 20.744 92.66 4.396 129.064-11.688-1.873 17.715-13.69 29.033-24.53 59.594 47.832-11.062 70.85-37.418 72.155-62.562 11.173 12.212 18.763 25.81 23.436 40.812 3.505 11.25 5.34 23.392 5.594 36.344 3.873 4.97 6.9 10.635 8.813 16.78 5.315-3.01 11.198-5.134 17.437-6.155 6.107-14.92 12.983-27.09 20.53-36.156 14.88-17.87 30.967-24.548 53.5-20.19l.033-.155c32.603 22.698 24.114 60.97 12.25 89.375 21.587-6.676 33.4-19.928 33.437-42.97 17.947 11.77 25.423 31.093 30.563 52.064 7.22-21.503 5.772-44.784-12.782-64.844l43.345 16.5c-27.924-33.363-54.318-68.923-105.28-68.688-26.457-4.45-49.91 4.967-67.376 24.563 7.41-31.25 9.436-62.938 7.28-94.78h-18.72zM212.53 150.97c-19.002 0-34.218 15.184-34.218 34.186 0 6.81 1.963 13.127 5.344 18.438 3.66-.807 7.452-1.25 11.344-1.25 13.056 0 25.03 4.807 34.28 12.72 10.44-5.836 17.44-17.008 17.44-29.908 0-19.002-15.186-34.187-34.19-34.187zm-58.405 18.686c-19.003 0-34.22 15.185-34.22 34.188 0 15.977 10.75 29.295 25.47 33.125 4.004-10.795 11.44-19.943 20.97-26.126-4.267-7.615-6.72-16.384-6.72-25.688 0-5.082.74-9.997 2.094-14.656-2.44-.544-4.984-.844-7.595-.844zm134.906 11.688c-19.002 0-34.217 15.185-34.217 34.187 0 3.495.51 6.866 1.468 10.032 4.125-1.04 8.44-1.593 12.876-1.593 16.203 0 30.745 7.38 40.47 18.936 8.274-6.225 13.593-16.133 13.593-27.375 0-19-15.186-34.186-34.19-34.186zM195 221.03c-19.003 0-34.22 15.218-34.22 34.22S176 289.47 195 289.47s34.22-15.218 34.22-34.22-15.217-34.22-34.22-34.22zm147.156 7.032c-.594 0-1.195.002-1.78.032-3.13 12.737-10.908 23.675-21.407 30.937 2.01 5.575 3.092 11.566 3.092 17.814 0 4.15-.523 8.182-1.437 12.062 5.863 4.74 13.34 7.563 21.53 7.563 19.004 0 34.22-15.218 34.22-34.22s-15.216-34.188-34.22-34.188zm-73 14.594c-8.17 0-15.644 2.82-21.5 7.53.16 1.673.25 3.352.25 5.064 0 12.203-4.18 23.462-11.187 32.438 4.49 13.63 17.23 23.375 32.436 23.375 19.003 0 34.22-15.217 34.22-34.22 0-19.002-15.217-34.187-34.22-34.187zm-144.25 11.094c-19.003 0-34.187 15.216-34.187 34.22 0 11.956 6.024 22.397 15.218 28.5 4.38-20.14 20.305-36.045 40.437-40.44-2.357-5.47-3.817-11.402-4.188-17.624-5.063-2.95-10.953-4.656-17.28-4.656zm32.72 39.72c-19.004 0-34.22 15.184-34.22 34.186 0 19.003 15.217 34.22 34.22 34.22 19 0 34.186-15.217 34.186-34.22 0-7.704-2.484-14.777-6.718-20.47-10.17-1.946-19.338-6.793-26.563-13.686-.3-.008-.603-.03-.905-.03zM222 300.686c-4.825 2.887-10.135 5.02-15.78 6.25 2.737 6.375 4.28 13.366 4.28 20.72 0 10.833-3.3 20.933-8.938 29.343 6.227 6.618 15.09 10.72 24.97 10.72 19.002 0 34.218-15.218 34.218-34.22 0-1.527-.122-3.028-.313-4.5-16.79-2.815-30.95-13.604-38.437-28.313zm91.03 5.657c-7.686 11.375-19.688 19.607-33.592 22.375 5.016 12.622 17.287 21.467 31.78 21.467 19.003 0 34.22-15.185 34.22-34.187 0-.313-.024-.627-.032-.938-1.075.066-2.16.094-3.25.094-10.745 0-20.76-3.25-29.125-8.812zm-38 48.125c-4.6 10.558-12.534 19.36-22.467 25.03 3.98 14.483 17.154 25 32.968 25 19.004 0 34.19-15.185 34.19-34.188 0-.71-.022-1.425-.064-2.125-2.75.445-5.567.688-8.437.688-13.967 0-26.708-5.495-36.19-14.406zm-86.31 15.936c-5.773 4.222-12.433 7.27-19.626 8.875-.816 2.942-1.28 6.036-1.28 9.25 0 19.004 15.184 34.19 34.186 34.19 19.002 0 34.22-15.186 34.22-34.19 0-1.006-.042-2.015-.126-3-3.103.575-6.3.876-9.563.876-14.775 0-28.19-6.147-37.81-16zm-61.282.625c-2.582 4.822-4.032 10.332-4.032 16.22 0 19.002 15.217 34.188 34.22 34.188.992 0 1.966-.044 2.936-.125-7.16-9.024-11.437-20.424-11.437-32.782 0-2.914.26-5.77.72-8.56-8.234-1.228-15.854-4.355-22.407-8.94zm122.968 38.72c-1.208 2.733-2.647 5.342-4.28 7.813 10.19 8.923 16.945 21.68 17.968 35.968 17.506-.66 31.472-14.26 32.75-31.592-3.65.802-7.43 1.25-11.313 1.25-13.452 0-25.763-5.1-35.124-13.438zm-17.094 21.313c-8.777 6.49-19.612 10.343-31.312 10.343-6.638 0-12.98-1.245-18.844-3.5-3.78 5.503-6 12.167-6 19.406 0 19.003 15.185 34.22 34.188 34.22 19.002 0 34.22-15.217 34.22-34.22 0-10.61-4.755-19.998-12.25-26.25z",
  "wine-glass": "M148.97 22.47l-6.25.093-2.564 6.156c-13.235 37.556-21.28 79-21.28 118.093 0 53.777 14.848 93.17 39.874 118.875 18.945 19.458 43.36 30.696 70.156 35 17.09 48.115 16.085 101.005-2.562 148.687-30.555 5.118-60.254 18.273-86.313 39.5h231.22c-26.066-21.23-55.75-34.384-86.313-39.5-18.667-47.734-19.62-100.686-2.468-148.844 26.58-4.382 50.84-15.552 69.75-34.842 25.184-25.692 40.186-65.08 40.186-118.875 0-39.093-8.045-80.537-21.28-118.094l-2.188-6.25h-219.97zm6.75 18.686h199.843c7.25 21.815 12.64 44.904 15.593 67.72h-231.03c2.953-22.816 8.344-45.905 15.593-67.72zm-17.47 86.406h234.78c.45 6.49.69 12.912.69 19.25 0 50.357-13.716 84.26-34.845 105.813-21.13 21.554-50.295 31.406-83.53 31.406-33.238 0-62.247-9.863-83.22-31.405s-34.563-55.437-34.563-105.813c0-6.338.24-12.76.688-19.25z"
};
const HDR_ICON_SETS = {
  open: [["corkscrew", "Tire-bouchon"], ["wine-bottle", "Bouteille"], ["champagne-cork", "Bouchon"]],
  som:  [["bow-tie", "Nœud papillon"], ["grapes", "Grappe"], ["wine-glass", "Verre"]],
};
const hdrIconPref = (kind) => {
  const def = kind === "open" ? "corkscrew" : "bow-tie";
  try {
    const v = localStorage.getItem(`millesime-ico-${kind}`);
    if (v && HDR_ICON_PATHS[v]) return v;
  } catch (e) {}
  return def;
};
const hdrIconSVG = (name, size = 16) =>
  `<svg viewBox="0 0 512 512" width="${size}" height="${size}" class="hdr-ico" aria-hidden="true">` +
  `<path fill="currentColor" d="${HDR_ICON_PATHS[name] || HDR_ICON_PATHS.corkscrew}"/></svg>`;

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
    this._filtersOpen = false; // sous-menu repliable
    this._filterTab = "occasions"; // onglet actif du sous-menu
    this._occasionFilter = "";     // occasion sélectionnée (surbrillance cave)
    let lblMode = "both";
    try { lblMode = localStorage.getItem("millesime-labelmode") || "both"; } catch (e) {}
    this._labelMode = ["plate", "bubble", "both"].includes(lblMode) ? lblMode : "both"; // repères 3D
    let aMode = "radar";
    try { aMode = localStorage.getItem("millesime-aroma-mode") || "radar"; } catch (e) {}
    this._aromaMode = ["radar", "bars"].includes(aMode) ? aMode : "radar";   // profil aromatique
    let autoAI = "1";
    try { autoAI = localStorage.getItem("millesime-auto-ai") ?? "1"; } catch (e) {}
    this._autoAI = autoAI !== "0";                                           // IA auto dans les accords
    this._three      = null;  // contexte WebGL (vue 3D)
    this._threeModP  = null;  // promesse du module three.js (chargé une fois)
  }

  setConfig(config) {
    this._config = config || {};
    // Priorité : choix manuel mémorisé (localStorage) > default_view YAML > 3D.
    // bottle_style: dot accepté comme alias déprécié.
    if (!this._viewTouched) {
      let saved = null;
      try { saved = localStorage.getItem("millesime-view"); } catch (e) {}
      if (saved === "2d" || saved === "dot" || saved === "3d") {
        this._view = saved;
      } else {
        const dv = normKey(this._config.default_view);
        this._view = dv === "2d" || dv === "dot" ? dv
          : this._config.bottle_style === "dot" ? "dot" : "3d";
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
    this._injectFonts(serifName, sansName, cfg.font_url);
    if (cfg.font_size) {
      // Réglage explicite : taille fixe (priorité à la config YAML)
      this._fsBase = parseFloat(cfg.font_size) || 14;
      this.style.fontSize = this._fsBase + 'px';
      set('--fs-base', this._fsBase + 'px');
      this._fsModalCss = this._fsBase + 'px';
    } else {
      // Base FLUIDE par défaut : suit la largeur de la CARTE (unité cqi résolue via
      // le conteneur :host), bornée 13–18px. Tout le texte étant en em, l'ensemble
      // s'adapte en continu — y compris vers le HAUT sur grand écran (Full HD), où
      // l'ancien plafond 15px (atteint dès ~440px) bridait la carte. Appliquée sur
      // .card car un conteneur ne peut pas se mesurer lui-même (cqi sur :host
      // viserait le viewport).
      this._fsBase = 15;                       // médiane pour les calculs JS (labels 2D)
      this.style.removeProperty('font-size');
      // Pas d'inline : le défaut vient de :host (CARD_CSS) → surchargeable par card-mod.
      this.style.removeProperty('--fs-base');
      // Popups hors conteneur (document.body) → fluide en vw au lieu de cqi (cqi y
      // viserait le viewport). Plancher 14px (confort des formulaires au doigt),
      // plafond 21px : une boîte de dialogue peut être un peu plus généreuse que la
      // carte, et sur Full HD l'ancien plafond 18px paraissait petit.
      this._fsModalCss = 'clamp(14px, 2vw, 21px)';
    }
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
    const prevHass = this._hass;
    this._hass = hass;
    if (first) { this._subscribeUpdates(); this._fetchData(); }
    if (first || themeChanged) this._applyTheme();
    // Re-render léger si la valeur d'un capteur configuré a changé (zones T°/hygro)
    if (!first && !this._modal && prevHass) {
      const c = this._data?.cellar || {};
      for (const ent of [c.temp_entity, c.humid_entity]) {
        if (ent && prevHass.states[ent]?.state !== hass.states[ent]?.state) {
          this._render();
          break;
        }
      }
    }
  }

  getCardSize() { return 8; }

  // Layout « sections » (HA 2024.11+) : la carte occupe toute la largeur par défaut
  // (grille de 12 colonnes) et reste redimensionnable, minimum 6 colonnes.
  getGridOptions() {
    return { columns: "full", rows: "auto", min_columns: 6, min_rows: 4 };
  }

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
    // (v7.0.0 : l'ancien verrou _squelchUpdates a été retiré — la permutation
    // est désormais atomique côté backend, plus d'états intermédiaires à masquer)
    try {
      const raw = await this._hass.connection.sendMessagePromise({ type: "millesime/get_data" });
      this._data = this._projectCellar(raw);
    } catch (err) {
      console.error("[Millésime] fetchData:", err);
      this._data = this._data || DEFAULT_DATA();
    }
    if (!this._modal) this._render();
    else this._pendingRender = true;
  }

  // ── Projection multi-caves ───────────────────────────────────────────────
  // Le backend renvoie cellars[] + wines[] (globaux). La carte travaille sur UNE
  // cave à la fois : la cave active est projetée sur data.cellar et les vins sont
  // filtrés sur ses casiers — tout le reste du code fonctionne ainsi à l'identique.
  // Choix de la cave : YAML cellar_id (carte épinglée) > localStorage > 1re cave.
  _projectCellar(raw) {
    const cellars = (raw?.cellars?.length ? raw.cellars : (raw?.cellar ? [{ id: "main", ...raw.cellar }] : []))
      .map(c => ({ ...c, id: c.id || "main" }));
    if (!cellars.length) cellars.push({ id: "main", name: "Millésime", racks: [] });
    let cid = this._config?.cellar_id || this._cellarId;
    if (!cid) { try { cid = localStorage.getItem("millesime-cellar"); } catch (e) {} }
    const cellar = cellars.find(c => c.id === cid) || cellars[0];
    this._cellarId = cellar.id;
    const rackIds = new Set((cellar.racks || []).map(r => r.id));
    // Vins de la cave active : slots restreints à ses casiers ; les vins jamais
    // placés (aucun slot) restent visibles partout, en attente de placement.
    const wines = (raw?.wines || []).flatMap(w => {
      const all = w.slots || [];
      const slots = all.filter(s => rackIds.has(s.rack_id));
      if (!slots.length && all.length) return [];
      return [{ ...w, slots }];
    });
    return { cellar, cellars, wines, tasting_log: raw?.tasting_log || [], ai_usage: raw?.ai_usage || null };
  }

  // ── Fenêtre de progression IA (v7.0.0) ─────────────────────────────────────
  // Petite fenêtre flottante commune à TOUS les appels Gemini : étapes nommées
  // + barre. Gemini ne renvoie la consommation de tokens QU'EN FIN de requête
  // (usageMetadata) : on affiche donc une estimation à l'envoi, puis les
  // chiffres réels et le cumul du jour à la réception. La barre progresse par
  // étapes (pas de pourcentage fictif) et plafonne à 90 % tant que la réponse
  // n'est pas arrivée.
  _aiProgressOpen(title, estTokens = 0) {
    this._aiProgressClose();                       // une seule fenêtre à la fois
    if (!document.querySelector("#mm-aiprog-css")) {
      const st = document.createElement("style");
      st.id = "mm-aiprog-css";
      st.textContent = `
        @keyframes mm-aiprog-fade { from{opacity:0} to{opacity:1} }
        @keyframes mm-aiprog-spin { to{transform:rotate(360deg)} }
        .mm-aiprog { position:fixed; left:50%; bottom:max(18px, env(safe-area-inset-bottom)); transform:translateX(-50%);
          z-index:100001; width:min(420px, calc(100vw - 24px)); box-sizing:border-box;
          background:#241a1a; color:#f0e6d2; border:1px solid #4a3535; border-radius:14px;
          padding:12px 14px; box-shadow:0 8px 30px rgba(0,0,0,0.55);
          font-family:system-ui,-apple-system,sans-serif; font-size:13px; animation:mm-aiprog-fade 0.15s ease; }
        .mm-aiprog .mm-spinner { width:14px; height:14px; border:2px solid #4a3535; border-top-color:#C0392B;
          border-radius:50%; display:inline-block; animation:mm-aiprog-spin 0.8s linear infinite; flex-shrink:0; }
        .mm-aiprog * { box-sizing:border-box; }
        .mm-aiprog-title { font-weight:700; margin-bottom:7px; display:flex; align-items:center; gap:7px; }
        .mm-aiprog-step { color:#c9b8a8; font-size:0.88em; min-height:1.2em; }
        .mm-aiprog-track { height:7px; background:#3a2b2b; border-radius:4px; overflow:hidden; margin:8px 0 7px; }
        .mm-aiprog-fill { height:100%; width:5%; background:linear-gradient(90deg,#7B1D2E,#C0392B); border-radius:4px; transition:width 0.5s ease; }
        .mm-aiprog-tokens { font-size:0.78em; color:#9c8a7a; font-variant-numeric:tabular-nums; }
        .mm-aiprog.mm-aiprog--done .mm-aiprog-fill { background:linear-gradient(90deg,#2E5C3B,#3f7a50); }
        .mm-aiprog.mm-aiprog--err  .mm-aiprog-fill { background:#8a2b2b; }`;
      document.head.appendChild(st);
    }
    const el = document.createElement("div");
    el.className = "mm-aiprog";
    el.innerHTML = `
      <div class="mm-aiprog-title"><span class="mm-spinner"></span>${esc(title)}</div>
      <div class="mm-aiprog-step">Préparation de la cave…</div>
      <div class="mm-aiprog-track"><div class="mm-aiprog-fill"></div></div>
      <div class="mm-aiprog-tokens">${estTokens ? `~${estTokens.toLocaleString("fr-FR")} tokens à envoyer` : "&nbsp;"}</div>`;
    document.body.appendChild(el);
    this._aiProg = el;
    const fill = el.querySelector(".mm-aiprog-fill");
    const stepEl = el.querySelector(".mm-aiprog-step");
    const tokEl = el.querySelector(".mm-aiprog-tokens");
    const STEPS = ["Préparation de la cave…", "Envoi au sommelier…", "Analyse du sommelier…", "Rédaction de la réponse…"];
    let cur = 0;
    // Avance visuelle automatique bornée : l'étape « Analyse » est la plus longue
    const auto = setInterval(() => {
      if (cur < 2) return;
      const w = parseFloat(fill.style.width) || 5;
      if (w < 90) fill.style.width = Math.min(90, w + 4) + "%";
    }, 900);
    const api = {
      step: (i) => {
        cur = Math.min(i, STEPS.length - 1);
        stepEl.textContent = STEPS[cur];
        fill.style.width = [5, 22, 45, 92][cur] + "%";
      },
      done: (usage) => {
        clearInterval(auto);
        el.classList.add("mm-aiprog--done");
        el.querySelector(".mm-spinner")?.remove();
        stepEl.textContent = "Terminé ✓";
        fill.style.width = "100%";
        const c = usage?.call, d = usage?.day;
        // v7.0.1 : ajoute le % du budget quotidien estimé (free tier Gemini)
        const dayTotal = d ? (d.prompt || 0) + (d.output || 0) : 0;
        const dayPct = Math.min(100, Math.round((dayTotal / GEMINI_FREE_TIER_DAILY_BUDGET) * 100));
        if (c) tokEl.textContent =
          `${(c.prompt || 0).toLocaleString("fr-FR")} envoyés / ${(c.output || 0).toLocaleString("fr-FR")} reçus` +
          (d ? ` · aujourd'hui : ${dayTotal.toLocaleString("fr-FR")} tokens (${d.calls || 0} appels · ${dayPct} % du budget)` : "");
        setTimeout(() => api.close(), 3200);
      },
      fail: (message) => {
        clearInterval(auto);
        el.classList.add("mm-aiprog--err");
        el.querySelector(".mm-spinner")?.remove();
        stepEl.textContent = message || "Échec de la requête";
        fill.style.width = "100%";
        setTimeout(() => api.close(), 3500);
      },
      close: () => { clearInterval(auto); el.remove(); if (this._aiProg === el) this._aiProg = null; },
    };
    return api;
  }

  _aiProgressClose() { this._aiProg?.remove(); this._aiProg = null; }

  // Estimation grossière des tokens d'un envoi (~4 caractères/token)
  _estimateTokens(text) { return Math.round((text || "").length / 4); }

  // Changement de cave active (sélecteur d'en-tête ou fenêtre de gestion)
  _switchCellar(cid) {
    if (!cid || cid === this._cellarId) return;
    this._cellarId = cid;
    try { localStorage.setItem("millesime-cellar", cid); } catch (e) {}
    this._fetchData();
  }

  _subscribeUpdates() {
    // Toujours recharger les données (même modale ouverte : _fetchData diffère
    // alors le rendu via _pendingRender, appliqué à la fermeture de la modale)
    this._hass.connection
      .subscribeEvents(() => this._fetchData(), `${DOMAIN}_updated`)
      .then((u) => { if (this.isConnected) this._unsubs.push(u); else u(); });
    // Progression du rafraîchissement des fiches (pourcentage)
    this._hass.connection
      .subscribeEvents((ev) => this._onRefreshProgress(ev.data || {}), `${DOMAIN}_refresh_progress`)
      .then((u) => { if (this.isConnected) this._unsubs.push(u); else u(); });
  }

  _onRefreshProgress(data) {
    const { done = 0, total = 0, finished = false } = data;
    if (!total) return;
    const pct = Math.round((done / total) * 100);
    // La barre s'affiche dans une zone dédiée sous l'en-tête de la carte
    // (les options sont désormais une fenêtre, fermée pendant l'opération).
    let bar = this.shadowRoot.getElementById("refresh-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "refresh-progress";
      bar.className = "refresh-progress";
      bar.innerHTML = `<div class="rp-label"></div><div class="rp-track"><div class="rp-fill"></div></div>`;
      const zone = this.shadowRoot.getElementById("refresh-progress-zone");
      (zone || this.shadowRoot).appendChild(bar);
    }
    bar.querySelector(".rp-label").textContent = `♻️ Complétion des fiches… ${done}/${total} (${pct} %)`;
    bar.querySelector(".rp-fill").style.width = `${pct}%`;
    if (finished) {
      bar.querySelector(".rp-label").textContent = `✓ Fiches complétées (${total})`;
      // v7.0.1 : affiche le % du budget quotidien de tokens consommé à la fin
      (async () => {
        try {
          const r = await this._hass.connection.sendMessagePromise({ type: "millesime/ai_usage" });
          const u = r?.usage || {};
          const tot = (u.prompt || 0) + (u.output || 0);
          const pctTok = Math.min(100, Math.round((tot / GEMINI_FREE_TIER_DAILY_BUDGET) * 100));
          bar.querySelector(".rp-label").textContent =
            `✓ Fiches complétées (${total}) · ${tot.toLocaleString("fr-FR")} tokens aujourd'hui (${pctTok} % du budget)`;
        } catch (e) { /* le compteur ne doit pas gêner la fin d'opération */ }
      })();
      setTimeout(() => bar.remove(), 5000);
    }
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

  async _searchWine(query, context = null) {
    try {
      const msg = { type: "millesime/search_wine", query };
      if (context && Object.keys(context).length) msg.context = context;   // v7.1.9
      return await this._hass.connection.sendMessagePromise(msg);
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
      overlay.style.setProperty('--fs-base',  this._fsModalCss || ((this._fsBase || 14) + 'px'));
      overlay.style.fontFamily = this._fontSans || "'Inter', sans-serif";
      overlay.style.fontSize   = this._fsModalCss || ((this._fsBase || 14) + 'px');
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
      // Cases à cocher supplémentaires (v7.0.0) : opts.checkboxes = [{key, label, checked}]
      const extraChecks = [];
      if (Array.isArray(opts.checkboxes)) {
        for (const c of opts.checkboxes) {
          const lbl2 = document.createElement("label");
          lbl2.style.cssText = "display:flex;align-items:center;gap:8px;margin:0 0 14px;cursor:pointer;font-size:0.95em";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!c.checked;
          lbl2.append(cb, document.createTextNode(c.label));
          box.append(lbl2);
          extraChecks.push({ key: c.key, el: cb });
        }
      }
      const done = val => { overlay.remove(); resolve(val); };
      cancel.onclick = () => done(false);
      ok.onclick = () => {
        if (!check && !extraChecks.length) { done(true); return; }
        const out = {};
        if (check) out.checked = check.checked;
        for (const c of extraChecks) out[c.key] = c.el.checked;
        done(out);
      };
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
    // v7.1.5 : timeout = panne passagère (repli OFF possible) → avertissement ;
    // no_model = vraie erreur de configuration de la clé → erreur
    const level = ["quota_exceeded", "service_unavailable", "timeout", "truncated"].includes(error)
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
    // v7.0.1 / v7.1.2 : ouvrir une fiche de vin quitte TOUTE surbrillance en
    // cours — la localisation d'une bouteille (_selected) ET le filtre d'occasion
    // (_occasionFilter, qui grise les bouteilles hors occasion). C'était la seule
    // vue sans porte de sortie évidente.
    if (type === "detail" && (this._selected || this._occasionFilter)) {
      this._selected = null;
      this._occasionFilter = "";
      this._render();
    }
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
    overlay.style.setProperty('--fs-base',    this._fsModalCss || ((this._fsBase || 14) + 'px'));
    overlay.style.fontFamily = this._fontSans || "'Inter', sans-serif";
    overlay.style.fontSize   = this._fsModalCss || ((this._fsBase || 14) + 'px');
    const box = document.createElement("div");
    box.className = "mm-box" + ((type === "bottlelist" || type === "racklist") ? " mm-box-wide" : "");

    if (type === "rack")     box.innerHTML = this._rackFormHTML(opts.rack);
    if (type === "bottle")    box.innerHTML = this._bottleFormHTML(opts.wine, opts.slot);
    if (type === "detail")    box.innerHTML = this._detailHTML(opts.wine);
    if (type === "duplicate") box.innerHTML = this._addSlotFormHTML(opts.wine);
    if (type === "history")   box.innerHTML = this._historyHTML();
    if (type === "drink")     box.innerHTML = this._drinkFormHTML(opts.wine);
    if (type === "slotedit")  box.innerHTML = this._slotEditHTML(opts.wine, opts.slotIdx);
    if (type === "removepick") box.innerHTML = this._removePickHTML(opts.wine);
    if (type === "journal")   box.innerHTML = this._journalHTML();
    if (type === "search")    box.innerHTML = this._searchModalHTML();
    if (type === "bottlelist") box.innerHTML = this._bottleListHTML();
    if (type === "racklist")  box.innerHTML = this._rackListHTML();
    if (type === "openpage")  box.innerHTML = this._openPageHTML();
    if (type === "options")   box.innerHTML = this._optionsHTML();
    if (type === "custom")    box.innerHTML = this._customHTML();
    if (type === "moverack") box.innerHTML = this._moveRackHTML(opts.rack);
    if (type === "sensors")   box.innerHTML = this._sensorsHTML();
    if (type === "cellars")   box.innerHTML = this._cellarsHTML();
    if (type === "sommelier") box.innerHTML = this._sommelierHTML();
    if (type === "envhistory") box.innerHTML = this._envHistoryHTML(opts.entity, opts.kind);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this._modal = overlay;

    overlay.addEventListener("click", (e) => { if (e.target === overlay) this._closeModal(); });
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => this._closeModal()));

    if (type === "rack")     this._bindRackForm(box, opts.rack);
    if (type === "bottle")    this._bindBottleForm(box, opts.wine, opts.slot);
    if (type === "detail")    this._bindDetailButtons(box, opts.wine);
    if (type === "detail")    this._bindGloss(box);   // glossaires ℹ️ arômes/structure (v7.1.0)
    if (type === "duplicate") this._bindAddSlotForm(box, opts.wine);
    if (type === "slotedit")  this._bindSlotEdit(box, opts.wine, opts.slotIdx);
    if (type === "removepick") this._bindRemovePick(box, opts.wine);
    if (type === "history") {
      this._bindHistory(box);
    }
    if (type === "drink")     this._bindDrinkForm(box, opts.wine);
    if (type === "journal")   this._bindJournal(box);
    if (type === "cellars")   this._bindCellars(box);
    if (type === "sommelier") this._bindSommelier(box);
    if (type === "search")    this._bindSearchModal(box);
    if (type === "bottlelist") this._bindBottleList(box);
    if (type === "racklist")  this._bindRackList(box);
    if (type === "openpage")  this._bindOpenPage(box);
    if (type === "options")   this._bindOptionsModal(box);
    if (type === "custom")    this._bindCustomModal(box);
    if (type === "moverack") this._bindMoveRack(box, opts.rack);
    if (type === "sensors")   this._bindSensors(box);
    if (type === "envhistory") this._bindEnvHistory(box, opts.entity, opts.kind);
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
            <option value="semi_lying"     ${rack?.layout === "semi_lying"     ? "selected" : ""}>Semi-couché</option>
            <option value="stacked"        ${rack?.layout === "stacked"        ? "selected" : ""}>Superposition</option>
          </select>
          <div class="mm-hint" id="fl-layout-hint"></div>
        </div>
        <div class="mm-field" id="fl-levels-field" style="display:${rack?.layout === "stacked" ? "block" : "none"}">
          <label class="mm-label">Niveaux par clayette</label>
          <select class="mm-input" id="fl-levels">
            ${[2, 3, 4].map(n => `<option value="${n}" ${(rack?.levels || 2) === n ? "selected" : ""}>${n} niveaux</option>`).join("")}
          </select>
          <div class="mm-hint">Les bouteilles s'empilent sur chaque clayette. Capacité = colonnes × étagères × niveaux.</div>
        </div>
        <div class="mm-field">
          <label class="mm-label" id="fl-orient-label">Orientation</label>
          <select class="mm-input" id="fl-orientation">
            <option value="punt" ${(rack?.orientation || "punt") === "punt" ? "selected" : ""}>Piqûre (cul) devant</option>
            <option value="neck" ${rack?.orientation === "neck" ? "selected" : ""}>Goulot devant</option>
          </select>
          <div class="mm-hint" id="fl-orient-hint"></div>
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
      const orientation = box.querySelector("#fl-orientation").value;
      const levels = layout === "stacked"
        ? (parseInt(box.querySelector("#fl-levels")?.value) || 2) : 1;
      if (rack) {
        await this._callService("update_rack", { rack_id: rack.id, name, columns: cols, shelves, layout, levels, orientation, style });
      } else {
        await this._callService("add_rack", { cellar_id: this._cellarId || undefined, name, columns: cols, shelves, layout, levels, orientation, slots: cols * shelves * levels, style });
      }
    });

    // Textes informatifs dynamiques (disposition + libellé/aide orientation)
    const LAYOUT_HINTS = {
      side_by_side:   "Toutes les bouteilles dans le même sens, alignées côte à côte.",
      alternating:    "Une bouteille sur deux est retournée (sens inversé) au fil des emplacements.",
      alternating_2d: "Alternance en damier : aucune voisine (haut/bas/gauche/droite) n'a le même sens. Imbrication optimale.",
      quinconce:      "Rangs décalés d'une demi-bouteille, façon nid d'abeille : gain de place maximal.",
      semi_lying:     "Bouteilles couchées et inclinées (~32°), une extrémité posée et l'autre relevée vers l'arrière, comme sur une clayette en pente.",
      stacked:        "Bouteilles empilées en 2 à 4 niveaux sur chaque clayette, comme dans les caves à forte densité.",
    };
    const layoutSel = box.querySelector("#fl-layout");
    const orientSel = box.querySelector("#fl-orientation");
    const lblOrient = box.querySelector("#fl-orient-label");
    const hintL = box.querySelector("#fl-layout-hint");
    const hintO = box.querySelector("#fl-orient-hint");
    const isAlt = (v) => v === "alternating" || v === "alternating_2d" || v === "quinconce";
    const levelsField = box.querySelector("#fl-levels-field");
    const refresh = () => {
      const v = layoutSel.value;
      if (hintL) hintL.textContent = LAYOUT_HINTS[v] || "";
      if (levelsField) levelsField.style.display = v === "stacked" ? "block" : "none";
      // Pour les dispositions tête-bêche, l'orientation pilote par quoi on COMMENCE
      const alt = isAlt(v);
      if (lblOrient) lblOrient.textContent = alt ? "Première bouteille" : "Orientation";
      const opts = orientSel.querySelectorAll("option");
      if (alt) {
        opts[0].textContent = "Commencer par la piqûre (cul)";
        opts[1].textContent = "Commencer par le goulot";
        if (hintO) hintO.textContent = "Définit le sens de la 1ʳᵉ bouteille ; l'alternance suit.";
      } else if (v === "semi_lying") {
        opts[0].textContent = "Piqûre (cul) en bas";
        opts[1].textContent = "Goulot en bas";
        if (hintO) hintO.textContent = "Extrémité posée en bas ; l'autre est relevée vers l'arrière.";
      } else {
        opts[0].textContent = "Piqûre (cul) devant";
        opts[1].textContent = "Goulot devant";
        if (hintO) hintO.textContent = "Sens commun à toutes les bouteilles du casier.";
      }
    };
    layoutSel?.addEventListener("change", refresh);
    refresh();
  }

  // ── HTML formulaire bouteille ──────────────────────────────────────────────────

  // ── Contradictions IA vs saisie (v7.1.9) ──────────────────────────────────
  // Jusqu'ici, un résultat Gemini ÉCRASAIT silencieusement ce que l'utilisateur
  // avait saisi. Or l'IA se trompe parfois de cuvée : on compare donc, et on
  // rend la main dès qu'un écart est significatif. Les champs vides sont
  // complétés sans rien demander — c'est justement le but de la recherche.
  _CONFLICT_FIELDS = [
    { id: "bt-vintage",     key: "vintage",     label: "Millésime",   icon: "📅", strong: true },
    { id: "bt-name",        key: "name",        label: "Nom du vin",  icon: "🍷" },
    { id: "bt-producer",    key: "producer",    label: "Producteur",  icon: "🏛️" },
    { id: "bt-appellation", key: "appellation", label: "Appellation", icon: "🏷️" },
    { id: "bt-region",      key: "region",      label: "Région",      icon: "🌍" },
    { id: "bt-country",     key: "country",     label: "Pays",        icon: "🗺️" },
    { id: "bt-price",       key: "price",       label: "Prix",        icon: "💶", price: true },
  ];

  // Deux textes sont « équivalents » si seules la casse, les accents ou la
  // ponctuation les séparent — inutile de déranger l'utilisateur pour ça.
  _sameText(a, b) {
    const n = (s) => String(s ?? "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // accents retirés d'abord
      .replace(/[^a-z0-9]+/g, " ")                        // ponctuation → espace
      .replace(/\bch\b|\bchat\b|\bchateau\b/g, "chateau")  // « Ch. » ≡ « Château »
      .replace(/\bdom\b|\bdomaine\b/g, "domaine")
      .replace(/\s+/g, " ").trim();
    return n(a) === n(b);
  }

  _detectConflicts(box, w) {
    const conflicts = [], filled = [];
    for (const f of this._CONFLICT_FIELDS) {
      const el = box.querySelector(`#${f.id}`);
      if (!el) continue;
      const mine = String(el.value ?? "").trim();
      const theirs = String(w[f.key] ?? "").trim();
      if (!theirs || theirs === "0") continue;          // l'IA n'a rien à proposer
      if (!mine) { filled.push(f.label); continue; }    // champ vide → on complète
      if (f.price) {
        const a = parseFloat(mine.replace(",", ".")), b = parseFloat(theirs);
        if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) continue;
        const gap = Math.abs(b - a) / a;
        // Seuil de 30 % : un écart de prix marqué signale souvent une AUTRE cuvée
        if (gap >= 0.30) conflicts.push({ ...f, mine, theirs, gap: Math.round(gap * 100) });
        continue;
      }
      if (!this._sameText(mine, theirs)) conflicts.push({ ...f, mine, theirs });
    }
    return { conflicts, filled };
  }

  _conflictHTML(w, conflicts, filled) {
    const title = esc(w.name || "") + (w.vintage ? " " + esc(w.vintage) : "");
    return `
      <div class="mm-header">
        <span class="mm-title">⚖️ Vérifier la proposition</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="cf-intro">
          L'IA propose <b>${title}</b>.
          ${conflicts.length} information${conflicts.length > 1 ? "s diffèrent" : " diffère"} de votre saisie —
          choisissez ce qu'il faut garder.
        </div>
        ${filled.length ? `<div class="cf-ok">✓ ${filled.length} champ${filled.length > 1 ? "s vides ont" : " vide a"}
          été complété${filled.length > 1 ? "s" : ""} sans conflit (${esc(filled.join(", "))}).</div>` : ""}
        ${conflicts.map((c, i) => `
          <div class="cf-row" data-i="${i}">
            <div class="cf-lbl">${c.icon} ${esc(c.label)}</div>
            <div class="cf-opts">
              <button type="button" class="cf-opt sel" data-pick="mine">
                <span class="cf-t">Votre saisie</span>
                <span class="cf-v">${esc(c.mine)}${c.price ? " €" : ""}</span>
              </button>
              <button type="button" class="cf-opt" data-pick="theirs">
                <span class="cf-t">Proposition IA</span>
                <span class="cf-v">${esc(c.theirs)}${c.price ? " €" : ""}</span>
              </button>
            </div>
            ${c.strong ? `<div class="cf-flag">⚠️ Millésime différent — souvent le signe d'une autre bouteille.</div>` : ""}
            ${c.price ? `<div class="cf-flag">⚠️ Écart de ${c.gap} % — il s'agit peut-être d'une autre cuvée.</div>` : ""}
          </div>`).join("")}
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" id="cf-keep">Garder toutes mes saisies</button>
        <button class="mm-btn mm-btn-primary" id="cf-apply">Valider mes choix</button>
      </div>`;
  }

  // Ouvre l'écran de vérification PAR-DESSUS le formulaire (v7.1.9) : le
  // formulaire reste intact dessous, on n'y touche qu'après décision.
  _openConflict(box, w, conflicts, filled) {
    const host = box.getRootNode?.() || document;
    const prev = host.querySelector?.(".cf-overlay");
    prev?.remove();
    const ov = document.createElement("div");
    ov.className = "cf-overlay";
    ov.innerHTML = `<div class="cf-box mm-box">${this._conflictHTML(w, conflicts, filled)}</div>`;
    (box.parentNode || document.body).appendChild(ov);

    const picks = conflicts.map(() => "mine");        // saisie utilisateur par défaut
    ov.querySelectorAll(".cf-row").forEach((row, i) => {
      row.querySelectorAll(".cf-opt").forEach((opt) =>
        opt.addEventListener("click", () => {
          row.querySelectorAll(".cf-opt").forEach(o => o.classList.remove("sel"));
          opt.classList.add("sel");
          picks[i] = opt.dataset.pick;
        }));
    });
    const close = () => ov.remove();
    ov.querySelector("[data-close]")?.addEventListener("click", close);
    ov.querySelector("#cf-keep")?.addEventListener("click", close);
    ov.querySelector("#cf-apply")?.addEventListener("click", () => {
      conflicts.forEach((c, i) => {
        if (picks[i] !== "theirs") return;
        const el = box.querySelector(`#${c.id}`);
        if (el) el.value = c.theirs;
      });
      box._mmSyncPickers?.();   // v7.1.10 : menus alignés après arbitrage
      close();
      this._showToast("success", "Fiche mise à jour ✓");
    });
  }

  // ── Menu déroulant + saisie libre (v7.1.10) ───────────────────────────────
  // Les listes de suggestions de la 7.1.9 n'offraient AUCUN repère visuel :
  // rien n'indiquait qu'un référentiel existait, et il fallait deviner qu'il
  // fallait taper pour voir des propositions. On rend donc un VRAI menu
  // déroulant (molette native sur mobile), doublé d'une option « Autre » qui
  // révèle un champ texte — la saisie libre reste possible pour une appellation
  // ou un cépage absent du référentiel.
  // L'identifiant reste porté par l'INPUT : la lecture du formulaire, le
  // remplissage par l'IA et la détection des contradictions fonctionnent sans
  // aucun changement.
  _pickerHTML(id, value, options, placeholder, label) {
    const v = String(value || "");
    const known = options.includes(v);
    const custom = !!v && !known;
    return `
      <label class="mm-label">${label}</label>
      <select class="mm-input mm-pick" id="${id}-sel">
        <option value="">— ${esc(placeholder)} —</option>
        ${options.map(o => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}
        <option value="__other__"${custom ? " selected" : ""}>✏️ Autre (saisir)…</option>
      </select>
      <input class="mm-input mm-pick-free" id="${id}" autocomplete="off"
        value="${esc(v)}" placeholder="${esc(placeholder)}"
        style="margin-top:6px${custom ? "" : ";display:none"}">`;
  }

  // Relie un menu à son champ. Retourne une fonction de rafraîchissement, pour
  // les listes en cascade (le pays filtre les régions, la région les appellations).
  _bindPicker(box, id, getOptions, placeholder, onChange) {
    const sel = box.querySelector(`#${id}-sel`);
    const inp = box.querySelector(`#${id}`);
    if (!sel || !inp) return () => {};

    const refresh = () => {
      const opts = getOptions() || [];
      const cur = String(inp.value || "");
      const known = opts.includes(cur);
      sel.innerHTML =
        `<option value="">— ${esc(placeholder)} —</option>` +
        opts.map(o => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("") +
        `<option value="__other__"${cur && !known ? " selected" : ""}>✏️ Autre (saisir)…</option>`;
      inp.style.display = (cur && !known) ? "" : "none";
    };

    sel.addEventListener("change", () => {
      if (sel.value === "__other__") {
        inp.style.display = ""; inp.value = ""; inp.focus();
      } else {
        inp.value = sel.value; inp.style.display = "none";
      }
      onChange?.();
    });
    inp.addEventListener("change", () => onChange?.());
    return refresh;
  }

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
            <input type="file" id="photo-input" accept="image/*" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;overflow:hidden">
            <input type="file" id="photo-input-cam" accept="image/*" capture="environment" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;overflow:hidden">
          </div>
          <div id="search-banner"></div>
          <div id="viv-results" class="mm-viv-results"></div>
          <!-- v7.1.9 : identification À PARTIR DES CHAMPS déjà remplis. Sans ce
               bouton, un utilisateur dont le scan a échoué mais qui connaît son
               appellation n'avait aucun moyen de relancer l'IA. -->
          <button class="mm-btn-identify" id="bt-identify" type="button">
            🔍 Identifier avec mes infos
          </button>
          <div class="mm-idhint">Renseignez ce que vous savez (appellation, producteur, millésime…) :
            l'IA s'appuie dessus pour trouver le bon vin et compléter le reste.</div>
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
            <select class="mm-input" id="bt-size">
              ${BOTTLE_SIZES.map(([val, lbl]) =>
                `<option value="${val}" ${(b.size || "75cl") === val ? "selected" : ""}>${lbl}</option>`).join("")}
            </select>
          </div>
          <div class="mm-field">
            <label class="mm-label">Coup de cœur</label>
            <button type="button" id="bt-favorite" class="mm-fav${b.favorite ? " on" : ""}"
              title="Coup de cœur" aria-pressed="${b.favorite ? "true" : "false"}">${b.favorite ? "★" : "☆"}</button>
          </div>
        </div>
        <div class="mm-field">
          <label class="mm-label">Forme de la bouteille</label>
          <select class="mm-input" id="bt-shape">
            <option value="" ${!b.shape ? "selected" : ""}>Automatique (IA / type de vin)</option>
            ${BOTTLE_SHAPE_LABELS.map(([val, lbl]) =>
              `<option value="${val}" ${b.shape === val ? "selected" : ""}>${lbl}</option>`).join("")}
          </select>
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
            <input class="mm-input" id="bt-producer" list="dl-producer" autocomplete="off"
              value="${esc(b.producer || "")}" placeholder="Domaine...">
            <datalist id="dl-producer">
              ${this._producerSuggestions().map(n => `<option value="${esc(n)}"></option>`).join("")}
            </datalist>
          </div>
          <div class="mm-field">
            ${this._pickerHTML("bt-appellation", b.appellation,
              wwAppellations(b.country || "", b.region || ""), "Appellation", "Appellation")}
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
        <div class="mm-field" id="bt-gift-field" style="${(b.event === "gift") ? "" : "display:none"}">
          <label class="mm-label">🎁 De la part de</label>
          <input class="mm-input" id="bt-gifted-by" list="bt-donors" autocomplete="off"
            value="${esc(b.gifted_by || "")}" placeholder="Qui vous a offert cette bouteille ?">
          <datalist id="bt-donors">
            ${this._donorSuggestions().map(n => `<option value="${esc(n)}"></option>`).join("")}
          </datalist>
        </div>

        <div class="mm-field">
          <label class="mm-label">Notes personnelles</label>
          <textarea class="mm-input mm-textarea" id="bt-notes"
            placeholder="Impressions, occasion...">${esc(b.notes || "")}</textarea>
        </div>

        <!-- Photo de la bouteille (prise / galerie / URL) -->
        <div class="mm-field">
          <label class="mm-label">📷 Photo de la bouteille</label>
          <div class="mm-photo-box" id="bt-photo-box">
            <div class="mm-photo-thumb ${b.image_url ? "" : "empty"}" id="bt-photo-thumb">
              ${b.image_url ? `<img src="${esc(b.image_url)}" alt="">` : `<span class="mm-photo-ph">Aucune photo</span>`}
            </div>
            <div class="mm-photo-actions">
              <button type="button" class="mm-photo-btn" id="bt-photo-cam">📷 Photo</button>
              <button type="button" class="mm-photo-btn" id="bt-photo-pick">🖼️ Galerie</button>
              <button type="button" class="mm-photo-btn mm-photo-btn-rm ${b.image_url ? "" : "hidden"}" id="bt-photo-rm">🗑️ Retirer</button>
            </div>
          </div>
          <input type="file" id="bt-photo-file" accept="image/*" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
          <input type="file" id="bt-photo-file-cam" accept="image/*" capture="environment" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
          <input class="mm-input mm-photo-url" id="bt-photo-url" placeholder="… ou coller un lien d'image (https://…)" autocomplete="off" value="${(b.image_url && /^https?:/i.test(b.image_url)) ? esc(b.image_url) : ""}">
          <div class="mm-photo-hint">La photo prise pour scanner l'étiquette devient aussi la photo affichée.</div>
        </div>

        <!-- v7.1.9 : ORIGINE — ces champs étaient cachés et remplis par l'IA
             seulement. Ils sont désormais saisissables, avec un référentiel
             mondial en cascade (pays → région → appellation). -->
        <div class="mm-section-title">🌍 Origine</div>
        <div class="mm-row">
          <div class="mm-field">
            ${this._pickerHTML("bt-country", b.country, wwCountries(), "Pays", "Pays")}
          </div>
          <div class="mm-field">
            ${this._pickerHTML("bt-region", b.region, wwRegions(b.country || ""), "Région", "Région")}
          </div>
        </div>
        <div class="mm-idhint" style="margin:-4px 0 10px">Choisir une appellation (plus haut)
          renseigne automatiquement la région et le pays.</div>
        <!-- v7.1.9 : CÉPAGES — nouveau champ, plusieurs valeurs possibles -->
        <div class="mm-section-title">🍇 Cépages</div>
        <div class="mm-field">
          <select class="mm-input mm-pick" id="bt-grape-sel">
            <option value="">— Ajouter un cépage (assemblages possibles) —</option>
            ${WINE_GRAPES.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}
            <option value="__other__">✏️ Autre (saisir)…</option>
          </select>
          <input class="mm-input" id="bt-grape-pick" autocomplete="off" placeholder="Nom du cépage, puis Entrée"
            style="margin-top:6px;display:none">
          <div class="mm-chips" id="bt-grape-chips"></div>
          <input type="hidden" id="bt-grapes" value="${esc(b.grapes || "")}">
        </div>

        <!-- v7.1.9 : DÉGUSTATION — également cachés auparavant -->
        <div class="mm-section-title">👃 Dégustation</div>
        <div class="mm-field">
          <label class="mm-label">Notes de dégustation</label>
          <input class="mm-input" id="bt-tasting" value="${esc(b.tasting_notes || "")}"
            placeholder="Fruits noirs, tanins soyeux…">
        </div>
        <div class="mm-field">
          <label class="mm-label">Accords mets-vins</label>
          <input class="mm-input" id="bt-pairing" value="${esc(b.food_pairing || "")}"
            placeholder="Viandes rouges, fromages affinés">
        </div>

        <!-- URL techniques : restent cachées (non saisissables par nature) -->
        <input type="hidden" id="bt-image_url"   value="${esc(b.image_url  || "")}">
        <input type="hidden" id="bt-vivino_url"  value="${esc(b.vivino_url || "")}">
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="bt-submit">
          ${isEdit ? "Enregistrer" : "Ajouter à la cave"}
        </button>
      </div>`;
  }

  _bindBottleForm(box, wine, pendingSlot) {
    // ── v7.1.9 : cascade Pays → Région → Appellation ────────────────────────
    // Les listes proposées sont filtrées par le niveau supérieur (15 à 40 choix
    // au lieu de 765), et la déduction inverse remplit automatiquement les
    // niveaux parents quand on choisit une appellation ou une région.
    const cEl = box.querySelector("#bt-country");
    const rEl = box.querySelector("#bt-region");
    const aEl = box.querySelector("#bt-appellation");

    // v7.1.10 : les trois niveaux sont désormais de VRAIS menus déroulants
    // (_bindPicker), chacun renvoyant sa fonction de rafraîchissement. La
    // cascade et les déductions inverses sont inchangées : seul l'affichage
    // passe de la liste de suggestions au menu.
    let refRegions = () => {}, refApps = () => {};
    const refCountry = this._bindPicker(box, "bt-country", () => wwCountries(), "Pays",
      () => { refRegions(); refApps(); });
    refRegions = this._bindPicker(box, "bt-region",
      () => wwRegions((cEl?.value || "").trim()), "Région", () => {
        const c = wwCountryOfRegion((rEl?.value || "").trim());
        if (c && cEl && !cEl.value.trim()) { cEl.value = c; refCountry(); }  // déduction du pays
        refApps();
      });
    refApps = this._bindPicker(box, "bt-appellation",
      () => wwAppellations((cEl?.value || "").trim(), (rEl?.value || "").trim()), "Appellation", () => {
        const res = wwResolve((aEl?.value || "").trim());
        if (!res) return;
        if (rEl && !rEl.value.trim()) { rEl.value = res.region; }   // déduction de la région
        if (cEl && !cEl.value.trim()) { cEl.value = res.country; } // puis du pays
        refCountry(); refRegions();
      });
    refCountry(); refRegions(); refApps();
    // Rafraîchit les menus après un remplissage par l'IA (les valeurs changent
    // sans interaction utilisateur : sans cela le menu resterait désynchronisé)
    box._mmSyncPickers = () => { refCountry(); refRegions(); refApps(); };

    // ── v7.1.9 : cépages multiples (étiquettes retirables) ──────────────────
    const gHidden = box.querySelector("#bt-grapes");
    const gChips  = box.querySelector("#bt-grape-chips");
    const gPick   = box.querySelector("#bt-grape-pick");
    const grapes = (gHidden?.value || "").split(",").map(s => s.trim()).filter(Boolean);
    const renderGrapes = () => {
      if (gHidden) gHidden.value = grapes.join(", ");
      if (!gChips) return;
      gChips.innerHTML = grapes.map((g, i) =>
        `<span class="mm-chip"><b>${esc(g)}</b><span class="mm-chip-x" data-i="${i}">✕</span></span>`).join("");
      gChips.querySelectorAll(".mm-chip-x").forEach(x =>
        x.addEventListener("click", () => { grapes.splice(parseInt(x.dataset.i), 1); renderGrapes(); }));
    };
    const addGrape = () => {
      const v = (gPick?.value || "").trim();
      if (!v) return;
      // doublon insensible à la casse
      if (!grapes.some(g => g.toLowerCase() === v.toLowerCase())) grapes.push(v);
      if (gPick) gPick.value = "";
      renderGrapes();
    };
    gPick?.addEventListener("change", addGrape);
    gPick?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addGrape(); } });
    // v7.1.10 : le menu ajoute directement le cépage choisi ; « Autre » ouvre la
    // saisie libre pour un cépage absent du référentiel.
    const gSel = box.querySelector("#bt-grape-sel");
    gSel?.addEventListener("change", () => {
      if (gSel.value === "__other__") {
        if (gPick) { gPick.style.display = ""; gPick.value = ""; gPick.focus(); }
      } else if (gSel.value) {
        if (gPick) { gPick.value = gSel.value; gPick.style.display = "none"; }
        addGrape();
      }
      gSel.value = "";                     // le menu revient à son invite
    });
    renderGrapes();

    let searchTimer;
    const qInput   = box.querySelector("#viv-query");
    const results  = box.querySelector("#viv-results");
    const imgWrap  = box.querySelector("#viv-img-preview");
    const banner   = box.querySelector("#search-banner");
    const btnPhoto = box.querySelector("#btn-photo");
    const fileInput= box.querySelector("#photo-input");
    const fileInputCam = box.querySelector("#photo-input-cam");

    // Champ « De la part de » visible uniquement si l'événement = Cadeau
    const evSel = box.querySelector("#bt-event");
    const giftField = box.querySelector("#bt-gift-field");
    evSel?.addEventListener("change", () => {
      if (giftField) giftField.style.display = evSel.value === "gift" ? "" : "none";
    });

    // ── Photo de la bouteille : preview + prise/galerie + URL + retrait ──
    const photoHidden = box.querySelector("#bt-image_url");
    const photoThumb  = box.querySelector("#bt-photo-thumb");
    const photoFile   = box.querySelector("#bt-photo-file");
    const photoUrl    = box.querySelector("#bt-photo-url");
    const photoRm     = box.querySelector("#bt-photo-rm");
    const setPhoto = (src) => {
      if (photoHidden) photoHidden.value = src || "";
      if (photoThumb) {
        photoThumb.classList.toggle("empty", !src);
        photoThumb.innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<span class="mm-photo-ph">Aucune photo</span>`;
      }
      if (photoRm) photoRm.classList.toggle("hidden", !src);
    };
    // « Photo » ouvre l'appareil photo, « Galerie » le sélecteur classique.
    // DEUX inputs statiques distincts : l'attribut capture doit être présent dès la
    // création de l'input (les WebView Android ignorent un setAttribute dynamique
    // et ouvraient la pellicule à la place de l'appareil photo).
    const photoFileCam = box.querySelector("#bt-photo-file-cam");
    box.querySelector("#bt-photo-cam")?.addEventListener("click", async () => {
      // v7.0.1 : la caméra directe (getUserMedia) est TOUJOURS tentée en
      // premier — _captureViaCamera explique lui-même pourquoi si elle échoue
      const shot = await this._captureViaCamera();
      if (shot instanceof File) { onPhotoFile(shot); return; }
      if (shot === "cancel") return;
      photoFileCam?.click();   // repli : input statique avec capture
    });
    box.querySelector("#bt-photo-pick")?.addEventListener("click", () => photoFile?.click());
    // Accepte un <input type=file> ou directement un File (modal caméra)
    const onPhotoFile = async (inp) => {
      const file = inp instanceof File ? inp : inp.files?.[0];
      if (!file) return;
      try {
        const compressed = await this._compressImage(file);
        setPhoto(compressed);
        if (photoUrl) photoUrl.value = "";   // on privilégie la photo prise
        this._showToast("success", "Photo ajoutée");
      } catch (e) {
        this._showToast("error", "Impossible de lire cette image");
      }
      if (!(inp instanceof File)) inp.value = "";   // permet de reprendre la même photo ensuite
    };
    photoFile?.addEventListener("change", () => onPhotoFile(photoFile));
    photoFileCam?.addEventListener("change", () => onPhotoFile(photoFileCam));
    photoUrl?.addEventListener("change", () => {
      const v = (photoUrl.value || "").trim();
      if (v && /^https?:/i.test(v)) setPhoto(v);
      else if (!v) setPhoto("");
    });
    photoRm?.addEventListener("click", () => { setPhoto(""); if (photoUrl) photoUrl.value = ""; });

    // ── Auto-remplissage depuis un résultat ──────────────────────────────────
    // v7.1.9 : applique un résultat SANS écraser une saisie divergente. Les
    // champs vides sont complétés ; les écarts significatifs passent par
    // l'écran de vérification (_conflictHTML) où l'utilisateur tranche.
    const fillFrom = (w, force = false) => {
      const protectedIds = force ? new Set() : new Set(
        this._detectConflicts(box, w).conflicts.map(c => c.id));
      const set = (id, val) => {
        if (protectedIds.has(id)) return;          // conflit → laissé à l'utilisateur
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
      // N'écrase l'image que si l'utilisateur n'a pas déjà mis sa propre photo
      const imgEl = box.querySelector("#bt-image_url");
      if (imgEl && !imgEl.value && w.image_url) {
        imgEl.value = w.image_url;
        const th = box.querySelector("#bt-photo-thumb");
        const rm = box.querySelector("#bt-photo-rm");
        if (th) { th.classList.remove("empty"); th.innerHTML = `<img src="${esc(w.image_url)}" alt="">`; }
        if (rm) rm.classList.remove("hidden");
      }
      set("bt-vivino_url",  w.vivino_url  || "");
      set("bt-region",      w.region      || "");
      set("bt-country",     w.country     || "");
      set("bt-tasting",     w.tasting_notes || "");
      set("bt-pairing",     w.food_pairing  || "");
      if (w.grapes) { set("bt-grapes", w.grapes); box.dispatchEvent(new CustomEvent("mm-grapes-changed")); }
      box._mmSyncPickers?.();   // v7.1.10 : menus alignés sur les valeurs reçues
      const typeEl = box.querySelector("#bt-type");
      if (typeEl && w.type) typeEl.value = w.type;
      const shapeEl = box.querySelector("#bt-shape");
      if (shapeEl && w.shape) shapeEl.value = w.shape;   // forme détectée par Gemini
      results.innerHTML = "";
      results.style.display = "none";
      if (w.image_url) {
        imgWrap.innerHTML = `<img src="${esc(w.image_url)}"
          style="width:56px;display:block;margin:0 auto 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.5)">`;
      }
      if (!force) {
        const { conflicts, filled } = this._detectConflicts(box, w);
        if (conflicts.length) this._openConflict(box, w, conflicts, filled);
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
        const level = ["quota_exceeded", "service_unavailable", "timeout", "truncated"].includes(error) ? "warning" : "error";
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
        const response = await this._searchWine(q, this._formContext(box));   // v7.1.9
        showResults(response);
      }, 600);
    });

    // ── v7.1.9 : « Identifier avec mes infos » ───────────────────────────────
    // Part des CHAMPS remplis plutôt que du texte de recherche. Réponse au cas
    // remonté : scan infructueux, mais l'utilisateur connaît son appellation.
    box.querySelector("#bt-identify")?.addEventListener("click", async () => {
      const ctx = this._formContext(box);
      const q = [ctx.name, ctx.producer, ctx.appellation, ctx.vintage]
        .filter(Boolean).join(" ").trim();
      if (!q) {
        this._showToast("info", "Renseignez au moins le nom, le producteur ou l'appellation.");
        return;
      }
      results.style.display = "block";
      results.innerHTML = `<div class="mm-viv-loading"><span class="mm-spinner"></span> Identification en cours…</div>`;
      const response = await this._searchWine(q, ctx);
      showResults(response);
    });

    // ── Scan photo de l'étiquette ─────────────────────────────────────────────
    // Scan d'étiquette : sur mobile, proposer l'appareil photo direct ou la galerie.
    // Sur PC (souris), comportement inchangé : sélecteur de fichiers direct.
    btnPhoto?.addEventListener("click", () => {
      if (this._lastPT !== "touch") {
        fileInput?.click();   // PC : sélecteur de fichiers direct
        return;
      }
      banner.innerHTML = `
        <div class="mm-scan-choice">
          <button type="button" class="mm-scan-btn" id="scan-cam">📷 Prendre une photo</button>
          <button type="button" class="mm-scan-btn" id="scan-lib">🖼️ Galerie</button>
        </div>`;
      banner.querySelector("#scan-cam")?.addEventListener("click", async () => {
        banner.innerHTML = "";
        // v7.0.1 : caméra directe toujours tentée d'abord (diagnostic intégré)
        const shot = await this._captureViaCamera();
        if (shot instanceof File) { onScanFile(shot); return; }
        if (shot === "cancel") return;
        fileInputCam?.click();   // repli : input statique avec capture
      });
      banner.querySelector("#scan-lib")?.addEventListener("click", () => {
        banner.innerHTML = "";
        fileInput?.click();      // input sans capture → galerie / fichiers
      });
    });

    // Accepte un <input type=file> (parcours classique) ou directement un File
    // (photo issue du modal caméra getUserMedia)
    const onScanFile = async (inp) => {
      const file = inp instanceof File ? inp : inp.files?.[0];
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
      // La photo scannée devient aussi la photo affichée de la bouteille (compressée)
      try {
        const compressed = await this._compressImage(file);
        const ph = box.querySelector("#bt-image_url");
        const th = box.querySelector("#bt-photo-thumb");
        const rm = box.querySelector("#bt-photo-rm");
        if (ph) ph.value = compressed;
        if (th) { th.classList.remove("empty"); th.innerHTML = `<img src="${esc(compressed)}" alt="">`; }
        if (rm) rm.classList.remove("hidden");
      } catch (e) { /* la compression échoue → on garde au moins l'analyse */ }
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
      if (!(inp instanceof File)) inp.value = "";   // permet de re-scanner la même photo ensuite
    };
    fileInput?.addEventListener("change", () => onScanFile(fileInput));
    fileInputCam?.addEventListener("change", () => onScanFile(fileInputCam));

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
        shape:         box.querySelector("#bt-shape")?.value || "",
        producer:      txt("bt-producer"),
        appellation:   txt("bt-appellation"),
        region:        txt("bt-region"),
        country:       txt("bt-country"),
        grapes:        txt("bt-grapes"),          // v7.1.9 : cépages (liste séparée par virgules)
        price:         num("bt-price"),
        drink_from:    txt("bt-from"),
        drink_until:   txt("bt-until"),
        notes:         txt("bt-notes"),
        tasting_notes: txt("bt-tasting"),
        food_pairing:  txt("bt-pairing"),
        vivino_rating: num("bt-vrating"),
        event:         box.querySelector("#bt-event")?.value || "",
        gifted_by:     box.querySelector("#bt-gifted-by")?.value?.trim() || "",
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

  // ── Casiers toutes caves confondues (v7.1.8) ──────────────────────────────
  // Le déplacement d'une bouteille ne listait que les casiers de la cave
  // COURANTE : transférer un vin vers une autre cave était impossible depuis
  // l'interface, alors que le backend le permet déjà (un emplacement ne connaît
  // que son rack_id). Ces deux aides donnent accès à l'ensemble des casiers.
  _allRacks() {
    const out = [];
    for (const c of (this._data?.cellars || [])) {
      for (const r of (c.racks || [])) out.push({ ...r, _cellarName: c.name || "Cave", _cellarId: c.id });
    }
    if (!out.length) {   // repli : ancienne charge utile sans « cellars »
      for (const r of (this._data?.cellar?.racks || [])) out.push({ ...r, _cellarName: "", _cellarId: "" });
    }
    return out;
  }

  _findRack(rackId) {
    return this._allRacks().find(r => r.id === rackId) || null;
  }

  _renderSlotPicker(box, rackSelectId, pickerId, slotInputId, excludeWineId = null, multiSelect = false) {
    const rackId   = box.querySelector(`#${rackSelectId}`)?.value;
    const rack     = this._findRack(rackId);   // v7.1.8 : toutes caves
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
    // Affichage humain (1-based) : « ét. X · n°Y » (+ niveau en superposition),
    // l'étagère omise s'il n'y en a qu'une
    const pkLevels = rack.layout === "stacked" ? Math.max(1, Math.min(4, rack.levels || 1)) : 1;
    const multiShelf = (rack.shelves || Math.ceil(total / (cols * pkLevels))) > 1;
    const fmtSlot = (n) => {
      const pos = (n % cols) + 1;
      if (pkLevels > 1) {
        const vr = Math.floor(n / cols);
        return `ét. ${Math.floor(vr / pkLevels) + 1} · niv. ${(vr % pkLevels) + 1} · n°${pos}`;
      }
      return multiShelf ? `ét. ${Math.floor(n / cols) + 1} · n°${pos}` : `n°${pos}`;
    };
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
    // v7.1.8 : recherche dans TOUTES les caves — depuis que le transfert entre
    // caves est possible, une bouteille peut se trouver hors de la cave
    // affichée ; sans cela son emplacement s'affichait comme un identifiant brut.
    const rack = this._findRack(s.rack_id);
    if (!rack) return `${s.rack_id} · n°${(s.slot || 0) + 1}`;
    const cols    = rack.columns || 8;
    const levels  = rack.layout === "stacked" ? Math.max(1, Math.min(4, rack.levels || 1)) : 1;
    const shelves = rack.shelves || Math.ceil((rack.slots || cols) / (cols * levels));
    const pos = (s.slot % cols) + 1;
    let body;
    if (levels > 1) {
      // Superposition : rangée virtuelle → étagère physique + niveau (1 = haut de pile)
      const vr = Math.floor(s.slot / cols);
      const sh = Math.floor(vr / levels) + 1;
      const lv = (vr % levels) + 1;
      body = shelves > 1
        ? `${rack.name} · ét. ${sh} · niv. ${lv} · n°${pos}`
        : `${rack.name} · niv. ${lv} · n°${pos}`;
    } else {
      const sh = Math.floor(s.slot / cols) + 1;
      body = shelves > 1
        ? `${rack.name} · ét. ${sh} · n°${pos}`
        : `${rack.name} · n°${pos}`;
    }
    // Nom de cave en préfixe si la bouteille est dans une AUTRE cave que l'affichée
    const cur = this._data?.cellar?.id;
    return (rack._cellarId && cur && rack._cellarId !== cur && rack._cellarName)
      ? `${rack._cellarName} · ${body}` : body;
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

  // ── Profil aromatique (v7.0.0, refondu v7.0.1, nomenclature v7.1.0) ─────────
  // Format backend : "Fruité:45|Boisé:20|Épicé:15|…" sur les 11 SÉRIES
  // AROMATIQUES œnologiques (v7.1.0 : Empyreumatique, Fermentaire, Sous-bois,
  // Évolution remplacent Grillé, Lacté, Terreux, Tertiaire — anciens noms
  // mappés à la lecture via AROMA_LEGACY, rétro-compatibilité totale).
  // Parsé avec tolérance (ordre libre, familles inconnues ignorées, valeurs
  // bornées 0-100). Rendu au choix : radar ou barres horizontales, en SVG
  // natif — réglage dans ⚙️ Options (this._aromaMode). Depuis v7.0.1 : section
  // TOUJOURS visible sur la fiche (plus de repli), axes du radar ADAPTATIFS
  // selon la couleur du vin (AROMA_AXES_BY_TYPE) + toute famille présente,
  // couleurs du polygone reprises du type de vin.
  static AROMA_FAMILIES = ["Fruité", "Floral", "Végétal", "Minéral", "Épicé", "Boisé", "Empyreumatique", "Animal", "Fermentaire", "Sous-bois", "Évolution"];

  // v7.1.0 : rétro-compatibilité — les profils générés avant la nomenclature
  // experte utilisent les anciens noms de familles ; on les mappe à la lecture
  // pour que les fiches existantes s'affichent sans relancer l'IA.
  static AROMA_LEGACY = { "grille": "Empyreumatique", "lacte": "Fermentaire", "terreux": "Sous-bois", "tertiaire": "Évolution" };

  // v7.0.1 : axes PERTINENTS par couleur de vin — un blanc n'a pas d'axe
  // « Animal », un rouge n'a guère de « Fermentaire ». Le radar affiche les
  // axes de la couleur + toute famille non listée mais présente dans le profil.
  // v7.1.0 : nomenclature experte (séries aromatiques œnologiques).
  static AROMA_AXES_BY_TYPE = {
    red:       ["Fruité", "Boisé", "Épicé", "Végétal", "Animal", "Sous-bois", "Empyreumatique", "Évolution"],
    white:     ["Fruité", "Floral", "Minéral", "Boisé", "Végétal", "Fermentaire", "Empyreumatique", "Évolution"],
    rose:      ["Fruité", "Floral", "Minéral", "Végétal", "Épicé", "Fermentaire"],
    sparkling: ["Fruité", "Floral", "Minéral", "Empyreumatique", "Fermentaire", "Évolution"],
    dessert:   ["Fruité", "Floral", "Épicé", "Boisé", "Fermentaire", "Évolution"],
  };

  _aromaAxesFor(profile, type) {
    const base = this.constructor.AROMA_AXES_BY_TYPE[type] || this.constructor.AROMA_FAMILIES;
    // Familles hors liste mais réellement présentes (> 0) : on les ajoute pour
    // ne jamais perdre d'information sur un vin atypique
    const extra = this.constructor.AROMA_FAMILIES.filter(f => !base.includes(f) && (profile[f] || 0) > 0);
    return base.concat(extra);
  }

  _parseAromaProfile(str_) {
    if (!str_ || typeof str_ !== "string") return null;
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const fams = this.constructor.AROMA_FAMILIES;
    const byNorm = Object.fromEntries(fams.map(f => [norm(f), f]));
    // v7.1.0 : les anciens noms (Grillé, Lacté, Terreux, Tertiaire) sont mappés
    // vers la nomenclature experte — les profils existants restent lisibles
    Object.assign(byNorm, this.constructor.AROMA_LEGACY);
    const out = {};
    for (const part of str_.split(/[|,;]/)) {
      const m = part.match(/^\s*([^:%]+?)\s*[:\s]\s*(\d{1,3})\s*%?\s*$/);
      if (!m) continue;
      const fam = byNorm[norm(m[1])];
      if (fam) out[fam] = Math.max(0, Math.min(100, parseInt(m[2])));
    }
    return Object.keys(out).length >= 2 ? out : null;   // au moins 2 familles = exploitable
  }

  _aromaRadarSVG(profile, type = "red") {
    const t = WINE_TYPES[type] || WINE_TYPES.red;
    const fams = this._aromaAxesFor(profile, type);
    const C = 50, R = 32, LR = 42;                       // centre, rayon, rayon libellés
    const pt = (i, r) => {
      const a = (Math.PI * 2 * i) / fams.length - Math.PI / 2;
      return [C + r * Math.cos(a), C + r * Math.sin(a)];
    };
    // Toiles de fond (25/50/75/100 %) + rayons — grille plus discrète (v7.0.1)
    let web = "";
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const pts = fams.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(",")).join(" ");
      web += `<polygon points="${pts}" fill="none" stroke="var(--mm-border)" stroke-width="${f === 1 ? 0.45 : 0.2}" opacity="${f === 1 ? 0.9 : 0.5}"/>`;
    }
    web += fams.map((_, i) => {
      const [x, y] = pt(i, R);
      return `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--mm-border)" stroke-width="0.18" opacity="0.6"/>`;
    }).join("");
    // Polygone des valeurs (max de référence = plus grande famille, min 40 pour la lisibilité)
    const maxV = Math.max(40, ...Object.values(profile));
    const vpts = fams.map((f, i) => pt(i, R * ((profile[f] || 0) / maxV)));
    const poly = vpts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
    // Points aux sommets renseignés (v7.0.1 : lecture immédiate des pics)
    const dots = fams.map((f, i) => (profile[f] || 0) > 0
      ? `<circle cx="${vpts[i][0].toFixed(1)}" cy="${vpts[i][1].toFixed(1)}" r="1.1" fill="${t.color}" stroke="#fff" stroke-width="0.3"/>`
      : "").join("");
    // Libellés (famille + %) : plus gros, valeur en gras dans la couleur du vin
    const labels = fams.map((f, i) => {
      const v = profile[f] || 0;
      const [x, y] = pt(i, LR);
      const anchor = Math.abs(x - C) < 4 ? "middle" : (x > C ? "start" : "end");
      return `<text x="${x.toFixed(1)}" y="${(y + 1.3).toFixed(1)}" font-size="3.8" text-anchor="${anchor}"
                fill="${v ? "var(--mm-text)" : "var(--mm-muted)"}" opacity="${v ? 0.95 : 0.4}">${f}${v ? ` <tspan font-weight="bold" fill="${t.color}">${v}</tspan>` : ""}</text>`;
    }).join("");
    return `
      <svg class="aroma-svg" viewBox="-10 -5 120 110" role="img" aria-label="Profil aromatique (radar)">
        ${web}
        <polygon points="${poly}" fill="${t.glow}" stroke="${t.color}" stroke-width="1" stroke-linejoin="round"/>
        ${dots}
        ${labels}
      </svg>`;
  }

  _aromaBarsSVG(profile, type = "red") {
    const t = WINE_TYPES[type] || WINE_TYPES.red;
    const fams = this.constructor.AROMA_FAMILIES.filter(f => (profile[f] || 0) > 0)
      .sort((a, b) => (profile[b] || 0) - (profile[a] || 0));
    const ROW = 9, W = 100, LBL = 26, H = fams.length * ROW + 4;
    const maxV = Math.max(1, ...fams.map(f => profile[f]));
    const rows = fams.map((f, i) => {
      const y = 3 + i * ROW;
      const w = ((profile[f] / maxV) * (W - LBL - 12));
      return `
        <text x="${LBL - 1.5}" y="${y + 4.6}" font-size="3.5" fill="var(--mm-text)" text-anchor="end">${f}</text>
        <rect x="${LBL}" y="${y}" width="${W - LBL - 12}" height="6" rx="2" fill="var(--mm-border)" opacity="0.35"/>
        <rect x="${LBL}" y="${y}" width="${w.toFixed(1)}" height="6" rx="2" fill="${t.color}"/>
        <text x="${LBL + w + 1.5}" y="${y + 4.6}" font-size="3.4" fill="var(--mm-muted)">${profile[f]}%</text>`;
    }).join("");
    return `
      <svg class="aroma-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil aromatique (barres)"
           style="max-height:${fams.length * 26 + 12}px">${rows}</svg>`;
  }

  _aromaSectionHTML(w) {
    const profile = this._parseAromaProfile(w.aroma_profile);
    if (!profile) return "";
    // v7.0.1 : toujours visible sur la fiche — v7.1.0 : glossaire ℹ️ intégré
    const g = this._glossHTML("aroma", "fiche-a");
    return `
      <div class="aroma-box">
        <div class="aroma-summary aroma-summary--static">🌸 Profil aromatique ${g.btn}</div>
        <div class="aroma-body">
          ${g.panel}
          ${this._aromaMode === "bars" ? this._aromaBarsSVG(profile, w.type) : this._aromaRadarSVG(profile, w.type)}
          <div class="aroma-legend">Estimation IA du profil au stade actuel du vin — indicatif, à affiner à la dégustation.</div>
        </div>
      </div>`;
  }

  // ── Structure en bouche (v7.1.0) — barres 6 axes, toujours visible ─────────
  _structureSectionHTML(w) {
    const sp = this._parseStructureProfile(w.structure_profile);
    if (!sp) return "";
    const t = WINE_TYPES[w.type] || WINE_TYPES.red;
    const g = this._glossHTML("structure", "fiche-s");
    const rows = this.constructor.STRUCTURE_AXES
      .filter(a => sp[a] != null)
      .map(a => `
        <div class="st-row">
          <span class="st-lbl">${a}</span>
          <div class="st-trk"><div class="st-fil" style="width:${sp[a]}%;background:${t.color}"></div></div>
          <span class="st-val">${sp[a]}</span>
        </div>`).join("");
    return `
      <div class="aroma-box">
        <div class="aroma-summary aroma-summary--static">🍷 Structure ${g.btn}</div>
        <div class="aroma-body">
          ${g.panel}
          ${rows}
          <div class="aroma-legend">Profil de dégustation estimé par l'IA (0–100 par axe) — lancez « Compléter les fiches » pour l'obtenir sur les vins qui ne l'ont pas encore.</div>
        </div>
      </div>`;
  }

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
        ${b.image_url
          ? `<div class="mm-detail-photo"><img src="${esc(b.image_url)}" alt="Photo de ${esc(b.name || "la bouteille")}"></div>`
          : `<div class="mm-detail-label">${this._wineLabelHTML(b)}</div>`}
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
          ${b.gifted_by ? _drow("De la part de", "🎁 " + b.gifted_by) : ""}
          ${b.event === "gift" && b.gifted_by ? _drow("De la part de", "🎁 " + esc(b.gifted_by)) : ""}
        </div>
        ${b.tasting_notes ? `<div class="mm-notes mm-tasting">🍷 ${esc(b.tasting_notes)}</div>` : ""}
        ${this._aromaSectionHTML(b)}
        ${this._structureSectionHTML(b)}
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

  // ── Retrait ciblé (v7.1.7) ────────────────────────────────────────────────
  // Un vin = une fiche + N emplacements (= N bouteilles physiques). Cet écran
  // permet enfin de n'en retirer QU'UNE, sans la marquer comme bue.
  _removePickHTML(wine) {
    const slots = wine.slots || [];
    return `
      <div class="mm-header">
        <span class="mm-title">🗑️ Retirer une bouteille</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-notes mm-tasting" style="margin-bottom:14px">
          <strong>${esc(wine.name)}${wine.vintage ? " " + esc(wine.vintage) : ""}</strong><br>
          ${slots.length} bouteilles en cave. Choisissez celle à retirer — les autres restent en place.
          <br><small>Pour la garder au journal de dégustation, utilisez plutôt « Bue » sur la fiche.</small>
        </div>
        <div class="rp-list">
          ${slots.map((s, i) => `
            <button class="rp-item" data-idx="${i}">
              <span class="rp-loc">${esc(this._slotLabel(s))}</span>
              ${s.size || s.comment ? `<span class="rp-meta">${esc([s.size, s.comment].filter(Boolean).join(" · "))}</span>` : ""}
              <span class="rp-act">Retirer</span>
            </button>`).join("")}
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-danger" id="rp-all">🗑️ Retirer tout le vin (${slots.length})</button>
      </div>`;
  }

  _bindRemovePick(box, wine) {
    box.querySelectorAll(".rp-item").forEach((el) =>
      el.addEventListener("click", async () => {
        const idx = parseInt(el.dataset.idx) || 0;
        const s = wine.slots?.[idx] || {};
        if (await this._confirm(
          `Retirer la bouteille en ${this._slotLabel(s)} ?\n\n` +
          `Les ${(wine.slots?.length || 1) - 1} autre(s) exemplaire(s) restent en cave.`
        )) {
          this._closeModal();
          await this._callService("remove_slot", { wine_id: wine.id, slot_idx: idx });
        }
      })
    );
    box.querySelector("#rp-all")?.addEventListener("click", async () => {
      const n = wine.slots?.length || 0;
      if (await this._confirm(`Retirer "${wine.name}" et ses ${n} bouteilles de la cave ?`)) {
        this._selected = null;
        this._closeModal();
        await this._callService("remove_wine", { wine_id: wine.id });
      }
    });
  }

  _slotEditHTML(wine, slotIdx) {
    const s = wine.slots?.[slotIdx] || {};
    // v7.1.8 : casiers de TOUTES les caves, groupés par cave → transfert possible
    const racks = this._allRacks();
    const byCellar = {};
    for (const r of racks) (byCellar[r._cellarName || ""] ??= []).push(r);
    const multiCave = Object.keys(byCellar).length > 1;
    const rackOptions = multiCave
      ? Object.entries(byCellar).map(([cave, rs]) => `
          <optgroup label="${esc(cave)}">
            ${rs.map(f => `<option value="${esc(f.id)}" ${f.id === s.rack_id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
          </optgroup>`).join("")
      : racks.map(f => `<option value="${esc(f.id)}" ${f.id === s.rack_id ? "selected" : ""}>${esc(f.name)}</option>`).join("");
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
        <!-- Déplacement tactile : alternative au glisser-déposer (inopérant au doigt en 2D) -->
        <div class="mm-field" style="margin-top:6px">
          <label class="mm-label">📍 Déplacer cette bouteille${multiCave ? " (toutes caves)" : ""}</label>
          <select class="mm-input" id="se-rack">
            ${rackOptions}
          </select>
          <input type="hidden" id="se-slot" value="${Number.isInteger(s.slot) ? s.slot : 0}">
          <div id="se-slot-picker" class="sp-picker"></div>
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-danger" id="se-remove" title="Retirer uniquement cette bouteille de la cave">🗑️ Retirer</button>
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="se-submit">Enregistrer</button>
      </div>`;
  }

  _bindSlotEdit(box, wine, slotIdx) {
    const cur = wine.slots?.[slotIdx] || {};
    // v7.1.7 : retrait UNITAIRE — retire ce seul emplacement sans passer par
    // « bue » (donc sans entrée au journal de dégustation). Le backend supprime
    // le vin automatiquement si c'était sa dernière bouteille.
    box.querySelector("#se-remove")?.addEventListener("click", async () => {
      const n = wine.slots?.length || 1;
      const msg = n > 1
        ? `Retirer cette bouteille de "${wine.name}" ?\n\nLes ${n - 1} autre(s) exemplaire(s) restent dans la cave.`
        : `Retirer "${wine.name}" de la cave ?\n\nC'est sa dernière bouteille.`;
      if (await this._confirm(msg)) {
        this._closeModal();
        await this._callService("remove_slot", { wine_id: wine.id, slot_idx: slotIdx });
      }
    });
    // Picker mono-sélection : le slot actuel de CETTE bouteille est exclu des
    // occupés (donc déplaçable sur lui-même = aucun déplacement) ; les slots des
    // autres bouteilles restent « pris » et non cliquables.
    const renderPicker = () => this._renderSlotPicker(box, "se-rack", "se-slot-picker", "se-slot", wine.id, false);
    box.querySelector("#se-rack")?.addEventListener("change", () => {
      // Casier changé : présélectionne le 1er emplacement libre du nouveau casier
      const rackId = box.querySelector("#se-rack").value;
      if (rackId !== cur.rack_id) {
        const rack = this._findRack(rackId);   // v7.1.8 : toutes caves
        const total = rack ? (rack.slots || (rack.columns || 8) * (rack.shelves || 2)) : 0;
        const taken = new Set();
        (this._data?.wines || []).forEach(w => w.slots?.forEach(sl => {
          if (sl.rack_id === rackId && !(w.id === wine.id)) taken.add(sl.slot);
        }));
        let free = 0; while (free < total && taken.has(free)) free++;
        box.querySelector("#se-slot").value = free < total ? free : 0;
      }
      renderPicker();
    });
    renderPicker();

    box.querySelector("#se-submit")?.addEventListener("click", async () => {
      const tgtRack = box.querySelector("#se-rack")?.value || cur.rack_id;
      const tgtSlot = parseInt(box.querySelector("#se-slot")?.value);
      const moved = !isNaN(tgtSlot) && (tgtRack !== cur.rack_id || tgtSlot !== cur.slot);
      try {
        if (moved) {
          await this._hass.callService(DOMAIN, "move_slot", {
            wine_id: wine.id, slot_idx: slotIdx, rack_id: tgtRack, slot: tgtSlot,
          });
        }
        await this._hass.callService(DOMAIN, "update_slot", {
          wine_id:  wine.id,
          slot_idx: slotIdx,
          size:     box.querySelector("#se-size")?.value?.trim() || "",
          comment:  box.querySelector("#se-comment")?.value?.trim() || "",
        });
        this._closeModal();
        await this._fetchData();
        setTimeout(() => this._fetchData(), 600);
        if (moved) this._showToast("success", "Bouteille déplacée ✓");
      } catch (err) {
        this._showToast("error", `Erreur : ${err.message || JSON.stringify(err)}`);
      }
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
    const log = (this._data?.tasting_log || []).slice().reverse();
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

  // ── Liste des bouteilles (clic sur le compteur) + export CSV ────────────────

  _bottleListHTML() {
    const wines = this._data?.wines || [];

    // Ordre des couleurs imposé : Rouge → Blanc → Liquoreux → Rosé → Effervescent
    const COLOR_ORDER = ["red", "white", "dessert", "rose", "sparkling"];

    // Regroupement Couleur → Région → vins (châteaux)
    // v7.1.8 : la CLÉ de groupe est NORMALISÉE (minuscules, sans accents) pour
    // que « Vallée de la Loire » et « Vallée De La Loire » forment UN SEUL
    // groupe — c'était deux sections séparées, signalé par la communauté.
    // Le LIBELLÉ affiché est la variante la plus fréquente parmi les vins du
    // groupe (non destructif : aucune donnée modifiée, pur affichage).
    const groups = {};       // type → regionKey → [wine]
    const regionLabels = {}; // regionKey → { variante: occurrences }
    const normRegion = (s) => (s || "").trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
    let totalSlots = 0;
    for (const w of wines) {
      const count = (w.slots || []).length;
      if (count === 0) continue;
      totalSlots += count;
      const raw = (w.region || "").trim() || "Sans région";
      const key = normRegion(raw);
      (regionLabels[key] ??= {});
      regionLabels[key][raw] = (regionLabels[key][raw] || 0) + count;
      (groups[w.type] ??= {});
      (groups[w.type][key] ??= []).push(w);
    }
    const regionLabel = (key) => {
      const variants = regionLabels[key] || {};
      return Object.entries(variants).sort((a, b) => b[1] - a[1])[0]?.[0] || key;
    };

    const orderedTypes = Object.keys(groups).sort(
      (a, b) => (COLOR_ORDER.indexOf(a) + 1 || 99) - (COLOR_ORDER.indexOf(b) + 1 || 99)
    );
    const fmtEvent = (e) => (EVENT_TYPES.find(x => x.v === e)?.l) || "";
    const slotCount = (w) => (w.slots || []).length;

    const body = totalSlots === 0
      ? `<div class="mm-empty-hint">Aucune bouteille dans la cave.</div>`
      : `<div class="vlist">
          ${orderedTypes.map((tp) => {
            const t = WINE_TYPES[tp] || WINE_TYPES.red;
            const regions = groups[tp];
            const tCount = Object.values(regions).reduce((s, arr) => s + arr.reduce((a, w) => a + slotCount(w), 0), 0);
            const regionNames = Object.keys(regions).sort((a, b) => regionLabel(a).localeCompare(regionLabel(b)));
            return `
            <div class="vlist-color-head" style="--c:${t.color}">
              <span class="vlist-swatch" style="background:${t.color}"></span>
              <span class="vlist-color-name">${esc(t.label)}</span>
              <span class="vlist-count" style="color:${t.color}">${tCount}</span>
            </div>
            ${regionNames.map((rg) => {
              const items = regions[rg].sort((a, b) => (a.w?.name || a.name || "").localeCompare(b.name || ""));
              const rCount = items.reduce((a, w) => a + slotCount(w), 0);
              return `
              <div class="vlist-region-head">${esc(regionLabel(rg))}</div>
              ${items.map((w) => {
                const n = slotCount(w);
                const apo = (w.drink_from || w.drink_until)
                  ? `${esc(w.drink_from || "?")}–${esc(w.drink_until || "?")}` : "";
                // Ligne 1 (infos libres) : appellation, note, format
                const meta = [];
                if (w.appellation) meta.push(`<span class="vm">📍 ${esc(w.appellation)}</span>`);
                if (w.vivino_rating) meta.push(`<span class="vm">★ ${w.vivino_rating}</span>`);
                if (w.size && String(w.size) !== "75cl") meta.push(`<span class="vm">🍾 ${esc(String(w.size))}</span>`);
                // Ligne 2 : 2 colonnes ALIGNÉES (apogée | occasion) — la quantité passe en haut
                const cols = `
                  <div class="vlist-wine-cols">
                    <span class="vcol vcol-apo">${apo ? `🕐 ${apo}` : ""}</span>
                    <span class="vcol vcol-occ">${w.event ? `📅 ${esc(fmtEvent(w.event))}` : ""}</span>
                  </div>`;
                return `
                <div class="vlist-wine" data-wine="${esc(w.id)}">
                  <div class="vlist-wine-top">
                    <span class="vlist-wine-name">${w.favorite ? '<span class="vfav">★</span> ' : ""}${esc(w.name || "Sans nom")}${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}</span>
                    <span class="vlist-wine-tail">
                      <span class="vlist-wine-qty">×${n}</span>
                      <span class="vlist-wine-price">${w.price ? Math.round(w.price) + "€" : ""}</span>
                    </span>
                  </div>
                  ${meta.length ? `<div class="vlist-wine-meta">${meta.join("")}</div>` : ""}
                  ${cols}
                </div>`;
              }).join("")}`;
            }).join("")}`;
          }).join("")}
        </div>`;

    return `
      <div class="mm-header">
        <span class="mm-title">🍷 ${totalSlots} bouteille${totalSlots > 1 ? "s" : ""}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="vlist-search-wrap">
        <input type="text" id="vlist-search" class="vlist-search" placeholder="🔍 Rechercher un vin, une région, un producteur…" autocomplete="off">
      </div>
      <div class="mm-body">${body}</div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
        <button class="mm-btn mm-btn-primary" id="blist-export">⬇️ Exporter en CSV</button>
      </div>`;
  }

  _bindBottleList(box) {
    box.querySelectorAll(".vlist-wine[data-wine]").forEach((row) =>
      row.addEventListener("click", () => {
        const wine = (this._data?.wines || []).find((w) => w.id === row.dataset.wine);
        if (wine) this._locateBottle(wine);
      })
    );
    box.querySelector("#blist-export")?.addEventListener("click", () => this._exportCSV());

    // Recherche en direct dans la liste
    const search = box.querySelector("#vlist-search");
    if (search) {
      const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const apply = () => {
        const q = norm(search.value.trim());
        const wines = this._data?.wines || [];
        const byId = Object.fromEntries(wines.map(w => [w.id, w]));
        box.querySelectorAll(".vlist-wine[data-wine]").forEach((row) => {
          const w = byId[row.dataset.wine];
          const hay = norm([w?.name, w?.region, w?.appellation, w?.producer, w?.vintage].join(" "));
          row.style.display = (!q || hay.includes(q)) ? "" : "none";
        });
        // Masquer les en-têtes région/couleur devenus vides
        box.querySelectorAll(".vlist-region-head").forEach((rh) => {
          let n = rh.nextElementSibling, any = false;
          while (n && n.classList.contains("vlist-wine")) {
            if (n.style.display !== "none") { any = true; break; }
            n = n.nextElementSibling;
          }
          rh.style.display = any ? "" : "none";
        });
        box.querySelectorAll(".vlist-color-head").forEach((ch) => {
          let n = ch.nextElementSibling, any = false;
          while (n && !n.classList.contains("vlist-color-head")) {
            if (n.classList.contains("vlist-wine") && n.style.display !== "none") { any = true; break; }
            n = n.nextElementSibling;
          }
          ch.style.display = any ? "" : "none";
        });
      };
      search.addEventListener("input", apply);
      setTimeout(() => search.focus(), 120);
    }
  }

  // ── Liste des casiers : un casier → les bouteilles qu'il contient ──
  _rackListHTML() {
    const racks = this._data?.cellar?.racks || [];
    const wines = this._data?.wines || [];
    const fmtEvent = (e) => (EVENT_TYPES.find(x => x.v === e)?.l) || "";

    // Index : rack_id → [{wine, slot}]
    const byRack = {};
    for (const w of wines) {
      for (const s of (w.slots || [])) {
        (byRack[s.rack_id] ??= []).push({ wine: w, slot: s.slot });
      }
    }
    const totalBottles = wines.reduce((a, w) => a + (w.slots || []).length, 0);

    const body = racks.length === 0
      ? `<div class="mm-empty-hint">Aucun casier dans la cave.</div>`
      : `<div class="vlist">
          ${racks.map((rack, fi) => {
            const rackName = rack.name || `Casier ${fi + 1}`;
            const cols = rack.columns || 8;
            const capacity = rack.slots || cols * (rack.shelves || 2);
            const entries = (byRack[rack.id] || []).sort((a, b) => a.slot - b.slot);
            const n = entries.length;
            const pct = capacity > 0 ? Math.round((n / capacity) * 100) : 0;
            const rows = entries.length === 0
              ? `<div class="rk-empty">Casier vide</div>`
              : entries.map(({ wine: w, slot }) => {
                  const t = WINE_TYPES[w.type] || WINE_TYPES.red;
                  const apo = (w.drink_from || w.drink_until)
                    ? `${esc(w.drink_from || "?")}–${esc(w.drink_until || "?")}` : "";
                  const meta = [];
                  if (w.appellation) meta.push(`<span class="vm">📍 ${esc(w.appellation)}</span>`);
                  if (w.vivino_rating) meta.push(`<span class="vm">★ ${w.vivino_rating}</span>`);
                  if (apo) meta.push(`<span class="vm">🕐 ${apo}</span>`);
                  if (w.event) meta.push(`<span class="vm">📅 ${esc(fmtEvent(w.event))}</span>`);
                  return `
                  <div class="vlist-wine rk-wine" data-wine="${esc(w.id)}"
                       data-hay="${esc([w.name, w.region, w.appellation, w.producer, w.vintage, rackName].join(" "))}">
                    <div class="vlist-wine-top">
                      <span class="vlist-wine-name"><span class="rk-dot" style="background:${t.color}"></span>${w.favorite ? '<span class="vfav">★</span> ' : ""}${esc(w.name || "Sans nom")}${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}</span>
                      <span class="vlist-wine-tail">
                        <span class="rk-slot">N°${slot + 1}</span>
                        <span class="vlist-wine-price">${w.price ? Math.round(w.price) + "€" : ""}</span>
                      </span>
                    </div>
                    ${meta.length ? `<div class="vlist-wine-meta">${meta.join("")}</div>` : ""}
                  </div>`;
                }).join("");
            return `
            <div class="rk-head" data-rack-head>
              <span class="rk-name">📦 ${esc(rackName)}</span>
              <span class="rk-stat">${n}/${capacity} · ${pct}%</span>
            </div>
            ${rows}`;
          }).join("")}
        </div>`;

    return `
      <div class="mm-header">
        <span class="mm-title">📦 ${racks.length} casier${racks.length > 1 ? "s" : ""} · ${totalBottles} bouteille${totalBottles > 1 ? "s" : ""}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="vlist-search-wrap">
        <input type="text" id="rklist-search" class="vlist-search" placeholder="🔍 Rechercher un vin, un casier, une région…" autocomplete="off">
      </div>
      <div class="mm-body">${body}</div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
      </div>`;
  }

  _bindRackList(box) {
    // Clic sur un vin → localiser dans la cave (même mécanique que la liste des vins)
    box.querySelectorAll(".rk-wine[data-wine]").forEach((row) =>
      row.addEventListener("click", () => {
        const wine = (this._data?.wines || []).find((w) => w.id === row.dataset.wine);
        if (wine) this._locateBottle(wine);
      })
    );
    // Recherche en direct
    const search = box.querySelector("#rklist-search");
    if (search) {
      const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const apply = () => {
        const q = norm(search.value.trim());
        box.querySelectorAll(".rk-wine[data-hay]").forEach((row) => {
          row.style.display = (!q || norm(row.dataset.hay).includes(q)) ? "" : "none";
        });
        // Masquer les en-têtes de casier (et "Casier vide") devenus sans résultat
        box.querySelectorAll(".rk-head[data-rack-head]").forEach((rh) => {
          let n = rh.nextElementSibling, any = false;
          while (n && !n.classList.contains("rk-head")) {
            if (n.classList.contains("rk-wine") && n.style.display !== "none") { any = true; break; }
            n = n.nextElementSibling;
          }
          rh.style.display = any ? "" : "none";
          // les lignes "Casier vide" suivent le sort de leur en-tête
          let m = rh.nextElementSibling;
          while (m && !m.classList.contains("rk-head")) {
            if (m.classList.contains("rk-empty")) m.style.display = (any || !q) ? (q ? "none" : "") : "none";
            m = m.nextElementSibling;
          }
        });
      };
      search.addEventListener("input", apply);
      setTimeout(() => search.focus(), 120);
    }
  }

  // ── Panneau d'infos au survol (souris) / appui long (tactile iPhone) ────────
  _showBottlePanel(wine, anchorEl, pinned = false) {
    this._hideBottlePanel();
    if (!wine) return;
    // CSS injecté une fois dans document.head (le panneau vit hors shadow DOM, comme le toast)
    if (!document.querySelector("#mm-bpanel-css")) {
      const st = document.createElement("style");
      st.id = "mm-bpanel-css";
      st.textContent = `
        .mm-bottle-panel {
          position:fixed; z-index:999998; width:230px; max-width:calc(100vw - 16px);
          background:#15110E; border:1px solid #2E2620; border-radius:12px;
          padding:11px 13px; box-shadow:0 8px 28px rgba(0,0,0,0.6);
          font-family:Inter, sans-serif; color:#EDE0CC; pointer-events:none;
          opacity:0; transform:translateY(4px); transition:opacity 0.13s ease, transform 0.13s ease;
        }
        .mm-bottle-panel.show { opacity:1; transform:translateY(0); }
        .mm-bottle-panel .bp-head {
          display:flex; flex-direction:column; gap:2px; padding-bottom:7px; margin-bottom:7px;
          border-bottom:2px solid #7B1D2E;
        }
        .mm-bottle-panel .bp-name { font-family:Georgia, serif; font-size:1.02em; font-weight:700; line-height:1.25; }
        .mm-bottle-panel .bp-name i { color:#9A8C78; font-style:italic; }
        .mm-bottle-panel .bp-type { font-size:0.72em; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
        .mm-bottle-panel .bp-row { display:flex; justify-content:space-between; gap:10px; font-size:0.78em; padding:2px 0; }
        .mm-bottle-panel .bp-l { color:#8A7E6C; white-space:nowrap; }
        .mm-bottle-panel .bp-v { color:#EDE0CC; text-align:right; }
        .mm-bottle-panel .bp-foot {
          display:flex; justify-content:space-between; margin-top:8px; padding-top:7px;
          border-top:1px solid #2E2620; font-size:0.84em; font-weight:600; color:#C9A84C;
        }
        .mm-bottle-panel.pinned { border-color:#7B1D2E; }
        .mm-bottle-panel.pinned:active { transform:scale(0.98); }
        .mm-bottle-panel .bp-tap {
          margin-top:9px; padding-top:8px; border-top:1px dashed #3a302a;
          text-align:center; font-size:0.78em; font-weight:600; color:#E0A85A;
        }
        .mm-bottle-panel .bp-label { font-size:7px; max-width:128px; margin:0 auto 9px; }
        .mm-bottle-panel .bp-photo { max-width:120px; margin:0 auto 9px; border-radius:8px; overflow:hidden; background:#15110d; }
        .mm-bottle-panel .bp-photo img { display:block; width:100%; max-height:150px; object-fit:contain; }
      `;
      document.head.appendChild(st);
    }
    const t = WINE_TYPES[wine.type] || WINE_TYPES.red;
    const apo = (wine.drink_from || wine.drink_until)
      ? `${esc(wine.drink_from || "?")} – ${esc(wine.drink_until || "?")}` : "";
    const evt = wine.event ? (EVENT_LABEL[wine.event]?.emoji + " " + EVENT_LABEL[wine.event]?.l) : "";
    const n = (wine.slots || []).length;
    const row = (lbl, val) => val ? `<div class="bp-row"><span class="bp-l">${lbl}</span><span class="bp-v">${esc(String(val))}</span></div>` : "";

    const panel = document.createElement("div");
    panel.className = "mm-bottle-panel";
    panel.innerHTML = `
      ${wine.image_url
        ? `<div class="bp-photo"><img src="${esc(wine.image_url)}" alt=""></div>`
        : `<div class="bp-label">${this._wineLabelHTML(wine)}</div>`}
      <div class="bp-head" style="border-color:${t.color}">
        <span class="bp-name">${wine.favorite ? "⭐ " : ""}${esc(wine.name || "Sans nom")}${wine.vintage ? ` <i>${esc(wine.vintage)}</i>` : ""}</span>
        <span class="bp-type" style="color:${t.color}">${t.emoji} ${t.label}</span>
      </div>
      ${row("Producteur", wine.producer)}
      ${row("Appellation", wine.appellation)}
      ${row("Région", [wine.region, wine.country].filter(Boolean).join(", "))}
      ${wine.vivino_rating ? row("Note", wine.vivino_rating + " / 5 ★") : ""}
      ${apo ? row("Apogée", apo) : ""}
      ${evt ? row("Occasion", evt) : ""}
      ${wine.gifted_by ? row("De la part de", "🎁 " + wine.gifted_by) : ""}
      ${row("Format", wine.size || "75cl")}
      <div class="bp-foot">
        <span>${wine.price ? Math.round(wine.price) + " €" : "Prix —"}</span>
        <span>Qté : ${n}</span>
      </div>`;
    document.body.appendChild(panel);
    this._bottlePanel = panel;

    // Positionner près de la bouteille, en restant dans l'écran
    const r = anchorEl.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.top - ph - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    if (top < 8) top = r.bottom + 8;   // bascule en dessous si pas de place au-dessus
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    requestAnimationFrame(() => panel.classList.add("show"));

    // Mode épinglé (tactile) : l'aperçu reste, devient cliquable → ouvre la fiche,
    // et un toucher en dehors le referme.
    if (pinned) {
      panel.classList.add("pinned");
      panel.style.pointerEvents = "auto";
      panel.style.cursor = "pointer";
      const hint = document.createElement("div");
      hint.className = "bp-tap";
      hint.textContent = "Toucher pour la fiche →";
      panel.appendChild(hint);
      panel.addEventListener("click", () => {
        this._hideBottlePanel();
        this._openModal("detail", { wine });
      });
      // Referme si on touche ailleurs (le geste courant est déjà passé : on écoute le suivant)
      this._panelDismiss = (ev) => {
        if (this._bottlePanel && !this._bottlePanel.contains(ev.target)) this._hideBottlePanel();
      };
      document.addEventListener("pointerdown", this._panelDismiss, true);
    }
  }

  _hideBottlePanel() {
    if (this._panelDismiss) { document.removeEventListener("pointerdown", this._panelDismiss, true); this._panelDismiss = null; }
    if (this._bottlePanel) { this._bottlePanel.remove(); this._bottlePanel = null; }
    if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
    if (this._lp3Timer) { clearTimeout(this._lp3Timer); this._lp3Timer = null; }
  }

  _locateBottle(wine) {
    const slot = (wine.slots || [])[0];
    this._closeModal();
    this._selected = wine.id;
    this._render();
    // Défilement vers la bouteille (utile en 2D / pastilles ; en 3D le halo suffit)
    setTimeout(() => {
      const sel = slot
        ? this.shadowRoot.querySelector(`[data-wine-id="${wine.id}"][data-rack-id="${slot.rack_id}"]`)
        : this.shadowRoot.querySelector(`[data-wine-id="${wine.id}"]`);
      if (sel) {
        sel.scrollIntoView({ behavior: "smooth", block: "center" });
        sel.classList.add("bottle-flash");
        setTimeout(() => sel.classList.remove("bottle-flash"), 2000);
      }
      this._showToast("info", `${wine.name || "Vin"} mis en valeur — touchez ailleurs pour revenir`);
    }, 160);
  }

  _exportCSV() {
    const wines = this._data?.wines || [];
    const cols = ["Nom", "Millésime", "Type", "Appellation", "Région", "Pays", "Producteur",
                  "Prix", "Note", "Format", "Emplacement", "Événement", "Coup de cœur", "Apogée début", "Apogée fin"];
    const cell = (v) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(";")];
    for (const w of wines) {
      const t = WINE_TYPES[w.type] || WINE_TYPES.red;
      const evt = (EVENT_TYPES.find(x => x.v === w.event)?.l) || "";
      for (const s of (w.slots || [])) {
        lines.push([
          w.name, w.vintage, t.label, w.appellation, w.region, w.country, w.producer,
          w.price || "", w.vivino_rating || "", w.size || "75cl",
          this._slotLabel(s), evt, w.favorite ? "Oui" : "", w.drink_from || "", w.drink_until || "",
        ].map(cell).join(";"));
      }
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `millesime-cave-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._showToast("success", "Export CSV téléchargé 📥");
  }

  // ── Déplacer le contenu d'un casier vers un autre ───────────────────────────

  // ── Capteurs température / hygrométrie ──────────────────────────────────────

  // ── Gestion des caves (multi-caves) ──────────────────────────────────────────

  // ── Sommelier IA v7.0.0 : conseil d'achat & analyse d'opportunité ──────────
  // Concepts inspirés de ha-cellier-ia (aldoushx), réimplémentés nativement.
  // Les prix affichés sont des ESTIMATIONS du modèle, jamais des cotations.

  _sommelierHTML() {
    const mode = this._somMode || "audit";
    const cellarName = esc(this._data?.cellar?.name || "Millésime");
    const REGIONS = ["", "Bordeaux", "Bourgogne", "Vallée du Rhône", "Loire", "Alsace",
      "Champagne", "Beaujolais", "Languedoc-Roussillon", "Provence", "Sud-Ouest",
      "Jura", "Savoie", "Corse", "Italie", "Espagne", "Portugal", "Allemagne", "Monde"];
    return `
      <div class="mm-header">
        <span class="mm-title">🧠 Sommelier — ${cellarName}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="seg3 seg3--sub som-mode" id="som-mode">
          <button type="button" class="seg3-btn ${mode === "audit" ? "active" : ""}" data-mode="audit">🛒<span class="seg3-lbl">Conseil d'achat</span></button>
          <button type="button" class="seg3-btn ${mode === "opp" ? "active" : ""}" data-mode="opp">🏪<span class="seg3-lbl">Opportunité</span></button>
        </div>
        <div class="som-pane" id="som-pane-audit" style="display:${mode === "audit" ? "block" : "none"}">
          <div class="acc-hint">L'IA audite l'équilibre de la cave (styles, trous et embouteillages d'apogée) et propose <b>5 achats précis</b> pour la compléter. Prix indicatifs.</div>
          <div class="som-fields">
            <label class="acc-menu-lbl">💶 Budget max / bouteille</label>
            <input type="number" class="mm-input" id="som-budget" value="30" min="5" max="5000" step="5">
            <label class="acc-menu-lbl">📍 Région prioritaire</label>
            <select class="mm-input" id="som-region">
              ${REGIONS.map(r => `<option value="${esc(r)}">${r || "Toutes régions"}</option>`).join("")}
            </select>
          </div>
          <button class="acc-go acc-menu-go" id="som-audit-go">🛒 Lancer l'audit</button>
          <div class="acc-list" id="som-audit-result"></div>
        </div>
        <div class="som-pane" id="som-pane-opp" style="display:${mode === "opp" ? "block" : "none"}">
          <div class="acc-hint">En magasin devant une bouteille ? Saisissez-la (ou scannez l'étiquette 📷) : l'IA vérifie les doublons, l'embouteillage d'apogée, le millésime et le prix à viser.</div>
          <div class="acc-searchwrap">
            <input type="text" class="mm-input acc-search" id="som-opp-text" placeholder="ex. Château Talbot Saint-Julien 2019" autocomplete="off">
            <button class="acc-go" id="som-opp-scan" title="Scanner l'étiquette">📷</button>
          </div>
          <input type="file" id="som-opp-file" accept="image/*" capture="environment" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
          <button class="acc-go acc-menu-go" id="som-opp-go">🏪 Analyser l'opportunité</button>
          <div class="acc-list" id="som-opp-result"></div>
        </div>
      </div>`;
  }

  _bindSommelier(box) {
    // Sélecteur de segment
    box.querySelectorAll("#som-mode .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._somMode = btn.dataset.mode;
        box.querySelectorAll("#som-mode .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
        const pa = box.querySelector("#som-pane-audit"), po = box.querySelector("#som-pane-opp");
        if (pa) pa.style.display = this._somMode === "audit" ? "block" : "none";
        if (po) po.style.display = this._somMode === "opp" ? "block" : "none";
      })
    );

    const estCellar = () => this._estimateTokens(
      JSON.stringify((this._data?.wines || []).map(w => (w.name || "") + (w.appellation || "") + (w.aroma_profile || "")))) + 400;

    // ── Conseil d'achat ──
    box.querySelector("#som-audit-go")?.addEventListener("click", async () => {
      const result = box.querySelector("#som-audit-result");
      if (!(this._data?.wines || []).length) {
        if (result) result.innerHTML = `<div class="acc-empty">Cette cave est vide : l'audit n'a rien à analyser.</div>`;
        return;
      }
      const budget = parseFloat(box.querySelector("#som-budget")?.value) || 30;
      const region = box.querySelector("#som-region")?.value || "";
      const prog = this._aiProgressOpen("Sommelier — audit de la cave", estCellar());
      if (result) result.innerHTML = "";
      try {
        prog.step(1);
        const req = this._hass.connection.sendMessagePromise({
          type: "millesime/audit_cellar", budget, region, cellar_id: this._cellarId || null });
        prog.step(2);
        const res = await req;
        if (res?.error) {
          prog.fail(res.error === "no_key" ? "Clé Gemini absente : configurez-la dans l'intégration" : `IA indisponible (${res.error})`);
          return;
        }
        prog.step(3);
        const r = res.result || {};
        prog.done(res.usage);
        if (result) {
          const sug = (r.suggestions || []).slice(0, 5);
          result.innerHTML =
            (r.balance ? `<div class="som-balance">📊 ${esc(r.balance)}</div>` : "") +
            (sug.length ? sug.map((s, i) => {
              const t = WINE_TYPES[s.color] || WINE_TYPES.red;
              return `
                <div class="menu-choice">
                  <div class="menu-choice-head">
                    <span class="som-rank">${i + 1}</span>
                    <span class="rk-dot" style="background:${t.color}"></span>
                    <b>${esc(s.name || "?")}</b>
                  </div>
                  <div class="som-sug-meta">
                    ${s.appellation ? `<span>📍 ${esc(s.appellation)}</span>` : ""}
                    ${s.vintages ? `<span>🕐 ${esc(String(s.vintages))}</span>` : ""}
                    ${s.price ? `<span>💶 ~${esc(String(s.price))} (indicatif)</span>` : ""}
                    ${s.qty ? `<span>🍾 ×${esc(String(s.qty))}</span>` : ""}
                  </div>
                  ${s.reason ? `<div class="menu-choice-reason">${esc(s.reason)}</div>` : ""}
                </div>`;
            }).join("") : `<div class="acc-empty">Aucune suggestion reçue.</div>`);
        }
      } catch (e) { prog.fail("Erreur réseau : réessayez"); }
    });

    // ── Opportunité : scan d'étiquette (réutilise analyze_photo + compression) ──
    const oppText = box.querySelector("#som-opp-text");
    const oppFile = box.querySelector("#som-opp-file");
    box.querySelector("#som-opp-scan")?.addEventListener("click", () => oppFile?.click());
    oppFile?.addEventListener("change", async () => {
      const file = oppFile.files?.[0];
      if (!file) return;
      const prog = this._aiProgressOpen("Lecture de l'étiquette…");
      try {
        prog.step(1);
        const compressed = await this._compressImage(file);
        const b64 = compressed.split(",")[1];
        prog.step(2);
        const res = await this._hass.connection.sendMessagePromise({
          type: "millesime/analyze_photo", image_b64: b64, mime_type: "image/jpeg" });
        const best = (res?.results || [])[0];
        if (!best) { prog.fail("Étiquette non reconnue — saisissez le vin à la main"); return; }
        prog.done();
        if (oppText) oppText.value =
          [best.name, best.vintage, best.appellation].filter(Boolean).join(" ");
        box.querySelector("#som-opp-go")?.click();      // enchaîne l'analyse
      } catch (e) { prog.fail("Erreur de lecture de la photo"); }
      finally { oppFile.value = ""; }
    });

    // ── Opportunité : analyse ──
    box.querySelector("#som-opp-go")?.addEventListener("click", async () => {
      const result = box.querySelector("#som-opp-result");
      const wineText = (oppText?.value || "").trim();
      if (wineText.length < 3) {
        if (result) result.innerHTML = `<div class="acc-empty">Décrivez le vin repéré (nom, millésime…).</div>`;
        return;
      }
      const prog = this._aiProgressOpen("Sommelier — analyse d'opportunité", estCellar());
      if (result) result.innerHTML = "";
      try {
        prog.step(1);
        const req = this._hass.connection.sendMessagePromise({
          type: "millesime/opportunity", wine_text: wineText, cellar_id: this._cellarId || null });
        prog.step(2);
        const res = await req;
        if (res?.error) {
          prog.fail(res.error === "no_key" ? "Clé Gemini absente : configurez-la dans l'intégration" : `IA indisponible (${res.error})`);
          return;
        }
        prog.step(3);
        const r = res.result || {};
        prog.done(res.usage);
        const V = { "achat conseillé": ["✅", "som-verdict--ok"], "achat possible": ["🟡", "som-verdict--mid"], "achat déconseillé": ["⛔", "som-verdict--no"] };
        const [vIcon, vClass] = V[(r.verdict || "").toLowerCase()] || ["ℹ️", ""];
        if (result) result.innerHTML = `
          <div class="som-verdict ${vClass}">${vIcon} <b>${esc(r.verdict || "Analyse")}</b>${r.qty ? ` — ${esc(String(r.qty))} bouteille${r.qty > 1 ? "s" : ""} conseillée${r.qty > 1 ? "s" : ""}` : ""}</div>
          <div class="som-opp-rows">
            ${r.closest ? `<div class="som-opp-row">🍷 <b>Le plus proche en cave :</b> ${esc(r.closest)}</div>` : ""}
            ${r.vintage_advice ? `<div class="som-opp-row">🕐 <b>Millésime à viser :</b> ${esc(String(r.vintage_advice))}</div>` : ""}
            ${r.price_hint ? `<div class="som-opp-row">💶 <b>Prix raisonnable :</b> ${esc(String(r.price_hint))} <small>(estimation, pas une cotation)</small></div>` : ""}
            ${r.reason ? `<div class="som-opp-row">💬 ${esc(r.reason)}</div>` : ""}
          </div>`;
      } catch (e) { prog.fail("Erreur réseau : réessayez"); }
    });
  }

  _cellarsHTML() {
    const cellars = this._data?.cellars || [];
    const rows = cellars.map(c => {
      const nRacks = (c.racks || []).length;
      const deletable = cellars.length > 1 && nRacks === 0;
      return `
        <div class="mm-cave-row" data-cid="${esc(c.id)}">
          <input class="mm-input mm-cave-name" type="text" value="${esc(c.name || "Cave")}" maxlength="40">
          <span class="mm-cave-meta">${nRacks} casier${nRacks > 1 ? "s" : ""}${c.id === this._cellarId ? " · active" : ""}</span>
          <button class="mm-cave-btn" data-save-cave title="Renommer">💾</button>
          <button class="mm-cave-btn ${deletable ? "" : "mm-cave-btn--off"}" data-del-cave
            title="${deletable ? "Supprimer cette cave" : "Suppression impossible : videz d'abord la cave (et gardez-en au moins une)"}">🗑️</button>
        </div>`;
    }).join("");
    return `
      <div class="mm-header">
        <span class="mm-title">🏰 Gérer les caves</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <p class="mm-hint" style="margin-bottom:12px">Chaque cave possède ses casiers, ses capteurs T°/hygro et son historique de valeur. Le journal de dégustation reste commun.</p>
        <div class="mm-cave-list">${rows}</div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
        <button class="mm-btn mm-btn-primary" id="cave-add">➕ Ajouter une cave</button>
      </div>`;
  }

  _bindCellars(box) {
    box.querySelectorAll(".mm-cave-row").forEach(row => {
      const cid = row.dataset.cid;
      row.querySelector("[data-save-cave]")?.addEventListener("click", async () => {
        const name = row.querySelector(".mm-cave-name")?.value.trim();
        if (!name) return;
        if (await this._callService("rename_cellar", { cellar_id: cid, name }))
          this._showToast("success", "Cave renommée ✓");
      });
      row.querySelector("[data-del-cave]:not(.mm-cave-btn--off)")?.addEventListener("click", async () => {
        const ok = await this._confirm("Supprimer cette cave (vide) ? Cette action est définitive.");
        if (!ok) return;
        if (cid === this._cellarId) this._cellarId = null;   // rebascule sur la 1re cave
        if (await this._callService("remove_cellar", { cellar_id: cid })) {
          this._showToast("success", "Cave supprimée ✓");
          this._closeModal();
        }
      });
    });
    box.querySelector("#cave-add")?.addEventListener("click", async () => {
      const n = (this._data?.cellars?.length || 0) + 1;
      if (await this._callService("add_cellar", { name: `Cave ${n}` })) {
        this._showToast("success", "Cave créée ✓ — renommez-la puis sélectionnez-la dans l'en-tête");
        this._closeModal();
      }
    });
  }

  _sensorsHTML() {
    const cellar = this._data?.cellar || {};
    return `
      <div class="mm-header">
        <span class="mm-title">🌡️ Capteurs — ${esc(cellar.name || "Cave")}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <p class="mm-hint" style="margin-bottom:14px">Choisissez les capteurs Home Assistant à afficher. Les listes se chargent depuis vos entités.</p>
        <div class="mm-field">
          <label class="mm-label">🌡️ Capteur de température</label>
          <select class="mm-input" id="sensor-temp"><option value="">⏳ Chargement…</option></select>
        </div>
        <div class="mm-field">
          <label class="mm-label">💧 Capteur d'hygrométrie</label>
          <select class="mm-input" id="sensor-humid"><option value="">⏳ Chargement…</option></select>
        </div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Annuler</button>
        <button class="mm-btn mm-btn-primary" id="sensors-save">Enregistrer</button>
      </div>`;
  }

  async _bindSensors(box) {
    const cellar = this._data?.cellar || {};
    const tSel = box.querySelector("#sensor-temp");
    const hSel = box.querySelector("#sensor-humid");

    // Charger la liste des capteurs depuis le backend
    let sensors = { temperature: [], humidity: [], other: [] };
    try {
      const resp = await this._hass.connection.sendMessagePromise({ type: "millesime/list_sensors" });
      // v7.1.8 : le try/catch ne protégeait que l'ENVOI. Une réponse partielle
      // ou inattendue écrasait la valeur par défaut, et le rendu plantait sur
      // « length of undefined ». On normalise systématiquement les 3 listes.
      sensors = {
        temperature: Array.isArray(resp?.temperature) ? resp.temperature : [],
        humidity:    Array.isArray(resp?.humidity)    ? resp.humidity    : [],
        other:       Array.isArray(resp?.other)       ? resp.other       : [],
      };
    } catch (err) {
      console.error("[Millésime] list_sensors:", err);
    }

    const opt = (s, sel) => `<option value="${s.entity_id}" ${s.entity_id === sel ? "selected" : ""}>${s.name}${s.unit ? ` (${s.state}${s.unit})` : ""}</option>`;
    const fill = (sel, primary, current) => {
      if (!sel) return;
      const list = Array.isArray(primary) ? primary : [];
      const groups = [];
      groups.push(`<option value="">— Aucun —</option>`);
      if (list.length) groups.push(`<optgroup label="Capteurs ${sel === tSel ? "température" : "humidité"}">${list.map(s => opt(s, current)).join("")}</optgroup>`);
      if (sensors.other.length) groups.push(`<optgroup label="Autres capteurs">${sensors.other.map(s => opt(s, current)).join("")}</optgroup>`);
      sel.innerHTML = groups.join("");
    };
    fill(tSel, sensors.temperature, cellar.temp_entity || "");
    fill(hSel, sensors.humidity, cellar.humid_entity || "");

    box.querySelector("#sensors-save")?.addEventListener("click", async () => {
      const btn = box.querySelector("#sensors-save");
      btn.textContent = "⏳…"; btn.disabled = true;
      try {
        await this._hass.connection.sendMessagePromise({
          type: "millesime/set_sensors",
          cellar_id: this._cellarId || null,
          temp_entity: tSel.value || null,
          humid_entity: hSel.value || null,
        });
        await new Promise(r => setTimeout(r, 400));
        await this._fetchData();
        this._closeModal();
        this._showToast("success", "Capteurs enregistrés ✓");
      } catch (err) {
        btn.textContent = "Enregistrer"; btn.disabled = false;
        this._showToast("error", "Erreur : " + (err.message || err));
      }
    });
  }

  _envHistoryHTML(entity, kind) {
    const cur = this._sensorVal(entity);
    const icon = kind === "temperature" ? "🌡️" : "💧";
    const title = kind === "temperature" ? "Température" : "Hygrométrie";
    return `
      <div class="mm-header">
        <span class="mm-title">${icon} ${title}</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
          <span style="font-size:2em;font-weight:700;color:var(--mm-text);font-family:var(--font-serif,Georgia,serif)">${cur ? `${cur.value}${cur.unit}` : "—"}</span>
          <span style="font-size:0.82em;color:var(--mm-muted)">${cur ? esc(cur.name) : esc(entity)}</span>
        </div>
        <div class="env-range" style="display:flex;gap:6px;margin:10px 0">
          ${[["24h", 24], ["7 j", 168], ["30 j", 720]].map(([lbl, h], i) =>
            `<button class="env-range-btn ${i === 1 ? "active" : ""}" data-hours="${h}">${lbl}</button>`).join("")}
        </div>
        <div id="env-chart-wrap" style="width:100%;height:200px;background:var(--mm-bg0,#0D0D0D);border-radius:8px;border:1px solid var(--mm-border,#222)"></div>
      </div>
      <div class="mm-footer">
        <button class="mm-btn mm-btn-ghost" data-close>Fermer</button>
      </div>`;
  }

  async _bindEnvHistory(box, entity, kind) {
    const wrap = box.querySelector("#env-chart-wrap");
    const unit = this._sensorVal(entity)?.unit || (kind === "temperature" ? "°" : "%");
    const load = async (hours) => {
      wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--mm-muted);font-size:0.9em">⏳ Chargement…</div>`;
      let points = [];
      try {
        const res = await this._hass.connection.sendMessagePromise({
          type: "millesime/entity_history", entity_id: entity, hours,
        });
        points = res.points || [];
      } catch (err) {
        console.error("[Millésime] entity_history:", err);
      }
      this._renderEntityChart(wrap, points, unit);
    };
    box.querySelectorAll(".env-range-btn").forEach((b) =>
      b.addEventListener("click", () => {
        box.querySelectorAll(".env-range-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        load(parseInt(b.dataset.hours, 10));
      })
    );
    load(168);  // 7 jours par défaut
  }

  _renderEntityChart(wrap, points, unit) {
    wrap.innerHTML = "";
    const tv     = this._hass?.themes?.themes?.[this._hass?.themes?.theme] || {};
    const cBg    = tv['primary-background-color'] || '#0D0D0D';
    const cGrid  = tv['divider-color']            || '#222';
    const cMuted = tv['secondary-text-color']     || '#777';
    const cText  = tv['primary-text-color']       || '#EDE0CC';
    const cAccent= tv['primary-color']            || '#C0392B';
    const sans   = this._fontSans || 'Inter,sans-serif';

    if (!points || points.length < 2) {
      wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${cMuted};font-size:0.9em;font-family:${sans}">Pas assez de données sur cette période</div>`;
      return;
    }

    const NS = "http://www.w3.org/2000/svg";
    const W = wrap.offsetWidth || wrap.parentElement?.offsetWidth || 340;
    const H = 200;
    const pad = { t: 16, r: 14, b: 26, l: 44 };
    const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;

    const ts = points.map(p => new Date(p.t).getTime());
    const vs = points.map(p => p.v);
    const tMin = Math.min(...ts), tMax = Math.max(...ts);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    const vSpanRaw = vMax - vMin;
    const lo = vMin - (vSpanRaw || 1) * 0.12;
    const hi = vMax + (vSpanRaw || 1) * 0.12;
    const span = hi - lo || 1;
    const tSpan = tMax - tMin || 1;

    const px = t => pad.l + ((t - tMin) / tSpan) * cw;
    const py = v => pad.t + ch - ((v - lo) / span) * ch;
    const mk = tag => document.createElementNS(NS, tag);
    const at = (el, a) => { Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v)); return el; };

    const svg = at(mk("svg"), { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.style.cssText = "display:block;width:100%;height:100%";
    const defs = mk("defs");
    const grad = at(mk("linearGradient"), { id: "eg", x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(at(mk("stop"), { offset: "0%", "stop-color": cAccent, "stop-opacity": "0.35" }));
    grad.appendChild(at(mk("stop"), { offset: "100%", "stop-color": cAccent, "stop-opacity": "0.02" }));
    defs.appendChild(grad); svg.appendChild(defs);
    svg.appendChild(at(mk("rect"), { x: 0, y: 0, width: W, height: H, fill: cBg }));

    for (let g = 0; g <= 4; g++) {
      const v = hi - span * g / 4;
      const y = (pad.t + ch * g / 4).toFixed(1);
      svg.appendChild(at(mk("line"), { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: cGrid, "stroke-width": "1" }));
      const txt = at(mk("text"), { x: pad.l - 5, y: (parseFloat(y) + 3.5).toFixed(1), "text-anchor": "end", fill: cMuted, "font-size": "10", "font-family": sans });
      txt.textContent = (Math.round(v * 10) / 10) + unit;
      svg.appendChild(txt);
    }

    // Étiquettes de temps (début / milieu / fin)
    [0, 0.5, 1].forEach(f => {
      const t = tMin + tSpan * f;
      const d = new Date(t);
      const x = px(t);
      const lbl = tSpan > 36 * 3600 * 1000
        ? `${d.getDate()}/${d.getMonth() + 1}`
        : `${String(d.getHours()).padStart(2, "0")}h`;
      const txt = at(mk("text"), { x: x, y: H - 8, "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle", fill: cMuted, "font-size": "10", "font-family": sans });
      txt.textContent = lbl;
      svg.appendChild(txt);
    });

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(ts[i]).toFixed(1)} ${py(p.v).toFixed(1)}`).join(" ");
    const area = `${line} L ${px(tMax).toFixed(1)} ${(pad.t + ch).toFixed(1)} L ${px(tMin).toFixed(1)} ${(pad.t + ch).toFixed(1)} Z`;
    svg.appendChild(at(mk("path"), { d: area, fill: "url(#eg)" }));
    svg.appendChild(at(mk("path"), { d: line, fill: "none", stroke: cAccent, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));

    // Min / max
    const tMaxV = ts[vs.indexOf(vMax)], tMinV = ts[vs.indexOf(vMin)];
    [[tMaxV, vMax], [tMinV, vMin]].forEach(([t, v]) =>
      svg.appendChild(at(mk("circle"), { cx: px(t).toFixed(1), cy: py(v).toFixed(1), r: "2.5", fill: cText })));

    wrap.appendChild(svg);
  }

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

    // Retirer : v7.1.7 — une seule bouteille OU tout le vin. Avant, ce bouton
    // supprimait toujours TOUS les exemplaires (un vin = une fiche + N
    // emplacements) : impossible de retirer une bouteille sans la marquer bue.
    box.querySelector("#det-remove")?.addEventListener("click", async () => {
      const cnt = wine.slots?.length || 0;
      if (cnt > 1) {
        this._closeModal();
        this._openModal("removepick", { wine });   // choix de l'emplacement
        return;
      }
      if (await this._confirm(`Retirer "${wine.name}" de la cave ?`)) {
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

  // card_mod-friendly : on écrit le contenu dans un conteneur stable (#mm-root) au
  // lieu d'écraser tout le shadowRoot. Les <style> injectés par card_mod sont des
  // FRÈRES de #mm-root → ils survivent à chaque re-rendu (plus de flash de style).
  _writeRoot(html) {
    let root = this.shadowRoot.getElementById("mm-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "mm-root";
      this.shadowRoot.appendChild(root);
    }
    root.innerHTML = html;
  }

  _renderLoading() {
    this._writeRoot(CARD_CSS + this._fontCSS() + `
      <div class="card">
        <div class="loading-state"><div class="loading-glass">${GLASS_SVG}</div></div>
      </div>`);
  }

  _render() {
    this._hideBottlePanel();   // éviter un panneau orphelin après reconstruction du DOM
    const data   = this._data || DEFAULT_DATA();
    const racks = data.cellar?.racks || [];
    const wines  = data.wines || [];
    this._writeRoot(CARD_CSS + this._fontCSS() + `
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
      </div>`);
    this._bindCardListeners(data, wines);
    if (this._view === "3d") this._mount3D(); else this._unmount3D();
  }

  _renderHeader(data, wines) {
    const total  = wines.reduce((s, w) => s + (w.slots?.length || 0), 0);
    const value  = wines.reduce((s, w) => s + (w.price || 0) * (w.slots?.length || 0), 0);
    const nRack = data.cellar?.racks?.length || 0;
    // v7.1.0 : rangée d'actions refondue — « À ouvrir » remonte de la rangée
    // capteurs (rouge, icône personnalisable), Sommelier au centre (rouge,
    // icône personnalisable), « + Casier »/« + Vin » fusionnés en « ➕ Ajouter »
    // (gris : la couleur est réservée aux fonctions du vin) avec petit menu.
    const occActive = !!this._occasionFilter;
    const occTitle = occActive
      ? `Filtre actif : ${esc((EVENT_TYPES.find(e => e.v === this._occasionFilter) || {}).l || "")}`
      : "À ouvrir : accords, envies, apogée, occasions";
    const openBtn = `
      <button class="btn-rack btn-open-top ${occActive ? "btn-open-top--active" : ""}" id="btn-open-page" title="${occTitle}">
        ${hdrIconSVG(hdrIconPref("open"))}À ouvrir</button>`;
    const somBtn = `
      <button class="btn-rack btn-sommelier" id="btn-sommelier-top" title="Sommelier IA : conseil d'achat &amp; opportunité">
        ${hdrIconSVG(hdrIconPref("som"))}Sommelier</button>`;
    const addBtn = `
      <div class="add-wrap">
        <button class="btn-rack btn-add" id="btn-add-main" title="Ajouter un vin ou un casier">➕ Ajouter</button>
        <div class="add-menu" id="add-menu" hidden>
          <button class="add-mi" id="btn-add-bottle">🍷 Un vin</button>
          <button class="add-mi" id="btn-add-rack">🗄️ Un casier</button>
        </div>
      </div>`;

    return `
      <div class="header">
        <div class="header-left">
          <div class="header-glass">${GLASS_SVG}</div>
          <div class="header-meta">
            ${(data.cellars?.length || 0) > 1 && !this._config?.cellar_id
              ? `<select class="cellar-select" id="sel-cellar" title="Changer de cave">
                  ${data.cellars.map(c =>
                    `<option value="${esc(c.id)}" ${c.id === this._cellarId ? "selected" : ""}>${esc(c.name || "Cave")}</option>`).join("")}
                </select>`
              : `<div class="header-name">${esc(data.cellar?.name || "Millésime")}</div>`}
            <div class="header-tagline">Cave à vin${(data.cellars?.length || 0) > 1 ? ` · ${data.cellars.length} caves` : ""}</div>
          </div>
        </div>
        <div class="header-right">
          <div class="header-stats">
            <div class="stat stat-clickable" id="btn-bottlelist" title="Voir la liste des bouteilles"><span class="stat-value">${total}</span><span class="stat-label">Bouteilles</span></div>
            <div class="stat stat-clickable" id="btn-racklist" title="Voir la liste des casiers"><span class="stat-value">${nRack}</span><span class="stat-label">Casiers</span></div>
            <div class="stat stat-clickable" id="btn-history" title="Évolution de la valeur de la cave">
              <span class="stat-value">${value > 0 ? Math.round(value) + "€" : "—"}</span><span class="stat-label">Valeur</span>
            </div>
            <button class="btn-icon btn-options-top" id="btn-options" title="Options" aria-label="Options">⚙️</button>
          </div>
          <div class="header-actions">
            ${openBtn}
            ${somBtn}
            ${addBtn}
            <button class="btn-icon btn-journal-top" id="btn-journal" title="Journal de dégustation">📓</button>
          </div>
        </div>
      </div>
      <div id="refresh-progress-zone"></div>`;
  }

  // ── Fenêtre Options (modal dédié, remplace l'ancien menu repliable) ──
  _optionsHTML() {
    const labelSel = `
      <div class="seg3" id="seg-labelmode" role="group" aria-label="Repères 3D">
        ${[["plate", "🏷️", "Étiquette"], ["bubble", "🔵", "Bulle"], ["both", "⊕", "Les deux"]]
          .map(([v, icon, lbl]) =>
            `<button type="button" class="seg3-btn ${this._labelMode === v ? "active" : ""}" data-mode="${v}" title="${lbl}">${icon}<span class="seg3-lbl">${lbl}</span></button>`)
          .join("")}
      </div>`;
    const cellarName = esc(this._data?.cellar?.name || "Millésime");
    return `
      <div class="mm-header">
        <span class="mm-title">⚙️ Options</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="mm-opt-list">
          <!-- v7.0.2 : ACTIONS cliquables d'abord, RÉGLAGES à choix ensuite -->
          <button class="mm-opt-item" id="btn-refresh">
            <span class="mm-opt-emoji">♻️</span>
            <span class="mm-opt-txt"><b>Compléter les fiches</b><small>Fusionne les doublons puis remplit les champs vides via l'IA</small></span>
          </button>
          <button class="mm-opt-item" id="btn-custom">
            <span class="mm-opt-emoji">🎨</span>
            <span class="mm-opt-txt"><b>Personnalisation</b><small>Icônes des boutons « À ouvrir » et « Sommelier »</small></span>
          </button>
          <button class="mm-opt-item" id="btn-cellars">
            <span class="mm-opt-emoji">🏰</span>
            <span class="mm-opt-txt"><b>Gérer les caves</b><small>Ajouter, renommer ou supprimer des caves</small></span>
          </button>
          <button class="mm-opt-item" id="btn-sensors">
            <span class="mm-opt-emoji">🌡️</span>
            <span class="mm-opt-txt"><b>Capteurs T° / humidité</b><small>Associer les sondes de « ${cellarName} »</small></span>
          </button>
          <button class="mm-opt-item" id="btn-import">
            <span class="mm-opt-emoji">📥</span>
            <span class="mm-opt-txt"><b>Importer des données</b><small>Fichier millesime_import_vinotag.csv → ${cellarName}</small></span>
          </button>
          <div class="mm-opt-item mm-opt-static">
            <div class="mm-opt-row">
              <span class="mm-opt-emoji">👁️</span>
              <span class="mm-opt-txt"><b>Mode d'affichage</b><small>Rendu de la cave sur la carte (mémorisé sur cet appareil)</small></span>
            </div>
            <div class="seg3" id="seg-viewmode" role="group" aria-label="Mode d'affichage">
              ${[["2d", "▦", "Bouteilles"], ["dot", "⠿", "Pastilles"], ["3d", "🧊", "3D"]]
                .map(([v, icon, lbl]) =>
                  `<button type="button" class="seg3-btn ${this._view === v ? "active" : ""}" data-mode="${v}" title="${lbl}">${icon}<span class="seg3-lbl">${lbl}</span></button>`)
                .join("")}
            </div>
            <!-- v7.0.2 : espacement des clayettes — déplié UNIQUEMENT en vue 3D,
                 appliqué en direct sur la scène, mémorisé par appareil -->
            <div class="opt-gap ${this._view === "3d" ? "" : "opt-gap--hidden"}" id="opt-gap">
              <div class="opt-gap-head">
                <span>↕️ Espacement des clayettes</span>
                <b id="opt-gap-val">${this._shelfGapPct()} %</b>
              </div>
              <input type="range" id="opt-gap-range" min="60" max="180" step="5" value="${this._shelfGapPct()}" aria-label="Espacement des clayettes">
              <small class="opt-gap-hint">Appliqué en direct · mémorisé sur cet appareil</small>
            </div>
          </div>
          <div class="mm-opt-item mm-opt-static">
            <div class="mm-opt-row">
              <span class="mm-opt-emoji">🧊</span>
              <span class="mm-opt-txt"><b>Repères 3D</b><small>Affichage des noms sur les casiers en vue 3D</small></span>
            </div>
            ${labelSel}
          </div>
          <div class="mm-opt-item mm-opt-static">
            <div class="mm-opt-row">
              <span class="mm-opt-emoji">🌸</span>
              <span class="mm-opt-txt"><b>Profil aromatique</b><small>Type de graphique dans la fiche du vin</small></span>
            </div>
            <div class="seg3" id="seg-aromamode">
              <button type="button" class="seg3-btn ${this._aromaMode === "radar" ? "active" : ""}" data-mode="radar">🕸️<span class="seg3-lbl">Radar</span></button>
              <button type="button" class="seg3-btn ${this._aromaMode === "bars" ? "active" : ""}" data-mode="bars">📊<span class="seg3-lbl">Barres</span></button>
            </div>
          </div>
          <div class="mm-opt-item mm-opt-static">
            <div class="mm-opt-row">
              <span class="mm-opt-emoji">✨</span>
              <span class="mm-opt-txt"><b>IA automatique dans les accords</b><small>Affine chaque recherche d'accord via Gemini, sans bouton</small></span>
            </div>
            <div class="seg3" id="seg-autoai">
              <button type="button" class="seg3-btn ${this._autoAI ? "active" : ""}" data-mode="on">✓<span class="seg3-lbl">Activée</span></button>
              <button type="button" class="seg3-btn ${!this._autoAI ? "active" : ""}" data-mode="off">✕<span class="seg3-lbl">Désactivée</span></button>
            </div>
          </div>
          <div class="mm-opt-tokens" id="opt-tokens">Consommation IA du jour : chargement…</div>
        </div>
      </div>`;
  }

  // Espacement des clayettes en % (v7.0.2) — 100 = espacement historique
  _shelfGapPct() {
    if (this._shelfGap == null) {
      let v = 100;
      try { v = parseInt(localStorage.getItem("millesime-shelf-gap")) || 100; } catch (e) {}
      this._shelfGap = Math.max(60, Math.min(180, v));
    }
    return this._shelfGap;
  }

  // ── Personnalisation (v7.1.0) : choix des icônes des boutons du header ─────
  _customHTML() {
    const row = (kind, title) => `
      <div class="ico-grp">${title}</div>
      <div class="ico-choices" data-kind="${kind}">
        ${HDR_ICON_SETS[kind].map(([name, lbl]) => `
          <button type="button" class="ico-choice ${hdrIconPref(kind) === name ? "sel" : ""}" data-ico="${name}">
            <span class="ico-check">✓</span>
            ${hdrIconSVG(name, 27)}
            <span class="ico-lbl">${lbl}</span>
          </button>`).join("")}
      </div>`;
    return `
      <div class="mm-header">
        <span class="mm-title">🎨 Personnalisation</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="occ-hint">Choisissez l'icône de chaque bouton — appliquée en direct, mémorisée sur cet appareil.</div>
        ${row("open", "🍾 Icône du bouton « À ouvrir »")}
        ${row("som", "🤵 Icône du bouton « Sommelier »")}
        <div class="mm-hint">Icônes : game-icons.net (Delapouite &amp; Lorc), licence CC BY 3.0.</div>
      </div>`;
  }

  _bindCustomModal(box) {
    box.querySelectorAll(".ico-choices").forEach((grp) => {
      const kind = grp.dataset.kind;
      grp.querySelectorAll(".ico-choice").forEach((btn) =>
        btn.addEventListener("click", () => {
          try { localStorage.setItem(`millesime-ico-${kind}`, btn.dataset.ico); } catch (e) {}
          grp.querySelectorAll(".ico-choice").forEach(b => b.classList.toggle("sel", b === btn));
          this._render();   // le header derrière la fenêtre change d'icône immédiatement
        })
      );
    });
  }

  _bindOptionsModal(box) {
    // Mode d'affichage (v7.0.1 : déplacé depuis le header)
    box.querySelectorAll("#seg-viewmode .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._viewTouched = true;
        this._view = btn.dataset.mode;
        try { localStorage.setItem("millesime-view", this._view); } catch (err) {}
        box.querySelectorAll("#seg-viewmode .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
        // v7.0.2 : le réglage d'espacement n'a de sens qu'en 3D
        box.querySelector("#opt-gap")?.classList.toggle("opt-gap--hidden", this._view !== "3d");
        this._render();   // la carte derrière la fenêtre bascule immédiatement
      })
    );
    // v7.0.2 : espacement des clayettes — libellé en direct pendant le glissé,
    // application (re-rendu 3D) au relâchement pour rester fluide sur iPhone
    const gapRange = box.querySelector("#opt-gap-range");
    gapRange?.addEventListener("input", () => {
      const el = box.querySelector("#opt-gap-val");
      if (el) el.textContent = `${gapRange.value} %`;
    });
    gapRange?.addEventListener("change", () => {
      this._shelfGap = Math.max(60, Math.min(180, parseInt(gapRange.value) || 100));
      try { localStorage.setItem("millesime-shelf-gap", String(this._shelfGap)); } catch (err) {}
      if (this._view === "3d") this._render();
    });
    box.querySelectorAll("#seg-aromamode .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._aromaMode = btn.dataset.mode;
        try { localStorage.setItem("millesime-aroma-mode", this._aromaMode); } catch (err) {}
        box.querySelectorAll("#seg-aromamode .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
      })
    );
    box.querySelectorAll("#seg-autoai .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._autoAI = btn.dataset.mode === "on";
        try { localStorage.setItem("millesime-auto-ai", this._autoAI ? "1" : "0"); } catch (err) {}
        box.querySelectorAll("#seg-autoai .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
      })
    );
    // Compteur de tokens du jour (remis à zéro à minuit côté backend).
    // v7.0.1 : barre de progression contre le budget quotidien estimé du
    // free tier Gemini (GEMINI_FREE_TIER_DAILY_BUDGET), % affiché SUR la barre.
    (async () => {
      const el = box.querySelector("#opt-tokens");
      if (!el) return;
      try {
        const r = await this._hass.connection.sendMessagePromise({ type: "millesime/ai_usage" });
        const u = r?.usage || {};
        const total = (u.prompt || 0) + (u.output || 0);
        const pct = Math.min(100, Math.round((total / GEMINI_FREE_TIER_DAILY_BUDGET) * 100));
        const warn = pct >= 80;
        el.innerHTML = `
          <div class="mm-tokbar-label">Consommation IA du jour :
            <b>${total.toLocaleString("fr-FR")}</b> / ~${GEMINI_FREE_TIER_DAILY_BUDGET.toLocaleString("fr-FR")} tokens
            ${total ? `(${(u.prompt || 0).toLocaleString("fr-FR")} envoyés · ${(u.output || 0).toLocaleString("fr-FR")} reçus · ${u.calls || 0} appels)` : "(aucune requête pour l'instant)"}
          </div>
          <div class="mm-tokbar-track">
            <div class="mm-tokbar-fill ${warn ? "mm-tokbar-fill--warn" : ""}" style="width:${Math.max(pct, 2)}%"></div>
            <span class="mm-tokbar-pct">${pct} %</span>
          </div>
          <div class="mm-tokbar-hint">Budget estimé du free tier Gemini (≈ 250 requêtes/j) — remis à zéro chaque nuit, quotas Google susceptibles de changer.</div>`;
      } catch (e) { el.textContent = "Consommation IA du jour : indisponible"; }
    })();
    box.querySelectorAll("#seg-labelmode .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._labelMode = btn.dataset.mode;
        try { localStorage.setItem("millesime-labelmode", this._labelMode); } catch (err) {}
        box.querySelectorAll("#seg-labelmode .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
        if (this._view === "3d") this._render();
      })
    );
    box.querySelector("#btn-import")?.addEventListener("click", async () => {
      const ok = await this._confirm(
        "Importer le fichier millesime_import_vinotag.csv (export Vinotag) ? " +
        "Les bouteilles seront placées automatiquement dans les emplacements libres " +
        "et le fichier sera effacé après import."
      );
      if (!ok) return;
      if (await this._callService("import_vinotag", { cellar_id: this._cellarId || undefined }))
        this._showToast("success", "Import Vinotag effectué ✓");
    });
    box.querySelector("#btn-refresh")?.addEventListener("click", async () => {
      const res = await this._confirm(
        "Rafraîchir toutes les fiches ? Les doublons (même nom, millésime, type) seront " +
        "fusionnés avec regroupement des emplacements, puis les champs vides seront " +
        "complétés via Gemini. Les données saisies ne sont jamais écrasées — sauf si l'une " +
        "des options ci-dessous est cochée. " +
        "L'opération peut prendre plusieurs minutes selon le nombre de vins.",
        {
          checkbox: "💰 Mettre à jour les prix (prix moyen constaté par Gemini)",
          checkboxes: [{
            key: "tighten_apogee",
            label: "📐 Resserrer les fenêtres d'apogée trop larges (> 12 ans d'écart)",
          }],
        }
      );
      if (!res) return;
      this._showToast("info", "Rafraîchissement lancé — suivez la progression sous l'en-tête…");
      await this._callService("refresh_wines", {
        update_prices: !!res.checked,
        tighten_apogee: !!res.tighten_apogee,
      });
    });
    box.querySelector("#btn-cellars")?.addEventListener("click", () => this._openModal("cellars"));
    box.querySelector("#btn-custom")?.addEventListener("click", () => this._openModal("custom"));   // v7.1.0
    box.querySelector("#btn-sensors")?.addEventListener("click", () => this._openModal("sensors"));
  }

  // Compresse une image (File ou data URL) : redimensionne à ~600px max,
  // JPEG qualité 0.7 → ~40-80 Ko, pour ne pas alourdir le stockage HA.
  // ── Repli caméra via getUserMedia (Android, issue #7) ────────────────────────
  // Sur certains appareils Android, la WebView ouvre la galerie même avec un
  // input statique portant l'attribut capture. v7.0.1 : getUserMedia est tenté
  // sur TOUS les appareils qui l'exposent (plus seulement Android) — c'est le
  // seul chemin qui garantit l'appareil photo. L'API n'existe qu'en contexte
  // sécurisé (HTTPS / app compagnon en URL externe / localhost) : en HTTP
  // local, on prévient explicitement l'utilisateur avant le repli galerie.
  _cameraSupported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  // Explique POURQUOI la galerie risque de s'ouvrir à la place de l'appareil
  // photo (appelé juste avant le repli sur l'input statique).
  // v7.1.8 : formulation revue — plusieurs utilisateurs ont pris ce message pour
  // une panne de Millésime. Ce n'en est pas une : les navigateurs INTERDISENT
  // l'accès à la caméra sur une connexion non sécurisée, aucune application ne
  // peut le contourner. Le scan reste possible via la galerie.
  _cameraFallbackNotice(reason) {
    if (reason === "insecure") {
      this._showToast("info",
        "Photo depuis la galerie : l'accès direct à l'appareil photo est réservé " +
        "aux connexions sécurisées (https). Ce n'est pas un défaut de Millésime — " +
        "prenez la photo avec votre appareil photo puis choisissez-la dans la galerie, " +
        "ou accédez à Home Assistant en https (URL externe / Nabu Casa) pour la prise directe.");
    } else if (reason === "denied") {
      this._showToast("error",
        "Accès caméra refusé — vérifiez les permissions de l'app Home Assistant " +
        "(Réglages → Applications → Home Assistant → Autorisations → Appareil photo). " +
        "En attendant, la photo depuis la galerie fonctionne.");
    }
  }

  // Résout avec : File (photo capturée) | "cancel" (fermé par l'utilisateur)
  // | null (échec technique → l'appelant retombe sur l'input statique).
  async _captureViaCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this._cameraFallbackNotice("insecure");
      return null;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      console.warn("[Millésime] getUserMedia indisponible :", err);
      this._cameraFallbackNotice(
        (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) ? "denied" : "insecure");
      return null;
    }
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:#000;display:flex;flex-direction:column;";
      const video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.muted = true;
      video.style.cssText = "flex:1;min-height:0;width:100%;object-fit:contain;background:#000;";
      video.srcObject = stream;
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;gap:14px;justify-content:center;align-items:center;background:#111;" +
        "padding:16px 16px calc(env(safe-area-inset-bottom, 0px) + 16px);";
      const mkBtn = (txt, primary) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = txt;
        b.style.cssText = "border:none;border-radius:999px;padding:14px 26px;font-size:1em;cursor:pointer;" +
          (primary ? "background:#7B1D2E;color:#fff;font-weight:600;" : "background:#333;color:#ddd;");
        return b;
      };
      const btnShot = mkBtn("📷 Capturer", true);
      const btnCancel = mkBtn("Annuler", false);
      const done = (result) => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch (err) {}
        overlay.remove();
        resolve(result);
      };
      btnShot.addEventListener("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          done(blob ? new File([blob], "capture.jpg", { type: "image/jpeg" }) : null);
        }, "image/jpeg", 0.92);
      });
      btnCancel.addEventListener("click", () => done("cancel"));
      bar.appendChild(btnCancel);
      bar.appendChild(btnShot);
      overlay.appendChild(video);
      overlay.appendChild(bar);
      document.body.appendChild(overlay);
    });
  }

  _compressImage(fileOrDataUrl, maxSize = 600, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        else if (h > maxSize)     { w = Math.round(w * maxSize / h); h = maxSize; }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL("image/jpeg", quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("Image illisible"));
      if (typeof fileOrDataUrl === "string") img.src = fileOrDataUrl;
      else {
        const r = new FileReader();
        r.onload = () => { img.src = r.result; };
        r.onerror = () => reject(new Error("Lecture fichier impossible"));
        r.readAsDataURL(fileOrDataUrl);
      }
    });
  }

  // v7.1.9 : producteurs déjà saisis dans la cave — normalise « Ch. Saint Ahon »
  // vs « Château Saint Ahon » sans liste mondiale à maintenir.
  _producerSuggestions() {
    const seen = new Map();
    for (const w of (this._data?.wines || [])) {
      const p = (w.producer || "").trim();
      if (p) seen.set(p.toLowerCase(), p);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  _donorSuggestions() {
    // Noms de donateurs déjà saisis (champ « De la part de »), pour l'autocomplétion
    const set = new Set();
    for (const w of (this._data?.wines || [])) {
      const g = (w.gifted_by || "").trim();
      if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  _sensorVal(entityId) {
    // Valeur courante d'un capteur, lue en temps réel depuis hass.states
    if (!entityId || !this._hass) return null;
    const st = this._hass.states[entityId];
    if (!st || st.state === "unavailable" || st.state === "unknown") return null;
    const v = parseFloat(st.state);
    return {
      value: isNaN(v) ? st.state : v,
      unit: st.attributes?.unit_of_measurement || "",
      name: st.attributes?.friendly_name || entityId,
    };
  }

  _renderFilters() {
    const cellar = this._data?.cellar || {};
    const temp = this._sensorVal(cellar.temp_entity);
    const humid = this._sensorVal(cellar.humid_entity);
    // v7.1.0 : « À ouvrir » a rejoint la rangée d'actions du header — les
    // capteurs occupent désormais toute la largeur.
    return `
      <div class="env-row">
        <div class="env-box ${cellar.temp_entity ? "env-clickable" : "env-empty"}" id="env-temp" title="Température">
          <span class="env-value">🌡️ ${temp ? `${temp.value}${temp.unit || "°"}` : "—"}</span>
        </div>
        <div class="env-box ${cellar.humid_entity ? "env-clickable" : "env-empty"}" id="env-humid" title="Hygrométrie">
          <span class="env-value">💧 ${humid ? `${humid.value}${humid.unit || "%"}` : "—"}</span>
        </div>
      </div>`;
  }

  // Page "À ouvrir" : 4 onglets depuis v7.0.1 (Accords, Envie de…, Apogée, Occasions)
  _openPageHTML() {
    const tab = this._filterTab || "occasions";
    const occBtns = EVENT_TYPES.filter(e => e.v).map(e =>
      `<button class="occ-btn ${this._occasionFilter === e.v ? "active" : ""}" data-occ="${e.v}">${e.emoji} ${e.l}</button>`
    ).join("");
    return `
      <div class="mm-header">
        <span class="mm-title">🍷 À ouvrir</span>
        <button class="mm-close" data-close>✕</button>
      </div>
      <div class="mm-body">
        <div class="sub-tabs">
          <button class="sub-tab ${tab === "accords" ? "active" : ""}" data-tab="accords">🍽️ Accords</button>
          <button class="sub-tab ${tab === "envie" ? "active" : ""}" data-tab="envie">🍷 Envie de…</button>
          <button class="sub-tab ${tab === "apogee" ? "active" : ""}" data-tab="apogee">🕐 Apogée</button>
          <button class="sub-tab ${tab === "occasions" ? "active" : ""}" data-tab="occasions">🥂 Occasions</button>
        </div>
        <div class="sub-panel ${tab === "accords" ? "active" : ""}" data-panel="accords">
          ${this._accordsHTML()}
        </div>
        <div class="sub-panel ${tab === "envie" ? "active" : ""}" data-panel="envie">
          ${this._envieHTML()}
        </div>
        <div class="sub-panel ${tab === "apogee" ? "active" : ""}" data-panel="apogee">
          ${this._apogeeHTML()}
        </div>
        <div class="sub-panel ${tab === "occasions" ? "active" : ""}" data-panel="occasions">
          <div class="occ-hint">Choisissez une occasion : la fenêtre se ferme et les bouteilles concernées s'affichent en surbrillance dans la cave.</div>
          <div class="occ-btns">
            <button class="occ-btn ${!this._occasionFilter ? "active" : ""}" data-occ="">Tout afficher</button>
            ${occBtns}
          </div>
        </div>
      </div>`;
  }

  // ── APOGÉE : état d'une bouteille selon ses dates et l'année courante ──
  // États d'apogée (v7.0.0, fenêtres affinées) :
  //   now  = AUJOURD'HUI dans la fenêtre [drink_from, drink_until] — y compris
  //          en fin de fenêtre : c'est là que l'urgence est maximale, le tri
  //          par drink_until croissant (top 10) fait remonter ces vins en tête
  //   soon = la fenêtre s'ouvre dans les 2 ans
  //   keep = la fenêtre s'ouvre au-delà de 2 ans
  //   past = la fenêtre est dépassée
  _apogeeState(w) {
    const now = new Date().getFullYear();
    const from = parseInt(w.drink_from) || 0;
    const until = parseInt(w.drink_until) || 0;
    if (!from && !until) return "none";
    if (until && until < now) return "past";
    if (from && from > now) return (from <= now + 2) ? "soon" : "keep";
    return "now";
  }

  // Urgence d'un vin « à boire » : fin de fenêtre la plus proche d'abord ;
  // à fin égale, la fenêtre ouverte depuis le plus longtemps passe devant
  _apogeeUrgencySort(a, b) {
    const ua = parseInt(a.drink_until) || 9999, ub = parseInt(b.drink_until) || 9999;
    if (ua !== ub) return ua - ub;
    return (parseInt(a.drink_from) || 0) - (parseInt(b.drink_from) || 0);
  }

  // ── Filtres du Profil de garde (v7.0.1) : couleur de vin + région ──────────
  // this._apoColor ("" = toutes) et this._apoRegion ("" = toutes) s'appliquent
  // au graphique, aux compteurs d'état, au top priorités et aux listes.
  _apoFilteredWines() {
    let wines = this._data?.wines || [];
    if (this._apoColor)  wines = wines.filter(w => (w.type || "red") === this._apoColor);
    if (this._apoRegion) wines = wines.filter(w => (w.region || "").trim() === this._apoRegion);
    return wines;
  }

  _apoRegionsList() {
    const set = new Set();
    for (const w of (this._data?.wines || [])) {
      const r = (w.region || "").trim();
      if (r) set.add(r);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ── Graphique « Profil de garde » : un segment horizontal par vin ──────────
  // SVG natif (comme l'historique de valeur) : axe X = années, chaque vin est
  // un segment [drink_from → drink_until] dans la couleur de son type, nom
  // tronqué à gauche, ligne verticale dorée « aujourd'hui ». Tap sur une ligne
  // → fiche du vin. Les vins sans fenêtre n'apparaissent pas.
  _apogeeChartSVG() {
    const wines = this._apoFilteredWines()
      .filter(w => (parseInt(w.drink_from) || 0) && (parseInt(w.drink_until) || 0))
      .sort((a, b) => (parseInt(a.drink_from) - parseInt(b.drink_from))
                   || (parseInt(a.drink_until) - parseInt(b.drink_until)));
    if (!wines.length)
      return `<div class="apo-chart-empty">${(this._apoColor || this._apoRegion)
        ? "Aucun vin ne correspond aux filtres choisis."
        : "Aucune fenêtre d'apogée renseignée — lancez « Compléter les fiches » (⚙️ Options) pour les obtenir."}</div>`;
    const now = new Date().getFullYear();
    let minY = Math.min(now, ...wines.map(w => parseInt(w.drink_from)));
    let maxY = Math.max(now, ...wines.map(w => parseInt(w.drink_until)));
    minY -= 1; maxY += 1;
    const span = Math.max(1, maxY - minY);
    const W = 100;                                   // largeur logique (viewBox %)
    const NAME_W = 30;                               // colonne des noms (%)
    const ROW_H = 12, TOP = 16, BOT = 14;
    const H = TOP + wines.length * ROW_H + BOT;
    const x = (year) => NAME_W + ((year - minY) / span) * (W - NAME_W - 2);
    // Graduations : pas adaptatif pour ~5-8 libellés
    const step = span <= 8 ? 1 : span <= 16 ? 2 : span <= 40 ? 5 : 10;
    let grid = "";
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      grid += `<line x1="${x(y)}" y1="${TOP - 4}" x2="${x(y)}" y2="${H - BOT + 2}" stroke="var(--mm-border)" stroke-width="0.15"/>
               <text x="${x(y)}" y="${H - 3}" font-size="3.2" fill="var(--mm-muted)" text-anchor="middle">${y}</text>`;
    }
    const rows = wines.map((w, i) => {
      const t = WINE_TYPES[w.type] || WINE_TYPES.red;
      const y = TOP + i * ROW_H + ROW_H / 2;
      const x1 = x(parseInt(w.drink_from)), x2 = Math.max(x(parseInt(w.drink_until)), x1 + 0.8);
      const name = (w.name || "Sans nom") + (w.vintage ? " " + w.vintage : "");
      const past = this._apogeeState(w) === "past";
      return `
        <g class="apo-seg" data-wine="${esc(w.id)}" style="cursor:pointer">
          <rect x="0" y="${y - ROW_H / 2}" width="${W}" height="${ROW_H}" fill="transparent"/>
          <text x="${NAME_W - 1.5}" y="${y + 1.2}" font-size="3.4" fill="var(--mm-text)" text-anchor="end" opacity="${past ? 0.45 : 0.9}">
            ${esc(name.length > 22 ? name.slice(0, 21) + "…" : name)}
          </text>
          <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"
                stroke="${t.color}" stroke-width="3" stroke-linecap="round" opacity="${past ? 0.35 : 0.9}"/>
        </g>`;
    }).join("");
    // Ligne « aujourd'hui » au-dessus des segments
    const todayLine = `
      <line x1="${x(now)}" y1="${TOP - 6}" x2="${x(now)}" y2="${H - BOT + 2}"
            stroke="#d8b25c" stroke-width="0.45" stroke-dasharray="1.4 1"/>
      <text x="${x(now)}" y="${TOP - 8}" font-size="3.2" fill="#d8b25c" text-anchor="middle" font-weight="bold">${now}</text>`;
    return `
      <svg class="apo-chart-svg" viewBox="0 0 ${W} ${H}"
           style="width:100%;height:${Math.max(90, Math.round(H * 3.2))}px" role="img"
           aria-label="Profil de garde de la cave">
        ${grid}${rows}${todayLine}
      </svg>`;
  }

  // Rendu d'une bouteille pour une liste (réutilisé Apogée + Accords)
  // ── Étiquette de vin générée (style « vraie étiquette », sobre) ──
  // Styles inline en em → autonome et scalable (la taille est pilotée par le conteneur).
  // Affichée en grand sur la fiche et en miniature sur l'aperçu. S'adapte si des infos manquent.
  _wineLabelHTML(w) {
    const producer = (w.producer || "").trim();
    const name = (w.name || "Sans nom").trim();
    const showProducer = producer && producer.toLowerCase() !== name.toLowerCase();
    const appellation = (w.appellation || "").trim();
    const vintage = (w.vintage || "").toString().trim();
    const regionLine = [w.region, w.country].filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(" · ");
    return `
      <div class="mm-wlabel" style="background:linear-gradient(180deg,#f7f1e6,#ece2cf);border:0.09em solid #b9ab8f;border-radius:0.45em;padding:1.1em 1em;box-shadow:0 0.4em 1.2em rgba(0,0,0,0.45);">
        <div style="border:0.09em solid #bfa04f;border-radius:0.25em;padding:1em 0.8em;text-align:center;">
          ${showProducer ? `<div style="font-size:0.8em;letter-spacing:0.18em;color:#5a4632;text-transform:uppercase;line-height:1.25;">${esc(producer)}</div>
          <div style="height:0.07em;width:55%;margin:0.45em auto 0.55em;background:#bfa04f;opacity:0.55;"></div>` : ""}
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:1.65em;font-weight:bold;color:#241a12;line-height:1.12;">${esc(name)}</div>
          ${appellation ? `<div style="font-size:0.85em;font-style:italic;color:#4a3826;margin-top:0.4em;line-height:1.2;">${esc(appellation)}</div>` : ""}
          ${vintage ? `<div style="font-family:Georgia,serif;font-size:1.9em;font-weight:bold;color:#3a2a1c;letter-spacing:0.08em;margin-top:0.5em;">${esc(vintage)}</div>` : ""}
          ${regionLine ? `<div style="font-size:0.64em;letter-spacing:0.13em;color:#6a5946;text-transform:uppercase;margin-top:0.45em;line-height:1.2;">${esc(regionLine)}</div>` : ""}
          <div style="font-size:0.58em;color:#9c8a6a;opacity:0.75;margin-top:0.75em;letter-spacing:0.02em;">🍷 Millésime</div>
        </div>
      </div>`;
  }

  _miniWineRow(w, extra = "") {
    const t = WINE_TYPES[w.type] || WINE_TYPES.red;
    const n = (w.slots || []).length;
    const apo = (w.drink_from || w.drink_until)
      ? `${esc(w.drink_from || "?")}–${esc(w.drink_until || "?")}` : "";
    const sub = [w.appellation, w.region].filter(Boolean).map(esc).join(" · ");
    return `
      <div class="vlist-wine ap-wine" data-wine="${esc(w.id)}">
        <div class="vlist-wine-top">
          <span class="vlist-wine-name"><span class="rk-dot" style="background:${t.color}"></span>${esc(w.name || "Sans nom")}${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}</span>
          <span class="vlist-wine-tail">
            ${extra}
            <span class="rk-slot">×${n}</span>
            <span class="vlist-wine-price">${w.price ? Math.round(w.price) + "€" : ""}</span>
          </span>
        </div>
        ${(sub || apo) ? `<div class="vlist-wine-meta">${sub ? `<span class="vm">📍 ${sub}</span>` : ""}${apo ? `<span class="vm">🕐 ${apo}</span>` : ""}</div>` : ""}
      </div>`;
  }

  _apogeeHTML() {
    const wines = this._apoFilteredWines();
    const groups = { now: [], soon: [], keep: [], past: [], none: [] };
    for (const w of wines) groups[this._apogeeState(w)].push(w);
    // v7.0.1 : filtres d'affinage — couleur de vin et région (appliqués au
    // graphique, aux états et au top priorités)
    const colorOpts = [`<option value="">🍷 Toutes couleurs</option>`]
      .concat(Object.entries(WINE_TYPES).map(([v, t]) =>
        `<option value="${v}" ${this._apoColor === v ? "selected" : ""}>${t.emoji} ${t.label}</option>`))
      .join("");
    const regionOpts = [`<option value="">📍 Toutes régions</option>`]
      .concat(this._apoRegionsList().map(r =>
        `<option value="${esc(r)}" ${this._apoRegion === r ? "selected" : ""}>${esc(r)}</option>`))
      .join("");
    const filters = `
      <div class="apo-filters">
        <select class="mm-input apo-fsel" id="apo-f-color">${colorOpts}</select>
        <select class="mm-input apo-fsel" id="apo-f-region">${regionOpts}</select>
      </div>`;
    const states = [
      { k: "now",  emoji: "🟢", label: "À boire maintenant" },
      { k: "soon", emoji: "🟠", label: "Bientôt / à surveiller" },
      { k: "keep", emoji: "🔵", label: "À garder" },
      { k: "past", emoji: "🔴", label: "Apogée dépassée" },
    ];
    const btns = states.map(s => {
      const c = groups[s.k].reduce((a, w) => a + (w.slots || []).length, 0);
      return `<button class="apo-state" data-apo="${s.k}">
        <span class="apo-emoji">${s.emoji}</span>
        <span class="apo-label">${s.label}</span>
        <span class="apo-count">${c}</span>
      </button>`;
    }).join("");
    const noneCount = groups.none.reduce((a, w) => a + (w.slots || []).length, 0);
    // Top 10 des priorités (v7.0.1) : les apogées DÉPASSÉES remontent en tête
    // avec leur année réelle (« avant 2020 » et non un « avant 2026 » générique),
    // suivies des vins « à boire », fin de fenêtre la plus proche d'abord.
    const now = new Date().getFullYear();
    const top = groups.past.concat(groups.now)
      .filter(w => parseInt(w.drink_until))
      .sort((a, b) => this._apogeeUrgencySort(a, b)).slice(0, 10);
    const topHTML = top.length ? `
      <div class="apo-top">
        <div class="apo-top-title">🥇 À ouvrir en priorité</div>
        ${top.map((w, i) => {
          const until = parseInt(w.drink_until) || 0;
          const isPast = until && until < now;
          return `
          <button class="apo-top-row" data-wine="${esc(w.id)}">
            <span class="apo-top-rank">${i + 1}</span>
            <span class="apo-top-name">${esc(w.name || "Sans nom")}${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}</span>
            <span class="apo-top-until ${isPast ? "apo-top-until--past" : ""}">avant ${esc(w.drink_until || "?")}${isPast ? " ⚠️" : ""}</span>
          </button>`;
        }).join("")}
      </div>` : "";
    return `
      ${filters}
      <details class="apo-chart" id="apo-chart" ${(this._apoChartOpen ??= (() => { try { return localStorage.getItem("millesime-apo-chart") === "1"; } catch (e) { return false; } })()) ? "open" : ""}>
        <summary class="apo-chart-summary">📈 Profil de garde de la cave</summary>
        <div class="apo-chart-body">${this._apogeeChartSVG()}
          <div class="apo-chart-legend">Un trait par vin, de l'ouverture à la fin de sa fenêtre d'apogée · ligne dorée = aujourd'hui · touchez un vin pour ouvrir sa fiche</div>
        </div>
      </details>
      ${topHTML}
      <div class="apo-hint">Cliquez un état pour voir les bouteilles, puis une bouteille pour la localiser dans la cave.</div>
      <div class="apo-states">${btns}</div>
      ${noneCount ? `<div class="apo-none-note">${noneCount} bouteille${noneCount > 1 ? "s" : ""} sans dates d'apogée renseignées.</div>` : ""}
      <div class="apo-list" id="apo-list"></div>`;
  }

  // ── ACCORDS : score d'une bouteille pour un plat donné ──
  _matchScore(w, dish) {
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = 0;
    const pairing = norm(w.food_pairing);
    // 1) Correspondance avec les accords générés par l'IA (le plus fiable)
    for (const k of (dish.kw || [])) { if (pairing && pairing.includes(norm(k))) score += 10; }
    // 2) Type de vin idéal
    if ((dish.types || []).includes(w.type)) score += 4;
    // 3) Caractéristiques (notes de dégustation)
    const notes = norm(w.tasting_notes);
    for (const n of (dish.notes || [])) { if (notes && notes.includes(norm(n))) score += 2; }
    return score;
  }

  _accordsHTML() {
    // v7.0.0 : deux modes — « Un plat » (bibliothèque locale + IA auto) et
    // « Menu complet » (3 services, l'IA choisit 1-2 bouteilles DE LA CAVE)
    const fams = Object.keys(FOOD_LIBRARY);
    const famOpts = fams.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    const mode = this._accMode || "dish";
    return `
      <div class="seg3 seg3--sub acc-mode" id="acc-mode">
        <button type="button" class="seg3-btn ${mode === "dish" ? "active" : ""}" data-mode="dish">🍽️<span class="seg3-lbl">Un plat</span></button>
        <button type="button" class="seg3-btn ${mode === "menu" ? "active" : ""}" data-mode="menu">🍷<span class="seg3-lbl">Menu complet</span></button>
      </div>
      <div class="acc-pane" id="acc-pane-dish" style="display:${mode === "dish" ? "block" : "none"}">
        <div class="acc-hint">🍽️ <b>${FOOD_COUNT} plats référencés</b> — tapez un plat, ou parcourez les catégories : l'app propose les bouteilles de votre cave qui s'accordent le mieux.</div>
        <div class="acc-searchwrap">
          <input type="text" class="mm-input acc-search" id="acc-search" placeholder="🍽️ Quel plat ? (ex. bœuf bourguignon, curry de poulet, raclette…)" autocomplete="off">
          <button class="acc-go" id="acc-go">Trouver</button>
        </div>
        <div class="acc-or">— ou parcourir —</div>
        <div class="acc-selects">
          <select class="mm-input acc-sel" id="acc-fam"><option value="">— Famille —</option>${famOpts}</select>
          <select class="mm-input acc-sel" id="acc-cat" disabled><option value="">— Catégorie —</option></select>
          <select class="mm-input acc-sel" id="acc-dish" disabled><option value="">— Plat —</option></select>
        </div>
        <div class="acc-list" id="acc-list"></div>
      </div>
      <div class="acc-pane" id="acc-pane-menu" style="display:${mode === "menu" ? "block" : "none"}">
        <div class="acc-hint">🍷 Décrivez le repas : le sommelier IA choisit <b>1 à 2 bouteilles de votre cave</b> qui couvrent l'ensemble — pas besoin d'ouvrir trois bouteilles à deux ! Un champ peut rester vide.</div>
        <div class="acc-menu-fields">
          <label class="acc-menu-lbl">🥗 Entrée</label>
          <input type="text" class="mm-input" id="menu-starter" placeholder="ex. velouté de potimarron" autocomplete="off">
          <label class="acc-menu-lbl">🍖 Plat</label>
          <input type="text" class="mm-input" id="menu-main" placeholder="ex. côte de bœuf, gratin dauphinois" autocomplete="off">
          <label class="acc-menu-lbl">🍰 Dessert</label>
          <input type="text" class="mm-input" id="menu-dessert" placeholder="ex. tarte tatin" autocomplete="off">
        </div>
        <button class="acc-go acc-menu-go" id="menu-go">🍷 Choisir dans ma cave</button>
        <div class="acc-list" id="acc-menu-result"></div>
      </div>`;
  }

  // Construit un "profil de plat" depuis un texte libre via la table d'ingrédients
  _dishFromText(text) {
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(text);
    if (!q) return null;
    const types = {}, notes = {}, kw = [];
    let matched = 0;
    for (const [syns, prof] of PAIR_KEYWORDS) {
      if (syns.some(s => q.includes(norm(s)))) {
        matched++;
        kw.push(...syns);
        for (const t of (prof.types || [])) types[t] = (types[t] || 0) + 1;
        for (const n of (prof.notes || [])) notes[n] = (notes[n] || 0) + 1;
      }
    }
    if (!matched) return { kw: [text], types: [], notes: [], unknown: true };
    // garde les types/notes les plus fréquents
    const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return { kw, types: top(types), notes: top(notes), unknown: false };
  }

  // Rendu d'une liste de résultats d'accords (commun local + IA)
  _renderAccordsResults(list, items, { approx = false, ai = false } = {}) {
    const wines = this._data?.wines || [];
    if (!items.length) {
      list.innerHTML = `<div class="acc-empty">Aucune bouteille adaptée dans votre cave pour ce plat.</div>`;
      return;
    }
    const badge = (s) => s >= 14 ? `<span class="acc-badge acc-top">★ idéal</span>`
                      : s >= 10 ? `<span class="acc-badge">très bon</span>`
                      : s >= 4  ? `<span class="acc-badge acc-ok">bon</span>` : `<span class="acc-badge acc-low">proche</span>`;
    const head = ai ? `<div class="acc-aibadge">✨ Sélection IA selon votre cave</div>`
              : approx ? `<div class="acc-approx">Aucun accord parfait en local — voici les plus proches :</div>` : "";
    list.innerHTML = head + `<div class="vlist">${items.map(x => {
      const reason = x.reason ? `<div class="acc-reason">${esc(x.reason)}</div>` : "";
      return this._miniWineRow(x.w, ai ? "" : badge(x.s)) + reason;
    }).join("")}</div>`;
    list.querySelectorAll(".ap-wine[data-wine]").forEach((row) =>
      row.addEventListener("click", () => {
        const w = wines.find(x => x.id === row.dataset.wine);
        if (w) this._locateBottle(w);
      })
    );
  }

  // Matching local pour un profil de plat → bouteilles scorées
  _localMatch(dish) {
    const wines = this._data?.wines || [];
    const scored = wines.map(w => ({ w, s: this._matchScore(w, dish) })).sort((a, b) => b.s - a.s);
    const strong = scored.filter(x => x.s >= 4);
    if (strong.length) return { items: strong.slice(0, 30), approx: false };
    return { items: scored.filter(x => x.s > 0).slice(0, 10), approx: true };
  }

  // Appel IA : Gemini choisit parmi la cave
  // v7.0.0 : deux modes d'appel.
  //  - manuel (bouton ✨) : l'attente remplace la liste, comme avant ;
  //  - auto (keepLocal)   : le résultat LOCAL reste affiché — instantané — et
  //    l'IA le remplace silencieusement quand elle répond. En cas d'absence de
  //    clé, on mémorise (this._noKey) pour ne plus re-tenter dans la session.
  async _aiPairing(dish, list, { keepLocal = false } = {}) {
    let hint = null;
    if (keepLocal) {
      hint = document.createElement("div");
      hint.className = "acc-ai-hint";
      hint.innerHTML = `<span class="mm-spinner"></span> L'IA affine avec votre cave…`;
      list.appendChild(hint);
    } else {
      list.innerHTML = `<div class="acc-loading"><span class="mm-spinner"></span> L'IA choisit dans votre cave…</div>`;
    }
    try {
      const res = await this._hass.connection.sendMessagePromise({ type: "millesime/pair_food", dish });
      const wines = this._data?.wines || [];
      if (res?.error) {
        if (res.error === "no_key") this._noKey = true;      // plus d'auto-IA cette session
        hint?.remove();
        if (!keepLocal)
          list.innerHTML = `<div class="acc-empty">IA indisponible (${esc(res.error)}). Réessayez plus tard.</div>`;
        return;
      }
      const items = (res?.results || [])
        .map(r => ({ w: wines.find(w => w.id === r.id), reason: r.reason }))
        .filter(x => x.w);
      hint?.remove();
      if (keepLocal && !items.length) return;                // rien de mieux : on garde le local
      this._renderAccordsResults(list, items, { ai: true });
    } catch (e) {
      hint?.remove();
      if (!keepLocal) list.innerHTML = `<div class="acc-empty">Erreur IA. Réessayez plus tard.</div>`;
    }
  }

  _bindApogee(box) {
    const list = box.querySelector("#apo-list");
    const wines = this._apoFilteredWines();
    // v7.0.1 : filtres couleur / région → on reconstruit le panneau entier
    // (graphique, compteurs, top priorités) avec le filtre appliqué
    const rebind = () => {
      const panel = box.querySelector('[data-panel="apogee"]');
      if (!panel) return;
      panel.innerHTML = this._apogeeHTML();
      this._bindApogee(box);
    };
    box.querySelector("#apo-f-color")?.addEventListener("change", (e) => {
      this._apoColor = e.target.value || "";
      rebind();
    });
    box.querySelector("#apo-f-region")?.addEventListener("change", (e) => {
      this._apoRegion = e.target.value || "";
      rebind();
    });
    // Dépliant du profil de garde : état mémorisé pour survivre aux re-rendus
    const chart = box.querySelector("#apo-chart");
    chart?.addEventListener("toggle", () => {
      this._apoChartOpen = chart.open;
      try { localStorage.setItem("millesime-apo-chart", chart.open ? "1" : "0"); } catch (e) {}
    });
    // Tap sur un segment du graphique → fiche du vin
    box.querySelectorAll(".apo-seg[data-wine]").forEach((seg) =>
      seg.addEventListener("click", () => {
        const w = wines.find(x => x.id === seg.dataset.wine);
        if (w) this._openModal("detail", { wine: w });
      })
    );
    // Top 10 : tap → localisation dans la cave (comme les listes d'état)
    box.querySelectorAll(".apo-top-row[data-wine]").forEach((row) =>
      row.addEventListener("click", () => {
        const w = wines.find(x => x.id === row.dataset.wine);
        if (w) this._locateBottle(w);
      })
    );
    box.querySelectorAll(".apo-state").forEach((b) =>
      b.addEventListener("click", () => {
        box.querySelectorAll(".apo-state").forEach(x => x.classList.toggle("active", x === b));
        const k = b.dataset.apo;
        const items = wines.filter(w => this._apogeeState(w) === k)
          .sort((a, c) => (parseInt(a.drink_until) || 9999) - (parseInt(c.drink_until) || 9999));
        if (!list) return;
        list.innerHTML = items.length
          ? `<div class="vlist">${items.map(w => this._miniWineRow(w)).join("")}</div>`
          : `<div class="acc-empty">Aucune bouteille dans cet état.</div>`;
        list.querySelectorAll(".ap-wine[data-wine]").forEach((row) =>
          row.addEventListener("click", () => {
            const w = wines.find(x => x.id === row.dataset.wine);
            if (w) this._locateBottle(w);
          })
        );
      })
    );
  }

  // ── « Envie de… » (v7.0.1) ──────────────────────────────────────────────────
  // Parfois on veut simplement boire un bon vin, sans occasion ni plat : on
  // choisit le profil aromatique du moment (+ couleur éventuelle) et le
  // sommelier IA propose UNE bouteille de la cave — bon profil, bonne apogée —
  // avec son PRIX affiché pour aider à trancher. Repli local (scoring sur
  // aroma_profile) si l'IA est indisponible.
  // ── Structure (v7.1.0) ─────────────────────────────────────────────────────
  // Axes de dégustation stockés (0-100 indépendants) + chips grand public de
  // « Envie de… » mappées sur ces axes (+1 = recherché élevé, -1 = recherché bas)
  static STRUCTURE_AXES = ["Tanins", "Corps", "Acidité", "Gras", "Alcool", "Persistance"];
  static STRUCTURE_CHIPS = [
    { l: "Tannique",        axis: "Tanins",      dir: +1 },
    { l: "Souple",          axis: "Tanins",      dir: -1 },
    { l: "Corsé",           axis: "Corps",       dir: +1 },
    { l: "Léger",           axis: "Corps",       dir: -1 },
    { l: "Vif & frais",     axis: "Acidité",     dir: +1 },
    { l: "Rond & moelleux", axis: "Gras",        dir: +1 },
    { l: "Puissant",        axis: "Alcool",      dir: +1 },
    { l: "Long en bouche",  axis: "Persistance", dir: +1 },
  ];

  // Glossaires ℹ️ (v7.1.0) — définitions d'une ligne pour les non-initiés
  static GLOSSARY = {
    aroma: [
      ["Fruité", "fruits frais, mûrs ou confits : agrumes, fruits rouges, noirs, exotiques"],
      ["Floral", "rose, violette, acacia, tilleul"],
      ["Végétal", "herbe coupée, buis, poivron, menthe"],
      ["Minéral", "pierre à fusil, craie, silex, iode"],
      ["Épicé", "poivre, réglisse, cannelle, girofle"],
      ["Boisé", "vanille, cèdre, notes de fût"],
      ["Empyreumatique", "fumé, grillé, torréfié, café, cacao"],
      ["Animal", "cuir, gibier, musc"],
      ["Fermentaire", "beurre, brioche, levure — issus de la fermentation"],
      ["Sous-bois", "champignon, humus, truffe, feuille morte"],
      ["Évolution", "fruits secs, miel, cire : la maturité du vin"],
    ],
    structure: [
      ["Tanins", "astringence qui assèche le palais"],
      ["Corps", "densité et volume en bouche"],
      ["Acidité", "fraîcheur, vivacité qui fait saliver"],
      ["Gras", "onctuosité, texture enveloppante"],
      ["Alcool", "chaleur perçue en fin de bouche"],
      ["Persistance", "durée des arômes après la gorgée, en caudalies"],
    ],
    envieStructure: [
      ["Tannique", "du grip, des tanins présents"],
      ["Souple", "tanins fondus, tout en douceur"],
      ["Corsé", "riche et dense"],
      ["Léger", "facile, digeste"],
      ["Vif & frais", "la tension qui désaltère"],
      ["Rond & moelleux", "caressant, enrobé"],
      ["Puissant", "intense et chaleureux"],
      ["Long en bouche", "des arômes qui durent"],
    ],
  };

  // Bouton ℹ️ + panneau glossaire dépliable (un tap ouvre, un tap referme)
  _glossHTML(key, id) {
    const rows = (this.constructor.GLOSSARY[key] || [])
      .map(([t, d]) => `<p class="gl-row"><b>${esc(t)}</b> — ${esc(d)}</p>`).join("");
    return {
      btn: `<button type="button" class="gl-info" data-gl="${id}" aria-label="Définitions" title="Définitions">i</button>`,
      panel: `<div class="gl-panel" id="gl-${id}" hidden>${rows}</div>`,
    };
  }

  _bindGloss(box) {
    box.querySelectorAll(".gl-info").forEach((b) =>
      b.addEventListener("click", () => {
        const p = box.querySelector(`#gl-${b.dataset.gl}`);
        if (!p) return;
        p.hidden = !p.hidden;
        b.classList.toggle("on", !p.hidden);
      })
    );
  }

  _envieHTML() {
    const fams = this.constructor.AROMA_FAMILIES;
    // v7.1.0 : classe PROPRE .envie-chip (plus de .occ-btn partagé — c'était la
    // cause de la fermeture de la fenêtre à chaque sélection de critère)
    const chips = fams.map(f =>
      `<button type="button" class="envie-chip ${(this._envieWants || []).includes(f) ? "active" : ""}" data-fam="${esc(f)}">${esc(f)}</button>`
    ).join("");
    const sChips = this.constructor.STRUCTURE_CHIPS.map(c =>
      `<button type="button" class="envie-chip envie-chip--s ${(this._envieWantsS || []).includes(c.l) ? "active" : ""}" data-schip="${esc(c.l)}">${esc(c.l)}</button>`
    ).join("");
    const colorOpts = [`<option value="">🍷 Peu importe la couleur</option>`]
      .concat(Object.entries(WINE_TYPES).map(([v, t]) =>
        `<option value="${v}" ${this._envieColor === v ? "selected" : ""}>${t.emoji} ${t.label}</option>`))
      .join("");
    const gA = this._glossHTML("aroma", "envie-a");
    const gS = this._glossHTML("envieStructure", "envie-s");
    return `
      <div class="occ-hint">Envie d'un bon vin, tout simplement ? Choisissez le profil du moment :
        le sommelier propose <b>une seule bouteille</b> de votre cave, au bon profil et à la bonne apogée — avec son prix.</div>
      <div class="envie-grp">🌸 Arômes ${gA.btn}</div>
      ${gA.panel}
      <div class="envie-chips" id="envie-chips">${chips}</div>
      <div class="envie-grp">🍷 Structure ${gS.btn}</div>
      ${gS.panel}
      <div class="envie-chips" id="envie-chips-s">${sChips}</div>
      <select class="mm-input envie-color" id="envie-color">${colorOpts}</select>
      <button class="acc-go envie-go" id="envie-go">🍷 Envie de… trouver mon vin</button>
      <div class="acc-list" id="envie-result"></div>`;
  }

  // Repli local : score = intensités des familles aromatiques choisies
  // + adéquation de STRUCTURE (v7.1.0 : sur structure_profile si présent,
  // sinon heuristique par type/région), bonus apogée « à boire maintenant ».
  _parseStructureProfile(str_) {
    if (!str_ || typeof str_ !== "string") return null;
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const byNorm = Object.fromEntries(this.constructor.STRUCTURE_AXES.map(a => [norm(a), a]));
    const out = {};
    for (const part of str_.split(/[|,;]/)) {
      const m = part.match(/^\s*([^:%]+?)\s*[:\s]\s*(\d{1,3})\s*%?\s*$/);
      if (!m) continue;
      const ax = byNorm[norm(m[1])];
      if (ax) out[ax] = Math.max(0, Math.min(100, parseInt(m[2])));
    }
    return Object.keys(out).length >= 2 ? out : null;
  }

  _envieStructureScore(w, wantsS) {
    if (!wantsS.length) return 0;
    const chips = this.constructor.STRUCTURE_CHIPS.filter(c => wantsS.includes(c.l));
    const sp = this._parseStructureProfile(w.structure_profile);
    if (sp) {
      // Données réelles : dir +1 → l'axe compte positivement ; dir -1 → on
      // récompense un axe BAS (100 - valeur)
      return chips.reduce((a, c) => {
        const v = sp[c.axis];
        if (v == null) return a;
        return a + (c.dir > 0 ? v : 100 - v);
      }, 0);
    }
    // Heuristique de secours (fiches pas encore complétées) : type + région
    const reg = ((w.region || "") + " " + (w.appellation || "")).toLowerCase();
    let s = 0;
    for (const c of chips) {
      if (c.l === "Tannique")
        s += (w.type === "red" ? 40 : 0) + (/madiran|cahors|bordeaux|medoc|saint-est|sud-ouest/.test(reg) ? 30 : 0);
      if (c.l === "Souple")   s += (w.type === "red" && /bourgogne|beaujolais|loire/.test(reg) ? 50 : 20);
      if (c.l === "Corsé")    s += (/chateauneuf|gigondas|madiran|cahors|priorat/.test(reg) ? 60 : (w.type === "red" ? 25 : 5));
      if (c.l === "Léger")    s += (w.type === "rose" || /beaujolais|gamay|loire/.test(reg) ? 55 : 15);
      if (c.l === "Vif & frais") s += (w.type === "white" || w.type === "sparkling" ? 50 : 10);
      if (c.l === "Rond & moelleux") s += (w.type === "dessert" ? 60 : /meursault|chardonnay/.test(reg) ? 45 : 15);
      if (c.l === "Puissant") s += (/chateauneuf|amarone|barolo|madiran/.test(reg) ? 60 : (w.type === "red" ? 25 : 5));
      if (c.l === "Long en bouche") s += 20;   // neutre sans donnée
    }
    return s;
  }

  _envieLocalPick(wants, wantsS, color) {
    const wines = (this._data?.wines || [])
      .filter(w => (w.slots || []).length)
      .filter(w => !color || (w.type || "red") === color);
    let best = null, bestScore = -1;
    for (const w of wines) {
      const prof = this._parseAromaProfile(w.aroma_profile);
      if (!prof && !wantsS.length) continue;
      let s = prof ? wants.reduce((a, f) => a + (prof[f] || 0), 0) : 0;
      s += this._envieStructureScore(w, wantsS);
      const st = this._apogeeState(w);
      if (st === "now") s += 60;
      else if (st === "soon") s += 15;
      else if (st === "past") s -= 40;
      else if (st === "keep") s -= 60;
      if (s > bestScore) { bestScore = s; best = w; }
    }
    return best;
  }

  _envieResultHTML(w, extra = {}) {
    const t = WINE_TYPES[w.type] || WINE_TYPES.red;
    const apo = (w.drink_from || w.drink_until)
      ? `${esc(w.drink_from || "?")} – ${esc(w.drink_until || "?")}` : "apogée non renseignée";
    return `
      <div class="envie-card">
        <div class="envie-card-head">
          <span class="rk-dot" style="background:${t.color}"></span>
          <b>${esc(w.name || "Sans nom")}</b>${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}
          <span class="envie-price">${w.price ? Math.round(w.price) + " €" : "prix non renseigné"}</span>
        </div>
        <div class="envie-card-meta">${[w.appellation, w.region].filter(Boolean).map(esc).join(" · ")} · 🕐 ${apo}</div>
        ${extra.match  ? `<div class="envie-card-line">🌸 ${esc(extra.match)}</div>`  : ""}
        ${extra.apogee ? `<div class="envie-card-line">🕐 ${esc(extra.apogee)}</div>` : ""}
        ${extra.serve  ? `<div class="envie-card-line">🍾 ${esc(extra.serve)}</div>`  : ""}
        <button class="mm-btn mm-btn-ghost envie-locate" data-wine="${esc(w.id)}">📍 Voir dans la cave</button>
      </div>`;
  }

  _bindEnvie(box) {
    const result = box.querySelector("#envie-result");
    this._bindGloss(box.querySelector('[data-panel="envie"]') || box);
    // Rangée ARÔMES (multi-sélection)
    box.querySelectorAll("#envie-chips .envie-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        const f = chip.dataset.fam;
        this._envieWants = this._envieWants || [];
        if (this._envieWants.includes(f)) this._envieWants = this._envieWants.filter(x => x !== f);
        else this._envieWants.push(f);
        chip.classList.toggle("active", this._envieWants.includes(f));
      })
    );
    // Rangée STRUCTURE (v7.1.0, multi-sélection)
    box.querySelectorAll("#envie-chips-s .envie-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        const c = chip.dataset.schip;
        this._envieWantsS = this._envieWantsS || [];
        if (this._envieWantsS.includes(c)) this._envieWantsS = this._envieWantsS.filter(x => x !== c);
        else this._envieWantsS.push(c);
        chip.classList.toggle("active", this._envieWantsS.includes(c));
      })
    );
    box.querySelector("#envie-color")?.addEventListener("change", (e) => {
      this._envieColor = e.target.value || "";
    });
    const showResult = (w, extra = {}) => {
      if (!result) return;
      result.innerHTML = this._envieResultHTML(w, extra);
      result.querySelector(".envie-locate")?.addEventListener("click", () => {
        const wine = (this._data?.wines || []).find(x => x.id === w.id);
        if (wine) this._locateBottle(wine);
      });
    };
    box.querySelector("#envie-go")?.addEventListener("click", async () => {
      const wants = this._envieWants || [];
      const wantsS = this._envieWantsS || [];
      if (!wants.length && !wantsS.length) {
        if (result) result.innerHTML = `<div class="acc-empty">Choisissez au moins un critère (arôme ou structure) ci-dessus.</div>`;
        return;
      }
      const wines = this._data?.wines || [];
      if (!wines.length) {
        if (result) result.innerHTML = `<div class="acc-empty">Cette cave est vide : ajoutez des bouteilles d'abord.</div>`;
        return;
      }
      const est = this._estimateTokens(JSON.stringify(
        wines.map(w => (w.name || "") + (w.aroma_profile || "") + (w.structure_profile || "")))) + 250;
      const prog = this._aiProgressOpen("Sommelier — envie du moment", est);
      if (result) result.innerHTML = "";
      try {
        prog.step(1);
        const req = this._hass.connection.sendMessagePromise({
          type: "millesime/craving",
          wants, wants_structure: wantsS,
          color: this._envieColor || null, cellar_id: this._cellarId || null,
        });
        prog.step(2);
        const res = await req;
        if (res?.error) {
          // IA indisponible → repli local silencieux (arômes + structure)
          const local = this._envieLocalPick(wants, wantsS, this._envieColor || "");
          if (local) {
            prog.close();
            showResult(local, { match: "Sélection locale (IA indisponible) : meilleur profil correspondant dans votre cave." });
          } else {
            prog.fail(res.error === "no_key"
              ? "Clé Gemini absente : configurez-la dans l'intégration"
              : `IA indisponible (${res.error})`);
            if (result) result.innerHTML = `<div class="acc-empty">Aucun profil aromatique renseigné — lancez « Compléter les fiches » (⚙️ Options).</div>`;
          }
          return;
        }
        prog.step(3);
        const r = res.result || {};
        const w = wines.find(x => x.id === r.id);
        if (!w) {
          prog.fail("Aucune bouteille de la cave ne correspond");
          if (result) result.innerHTML = `<div class="acc-empty">Le sommelier n'a rien trouvé d'adapté à cette envie.</div>`;
          return;
        }
        prog.done(res.usage);
        showResult(w, { match: r.match, apogee: r.apogee, serve: r.serve });
      } catch (e) {
        // Erreur réseau → même repli local
        const local = this._envieLocalPick(wants, wantsS, this._envieColor || "");
        if (local) { prog.close(); showResult(local, { match: "Sélection locale (hors ligne) : meilleur profil correspondant." }); }
        else prog.fail("Erreur réseau : réessayez");
      }
    });
  }

  _bindAccords(box) {
    const selFam  = box.querySelector("#acc-fam");
    const selCat  = box.querySelector("#acc-cat");
    const selDish = box.querySelector("#acc-dish");
    const search  = box.querySelector("#acc-search");
    const goBtn   = box.querySelector("#acc-go");
    const list    = box.querySelector("#acc-list");

    const fill = (sel, items, placeholder) => {
      sel.innerHTML = `<option value="">${placeholder}</option>` +
        items.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join("");
    };

    // Affiche un résultat local puis, selon le réglage ⚙️ « IA automatique »,
    // lance l'affinage Gemini SANS bouton (v7.0.0). Si l'IA est désactivée ou
    // sans clé, le bouton ✨ manuel reste disponible comme avant.
    const runDish = (dish, label, { fromText = false } = {}) => {
      if (!list) return;
      // Plat inconnu de la table locale → on passe directement à l'IA
      if (fromText && dish.unknown) { this._aiPairing(label, list); return; }
      const { items, approx } = this._localMatch(dish);
      this._renderAccordsResults(list, items, { approx });
      if (this._autoAI && !this._noKey) {
        this._aiPairing(label, list, { keepLocal: true });
      } else {
        const ai = document.createElement("button");
        ai.className = "acc-ai-btn";
        ai.textContent = approx ? "✨ Demander à l'IA (plus précis)" : "✨ Affiner avec l'IA";
        ai.addEventListener("click", () => this._aiPairing(label, list));
        list.appendChild(ai);
      }
    };

    // ── Recherche libre ──
    const doSearch = () => {
      const txt = (search?.value || "").trim();
      if (!txt) return;
      const dish = this._dishFromText(txt);
      runDish(dish, txt, { fromText: true });
    };
    goBtn?.addEventListener("click", doSearch);
    search?.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

    // ── Sélecteur de mode (Un plat / Menu complet) ──
    box.querySelectorAll("#acc-mode .seg3-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._accMode = btn.dataset.mode;
        box.querySelectorAll("#acc-mode .seg3-btn").forEach(b => b.classList.toggle("active", b === btn));
        const pd = box.querySelector("#acc-pane-dish"), pm = box.querySelector("#acc-pane-menu");
        if (pd) pd.style.display = this._accMode === "dish" ? "block" : "none";
        if (pm) pm.style.display = this._accMode === "menu" ? "block" : "none";
      })
    );

    // ── Menu complet : l'IA choisit 1-2 bouteilles de la cave active ──
    box.querySelector("#menu-go")?.addEventListener("click", async () => {
      const val = (id) => (box.querySelector("#" + id)?.value || "").trim();
      const menu = { starter: val("menu-starter"), main: val("menu-main"), dessert: val("menu-dessert") };
      const result = box.querySelector("#acc-menu-result");
      if (!menu.starter && !menu.main && !menu.dessert) {
        if (result) result.innerHTML = `<div class="acc-empty">Renseignez au moins un service du repas.</div>`;
        return;
      }
      const wines = this._data?.wines || [];
      if (!wines.length) {
        if (result) result.innerHTML = `<div class="acc-empty">Cette cave est vide : ajoutez des bouteilles avant de demander un accord.</div>`;
        return;
      }
      const est = this._estimateTokens(JSON.stringify(
        wines.map(w => (w.name || "") + (w.appellation || "") + (w.aroma_profile || "")))) + 350;
      const prog = this._aiProgressOpen("Sommelier — accord sur le repas", est);
      if (result) result.innerHTML = "";
      try {
        prog.step(1);
        const req = this._hass.connection.sendMessagePromise({
          type: "millesime/pair_menu", ...menu, cellar_id: this._cellarId || null });
        prog.step(2);
        const res = await req;
        if (res?.error) {
          prog.fail(res.error === "no_key"
            ? "Clé Gemini absente : configurez-la dans l'intégration"
            : `IA indisponible (${res.error})`);
          return;
        }
        prog.step(3);
        const r = res.result || {};
        const choices = (r.choices || [])
          .map(c => ({ w: wines.find(w => w.id === c.id), covers: c.covers, reason: c.reason }))
          .filter(x => x.w);
        if (!choices.length) {
          prog.fail("Aucune bouteille de la cave ne convient");
          if (result) result.innerHTML = `<div class="acc-empty">Le sommelier n'a rien trouvé d'adapté dans cette cave.</div>`;
          return;
        }
        prog.done(res.usage);
        if (result) {
          result.innerHTML = choices.map(({ w, covers, reason }) => {
            const t = WINE_TYPES[w.type] || WINE_TYPES.red;
            return `
              <div class="menu-choice">
                <div class="menu-choice-head">
                  <span class="rk-dot" style="background:${t.color}"></span>
                  <b>${esc(w.name || "Sans nom")}</b>${w.vintage ? ` <i>${esc(w.vintage)}</i>` : ""}
                  ${covers ? `<span class="menu-covers">${esc(covers)}</span>` : ""}
                </div>
                ${reason ? `<div class="menu-choice-reason">${esc(reason)}</div>` : ""}
                <button class="mm-btn mm-btn-ghost menu-locate" data-wine="${esc(w.id)}">📍 Voir dans la cave</button>
              </div>`;
          }).join("") +
          (r.service ? `<div class="menu-service">🍾 ${esc(r.service)}</div>` : "") +
          (r.note ? `<div class="menu-note">ℹ️ ${esc(r.note)}</div>` : "");
          result.querySelectorAll(".menu-locate").forEach((b) =>
            b.addEventListener("click", () => {
              const w = wines.find(x => x.id === b.dataset.wine);
              if (w) this._locateBottle(w);      // ferme la fenêtre + surbrillance 2D/3D
            })
          );
        }
      } catch (e) {
        prog.fail("Erreur réseau : réessayez");
      }
    });

    // ── Déroulants ──
    selFam?.addEventListener("change", () => {
      const fam = selFam.value;
      if (fam && FOOD_LIBRARY[fam]) { fill(selCat, Object.keys(FOOD_LIBRARY[fam]), "— Catégorie —"); selCat.disabled = false; }
      else { selCat.innerHTML = `<option value="">— Catégorie —</option>`; selCat.disabled = true; }
      selDish.innerHTML = `<option value="">— Plat —</option>`; selDish.disabled = true;
      if (list) list.innerHTML = "";
    });
    selCat?.addEventListener("change", () => {
      const fam = selFam.value, cat = selCat.value;
      if (fam && cat && FOOD_LIBRARY[fam]?.[cat]) { fill(selDish, Object.keys(FOOD_LIBRARY[fam][cat]), "— Plat —"); selDish.disabled = false; }
      else { selDish.innerHTML = `<option value="">— Plat —</option>`; selDish.disabled = true; }
      if (list) list.innerHTML = "";
    });
    selDish?.addEventListener("change", () => {
      const fam = selFam.value, cat = selCat.value, dishName = selDish.value;
      const dish = FOOD_LIBRARY[fam]?.[cat]?.[dishName];
      if (!dish) { if (list) list.innerHTML = ""; return; }
      if (search) search.value = "";   // les deux modes ne se mélangent pas
      runDish(dish, dishName);
    });
  }

  _bindOpenPage(box) {
    box.querySelectorAll(".sub-tab").forEach((t) =>
      t.addEventListener("click", () => {
        this._filterTab = t.dataset.tab;
        box.querySelectorAll(".sub-tab").forEach(x => x.classList.toggle("active", x === t));
        box.querySelectorAll(".sub-panel").forEach(p =>
          p.classList.toggle("active", p.dataset.panel === this._filterTab));
      })
    );
    this._bindApogee(box);
    this._bindAccords(box);
    this._bindEnvie(box);
    // Occasion : sélection unique → ferme la page + surbrillance dans la cave.
    // v7.1.0 : bind SCOPÉ au panneau Occasions — avant, il capturait aussi les
    // chips « Envie de… » (même classe) et fermait la fenêtre à chaque critère.
    box.querySelectorAll('[data-panel="occasions"] .occ-btn').forEach((b) =>
      b.addEventListener("click", () => {
        this._occasionFilter = b.dataset.occ || "";
        this._closeModal();
        this._render();
        if (this._occasionFilter) {
          const lbl = (EVENT_TYPES.find(e => e.v === this._occasionFilter) || {}).l || "";
          this._showToast("info", `Surbrillance : ${lbl}`);
        }
      })
    );
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
    const lm = this._config?.bottle_label || "none";
    // font-size:0.85em × line-height:1.3 = 14.3px + padding-top:1px → 16px par label
    const lblCount = (lm === "name_vintage" || lm === "vintage_name") ? 2 : lm === "none" ? 0 : 1;
    const labelExtraH = lblCount * Math.ceil((this._fsBase || 13) * 0.85 * 1.3 + 1);
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
      const filteredOcc   = this._occasionFilter && wine && (wine.event || "") !== this._occasionFilter;
      // Vin sélectionné dans la liste : grise toutes les AUTRES bouteilles (comme les occasions)
      const filteredSel   = this._selected && wine && wine.id !== this._selected;
      const filtered = filteredType || filteredEvent || filteredOcc || filteredSel;
      const wt  = wine ? WINE_TYPES[wine.type] || WINE_TYPES.red : null;
      const sel = wine && wine.id === this._selected;
      const shelf2d = Math.floor(i / cols);
      const col2d = i % cols;
      const orient2d = rack.orientation === "neck" ? 0 : 1;   // même logique qu'en 3D (piqûre devant = retourné)
      const isAltL = isAlt || isAlt2 || isQc;
      const baseAlt = (isAlt && i % 2 === 1) || ((isAlt2 || isQc) && (shelf2d + col2d) % 2 === 1) ? 1 : 0;
      const alt = (isAltL ? (baseAlt ^ orient2d) : orient2d) === 1;
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

      // Taille FLUIDE : plus aucune dimension en pixels fixes ici. La largeur des
      // bouteilles/pastilles est plafonnée en CSS (clamp + cqi → progressif avec la
      // largeur de carte) et, sous ce plafond, suit la largeur de colonne (1fr) →
      // aucun débordement, quel que soit le nombre de colonnes. (Le `.dot` garde
      // width:100% : la cible tactile reste toute la cellule.)
      const bottleContent = wine
        ? (isCircle
            ? `<svg class="dot-svg-c" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block"><circle cx="5" cy="5" r="5" fill="${wt.color}"/><circle cx="5" cy="5" r="5" fill="white" opacity="0.12"/><ellipse cx="3.5" cy="3.5" rx="1.5" ry="1" fill="white" opacity="0.2"/></svg>`
            : BOTTLE_MINI(wt.color, null, wine.type, alt, entry.size || wine.size, shapeKindOf(wine)))
        : (isCircle
            ? `<svg class="dot-svg-c" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block"><circle cx="5" cy="5" r="4.5" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" stroke-dasharray="1.8 1.2"/></svg>`
            : BOTTLE_GHOST());

      const dotEl = `<div
        class="dot ${wine ? "dot--filled" : "dot--empty"} ${sel ? "dot--selected" : ""} ${!isCircle && alt ? "dot--alt" : ""} ${isCircle && alt ? "dot--c-alt" : ""}"
        data-slot="${i}" data-rack-id="${rack.id}" data-wine-id="${wine?.id || ""}" data-slot-idx="${slotIdx}"
        style="${dotStyle}"
        title="${wine
          ? esc(wine.name) + (wine.vintage ? " " + esc(wine.vintage) : "") + " — " + esc(this._slotLabel({ rack_id: rack.id, slot: i }))
          : esc(this._slotLabel({ rack_id: rack.id, slot: i })) + " — cliquer pour ajouter"}"
      >${bottleContent}</div>`;

      const labelsHtml = labelEls ? `<div class="dot-labels" style="height:${labelExtraH}px">${labelEls}</div>` : "";
      // La hauteur de cellule n'est plus imposée : elle découle de la hauteur réelle
      // (fluide) de la bouteille + des libellés. `grid-auto-rows:auto` s'en charge.
      return `<div class="dot-cell${lm !== "none" ? " dot-cell--labeled" : ""}"${extraStyle ? ` style="${extraStyle}"` : ""}>${dotEl}${labelsHtml}</div>`;
    };

    let dots = "";
    let dotsStyle = `grid-template-columns:repeat(${cols},1fr);grid-auto-rows:auto`;

    if (isQc) {
      // Grille double-colonne : chaque bouteille occupe 2 colonnes
      // Les étagères impaires sont décalées d'une colonne → quinconce parfait
      dotsStyle = `grid-template-columns:repeat(${cols * 2 + 1},1fr);grid-auto-rows:auto;padding-top:4px`;
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
  // v7.0.0 : appel du service atomique swap_slots (porté de la PR #6, crédit
  // Pulpyyyy). Fini le swap en 3 étapes via slot temporaire : l'échange se fait
  // en une seule écriture backend → fonctionne même cave PLEINE, plus besoin du
  // verrou _squelchUpdates ni d'états intermédiaires à l'écran.
  // Nom historique conservé : appelé par le drag & drop souris 2D/3D et tactile.

  async _swapViaTemp(src, tgt) {
    try {
      await this._hass.callService(DOMAIN, "swap_slots", {
        wine_id_a: src.wineId, slot_idx_a: src.slotIdx,
        wine_id_b: tgt.wineId, slot_idx_b: tgt.slotIdx,
      });
    } catch (err) {
      this._showToast("error", `Erreur permutation : ${err.message || JSON.stringify(err)}`);
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
    // Profils partagés avec la 2D (BOTTLE_PROFILES) — source unique en unités
    // RÉELLES (v7.1.0) : chaque forme a son rayon et sa longueur propres
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
    // Le rendu a pu changer pendant le chargement (ou un montage plus récent a pris la main),
    // ou la carte a pu être détachée (changement de vue Lovelace) pendant le chargement
    if (mountTok !== this._mountTok || !this.isConnected) return;
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
    // v7.1.0 : mkSet piloté par BOTTLE_METAS — demi-longueur, rayon de pose et
    // hauteur PROPRES à chaque forme (fini le 1.86/3.72 universel). Toutes les
    // cotes d'accessoires ci-dessous sont issues des tables MILLIMÉTRIQUES
    // réelles (converties via K_MM) : capsule sur la bague, bouchon dans le
    // goulot, collerette sur le col, étiquette sur le fût droit.
    const mkSet = (kind, o) => {
      const meta = BOTTLE_METAS[kind] || BOTTLE_METAS.bordeaux;
      const xf = (g) => { g.rotateX(Math.PI / 2); g.translate(0, meta.r, -meta.half); return g; };
      const set = {
        rest:   meta.r,               // hauteur de pose = rayon réel de la forme
        half:   meta.half,            // demi-longueur réelle (positionnement, tilt, drag)
        hUnits: meta.h,
        // Extrémité avant (pointe du bouchon, plaque comprise sur l'effervescent)
        tip:    o.corkY + o.corkH / 2 - meta.half + (o.muselet ? 0.09 : 0),
        body:   xf(new THREE.LatheGeometry(this._bottleProfile(THREE, kind), 48)),
        cap:    o.capPts
          ? xf(new THREE.LatheGeometry(o.capPts.map(([r, y]) => new THREE.Vector2(r, y)), 24))
          : xf(new THREE.CylinderGeometry(o.capR, o.capR2 || o.capR, o.capH, 24).translate(0, o.capY, 0)),
        cork:   xf(new THREE.CylinderGeometry(o.corkR, o.corkR2 || o.corkR, o.corkH, 18).translate(0, o.corkY, 0)),
        corkTop: o.muselet
          ? xf(new THREE.SphereGeometry(o.corkR, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)
              .scale(1, 0.26, 1).translate(0, o.corkY + o.corkH / 2, 0))
          : null,
        collar: xf(new THREE.CylinderGeometry(o.colR, o.colR2 || o.colR, o.colH, 24, 1, true).translate(0, o.colY, 0)),
        label:  xf(new THREE.CylinderGeometry(meta.r + 0.01, meta.r + 0.01, o.labelH, 32, 1, true, Math.PI - 1.05, 2.1).translate(0, o.labelY, 0)),
      };
      if (o.muselet) {
        // Muselet recalé sur les cotes réelles : ceinture sur la bague, brins
        // jusqu'au bord de la plaque, plaque bombée + sertissage sur la tête
        const beltY = o.musBeltY, headY = o.corkY + o.corkH / 2;
        const ring = new THREE.TorusGeometry(o.musBeltR, 0.012, 8, 28);
        ring.rotateX(Math.PI / 2);
        ring.translate(0, beltY, 0);
        const wires = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => {
          const wg = new THREE.CylinderGeometry(0.012, 0.012, headY + 0.05 - beltY, 6);
          wg.translate(0, (headY + 0.05 - beltY) / 2, 0);
          wg.rotateZ(0.15);
          wg.translate(o.musBeltR, beltY, 0);
          wg.rotateY(a);
          return wg;
        });
        const rim = new THREE.TorusGeometry(0.155, 0.012, 8, 28);
        rim.rotateX(Math.PI / 2);
        rim.translate(0, headY + 0.052, 0);
        const clips = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => {
          const cg = new THREE.BoxGeometry(0.075, 0.02, 0.028);
          cg.translate(0.150, headY + 0.064, 0);
          cg.rotateY(a);
          return cg;
        });
        set.muselet = [ring, rim, ...wires, ...clips].map(xf);
        set.plaque  = xf(new THREE.SphereGeometry(0.155, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2)
          .scale(1, 0.22, 1).translate(0, headY + 0.050, 0));
        set.plaqueDecal = xf(new THREE.CircleGeometry(0.118, 24).rotateX(-Math.PI / 2).translate(0, headY + 0.088, 0));
      }
      return set;
    };
    // Cotes d'accessoires par forme — millimètres réels convertis (K_MM) :
    // capsule couvrant la bague, bouchon affleurant, collerette décorative,
    // étiquette centrée sur le fût cylindrique de CHAQUE silhouette.
    const setBordeaux  = mkSet("bordeaux",  { capR: 0.167, capR2: 0.165, capH: 0.542, capY: 3.119, corkR: 0.136, corkH: 0.136, corkY: 3.333, colR: 0.181,   colH: 0.203, colY: 2.768, labelH: 1.073, labelY: 1.158 });
    const setLoire     = mkSet("loire",     { capR: 0.185, capR2: 0.168, capH: 0.328, capY: 3.35, corkR: 0.132, corkH: 0.136, corkY: 3.424, colR: 0.175, colH: 0.203, colY: 3.062, labelH: 1.073, labelY: 1.102 });
    const setFlute     = mkSet("flute",     { capR: 0.176, capR2: 0.16, capH: 0.328, capY: 3.915, corkR: 0.13, corkH: 0.136, corkY: 3.989, colR: 0.168, colH: 0.203, colY: 3.627, labelH: 0.96, labelY: 0.989 });
    const setRose      = mkSet("rose",      { capR: 0.18, capR2: 0.163, capH: 0.35, capY: 3.226, corkR: 0.13, corkH: 0.136, corkY: 3.311, colR: 0.169,   colH: 0.203, colY: 2.881, labelH: 1.017, labelY: 1.051 });
    const setBourgogne = mkSet("bourgogne", { capR: 0.188, capR2: 0.171, capH: 0.339, capY: 3.175,   corkR: 0.134, corkH: 0.136, corkY: 3.266, colR: 0.177, colH: 0.203, colY: 2.859, labelH: 1.073, labelY: 1.045 });
    const setChampagne = mkSet("champagne", {
      capPts: [[0.209, 3.028], [0.194, 3.232], [0.19, 3.39], [0.192, 3.435], [0.206, 3.48], [0.22, 3.526], [0.232, 3.565], [0.226, 3.588], [0.136, 3.593]],
      corkR: 0.22, corkR2: 0.153, corkH: 0.203, corkY: 3.706,
      colR: 0.201, colR2: 0.26, colH: 0.565, colY: 2.746,
      labelH: 0.96, labelY: 0.989,
      muselet: true, musBeltY: 3.526, musBeltR: 0.24400000000000002 });
    // v7.0.2 : sélection UNIFIÉE par silhouette (shapeKindOf : fiche → région →
    // type) — geoByKind indexe par forme, geoByType reste le repli par type.
    const geoByKind = {
      bordeaux: setBordeaux, bourgogne: setBourgogne, flute: setFlute,
      rose: setRose, champagne: setChampagne, loire: setLoire,
    };
    const geoByType = {
      red:       setBordeaux,   // bordelaise (v7.0.2 : défaut — épaule haute typique)
      white:     setBordeaux,   // bordelaise (Alsace/Bourgogne déduits de la région)
      rose:      setRose,       // bordelaise au col allongé (type Provence/Loire)
      sparkling: setChampagne,
      dessert:   setBordeaux,   // bordelaise aussi (Sauternes/Monbazillac)
    };

    // Emplacement vide : projection à plat d'une bordelaise (couchée comme les
    // bouteilles, orientée selon la parité du slot) — un peu plus étroite que les
    // vraies bouteilles pour bien se distinguer
    // v7.1.0 : le fantôme reste une bordelaise — demi-longueur RÉELLE
    const GHOST_HALF = BOTTLE_METAS.bordeaux.half;
    const GHOST_DZ_PUNT = 2.0 - GHOST_HALF;          // piqûre devant : cul au bord
    const GHOST_DZ_NECK = 2.0 - (GHOST_HALF + 0.11); // goulot devant : verre au bord
    const ghostPts = _normProfile(BOTTLE_PROFILES.bordeaux).slice(1, -1)
      .map(([r, y]) => [r * 0.85, y]);
    const ghostShape = new THREE.Shape();
    ghostPts.forEach(([r, y], i) => {
      const yy = GHOST_HALF - y;                       // goulot → +Z après rotateX(-π/2)
      if (i === 0) ghostShape.moveTo(r, yy); else ghostShape.lineTo(r, yy);
    });
    [...ghostPts].reverse().forEach(([r, y]) => ghostShape.lineTo(-r, GHOST_HALF - y));
    const emptyGeo = new THREE.ShapeGeometry(ghostShape);
    emptyGeo.rotateX(-Math.PI / 2);
    // Contour de la silhouette (remplace l'anneau)
    const ghostEdge = new THREE.BufferGeometry().setFromPoints(
      ghostPts.map(([r, y]) => new THREE.Vector3(r, 0, -(GHOST_HALF - y)))
        .concat([...ghostPts].reverse().map(([r, y]) => new THREE.Vector3(-r, 0, -(GHOST_HALF - y))))
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
    // v7.0.1 : silhouettes des emplacements vides nettement plus discrètes —
    // les « ombres » sombres gênaient la lecture, surtout en superposition
    const emptyMat = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const ringMat  = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.42 });
    // v7.1.0 / v7.1.2 : en SUPERPOSITION, les fantômes des couches AU-DESSUS de
    // la rangée de base sont MASQUÉS (visible=false) au repos — l'opacité 0 ne
    // suffisait pas : le matériau écrivait quand même dans le depth buffer et
    // occultait le fond, laissant une trace sombre disgracieuse (bug v7.1.x).
    // Ils restent tappables (le raycaster interroge la liste des cibles, pas la
    // visibilité) et réapparaissent le temps d'un glisser/déposer.
    const emptyMatUp = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const ringMatUp  = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.42 });
    const _upperGhosts = [];   // meshes + rings des couches hautes (toggle groupé)
    let _ghostsShown = false;  // état courant (drag en cours ?) pour le picking
    const showUpperGhosts = (on) => {
      _ghostsShown = on;
      for (const o of _upperGhosts) o.visible = on;
    };
    const goldMat  = new THREE.MeshBasicMaterial({ color: 0xC9A84C });

    // ── Construction des casiers, étagère par étagère (fidèle à la grille 2D) ──
    // Un "rack" de données = un casier indépendant : largeur propre (colonnes ×
    // espacement constant), étagères internes identiques.
    // Les casiers peuvent donc avoir des dimensions et dispositions différentes.
    const SPACING  = 1.06;                     // espacement des bouteilles (constant partout)
    // v7.0.2 : espacement des clayettes réglable (⚙️ Options, vue 3D) — le
    // facteur module la distance ENTRE clayettes et entre casiers ; la hauteur
    // d'emboîtement des piles (LAYER_DY) reste physique, donc inchangée.
    const gapK = this._shelfGapPct() / 100;
    const SHELF_DY   = 2.0 * gapK;               // entre étagères d'un même casier
    const RACK_GAP = 1.1 * gapK;                 // espace entre casiers
    const pickables = [];
    const rackAnchors = [];                   // pour les overlays HTML
    let yCursor = 0;                           // haut du casier courant

    racks.forEach((rack, fi) => {
      const cols  = rack.columns || 8;
      const layout = rack.layout || "side_by_side";
      // Superposition : les bouteilles s'empilent en 2 à 4 couches par clayette.
      // La grille de slots reste linéaire : chaque « rangée virtuelle » est une
      // couche ; `levels` rangées consécutives partagent la même planche.
      const levels = layout === "stacked" ? Math.max(1, Math.min(4, rack.levels || 1)) : 1;
      // v7.0.1 : empilement en PYRAMIDE — les couches supérieures reposent dans
      // les creux de la couche du dessous (décalage d'un demi-entraxe, géré plus
      // bas) ; la hauteur de couche correspond à l'emboîtement réel :
      // dy = √((2r)² − (S/2)²) ≈ 0.66 pour r = 0.424 (bordelaise réelle, v7.1.0)
      // et S = 1.06 — les formes plus fines s'emboîtent un peu plus, marge OK.
      const LAYER_DY = 0.66;                                   // hauteur d'une couche emboîtée
      const shelfStep = SHELF_DY + (levels - 1) * LAYER_DY;    // pas entre clayettes
      const total = rack.slots || cols * (rack.shelves || 2) * levels;
      const shelves  = Math.ceil(total / cols);                // rangées virtuelles
      const physShelves = Math.max(1, Math.ceil(shelves / levels));
      const orient = rack.orientation === "neck" ? 0 : 1;     // punt(piqûre)=1→retourné→piqûre devant ; neck(goulot)=0→défaut→goulot devant
      const tilt   = layout === "semi_lying";
      const TILT_A = 0.56;                                      // ~32° (semi-couché)
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
        // Étagère physique + niveau dans la pile (niveau 0 = haut de pile)
        const psh = Math.floor(r / levels), lv = r % levels;
        const shelfY = yTop - psh * shelfStep - lv * LAYER_DY;
        const isBase = lv === levels - 1;   // couche posée sur la planche
        // v7.0.1 : pyramide — une couche sur deux (en partant de la base) est
        // décalée d'un demi-entraxe : les bouteilles reposent dans les creux
        const stackOff = (layout === "stacked" && ((levels - 1 - lv) % 2) === 1) ? SPACING / 2 : 0;

        // Étagère : planche en bois (dessus affleurant le repos des bouteilles),
        // ou tôle fine sombre pour les caves en fer forgé — une seule planche
        // par étagère physique (sous la couche de base de la pile)
        if (isBase) {
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
          const lblTxt = physShelves > 1 ? `${rackName} · ${psh + 1}` : rackName;
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
        }  // fin isBase (planche / lisse / plaque)

        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (i >= total) break;
          const entry = slotOf[`${rack.id}:${i}`];
          const x    = -halfW + SPACING / 2 + c * SPACING + stackOff;
          // Pas de décalage avant/arrière : bouteilles parallèles, entièrement sur la
          // clayette (3.3 à 4.1 de long selon la forme pour 4.0 de profondeur)
          const stag = 0;
          // Tête-bêche : parité de base + sens de départ (orient) ; côte à côte/semi : orient = sens commun
          const baseParity = layout === "alternating" ? i % 2
            : (layout === "alternating_2d" || layout === "quinconce") ? (r + c) % 2 : 0;
          const isAltLayout = layout === "alternating" || layout === "alternating_2d" || layout === "quinconce";
          const parity = isAltLayout ? (baseParity ^ orient) : orient;

          if (!entry) {
            // Même alignement au bord avant que les vraies bouteilles (la silhouette
            // n'a pas de bouchon : le verre est placé là où serait celui d'une bordelaise)
            const gdz = parity === 1 ? GHOST_DZ_PUNT : GHOST_DZ_NECK;
            // v7.1.0 : couche haute de superposition → matériaux invisibles au repos
            const upper = layout === "stacked" && !isBase;
            const disc = new THREE.Mesh(emptyGeo, upper ? emptyMatUp : emptyMat);
            disc.position.set(x, shelfY + 0.012, stag + gdz);
            const ring = new THREE.LineLoop(ghostEdge, upper ? ringMatUp : ringMat);
            ring.position.set(x, shelfY + 0.013, stag + gdz);
            if (parity === 1) disc.rotation.y = ring.rotation.y = Math.PI;
            disc.userData = { empty: true, slot: i, rackId: rack.id, base: { x, shelfY, fi, i, parity }, ring };
            // v7.1.2 : couche haute masquée au repos (visible=false → aucun rendu,
            // aucune écriture profondeur), révélée pendant le drag & drop
            if (upper) { disc.visible = false; ring.visible = false; disc._ghUp = true; ring._ghUp = true; _upperGhosts.push(disc, ring); }
            pickables.push(disc);
            scene.add(disc, ring);
            continue;
          }
          occ++;

          const wine = entry.wine;
          const tp = WINE_TYPES[wine.type] ? wine.type : "red";
          const filtered =
            (this._filter !== "all" && wine.type !== this._filter) ||
            (this._filterEvent !== "all" && (wine.event || "") !== this._filterEvent) ||
            (this._occasionFilter && (wine.event || "") !== this._occasionFilter) ||
            // Vin sélectionné dans la liste : on grise toutes les AUTRES bouteilles
            (this._selected && wine.id !== this._selected);

          // v7.0.2 : silhouette via shapeKindOf (fiche → région → type) — même
          // logique que la 2D, rendu identique dans toutes les vues
          const shapeKey = shapeKindOf(wine);
          const set = geoByKind[shapeKey] || geoByType[tp] || setBordeaux;
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
          cap.visible = cork.visible = lbl.visible = !filtered;
          // Collerette masquée en disposition semi-couchée (demande utilisateur)
          col.visible = !filtered && !tilt;
          // Ombre de contact : couche de base uniquement (superposition) et
          // hors mode PCF (qui projette déjà ses propres ombres)
          if (!filtered && isBase && !SHADOWS_3D_PCF) {
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
          // Roulis très léger (déterministe par slot) : juste assez pour un rendu
          // vivant, sans casser l'alignement ni l'entraxe régulier (PJ : répartition).
          const h1 = (((i + 1) * 2654435761 + fi * 97) >>> 0) % 1000 / 1000;
          const roll = (h1 - 0.5) * 0.18;   // ±5° (au lieu de ±26°) → bien aligné
          g.rotation.z = roll;
          // Échelle du format (magnum/demi) : radiale en x/y, longueur en z —
          // bornée par sizeScale pour ne jamais déranger l'entraxe
          const sc = sizeScale(entry.size || wine.size);   // format de LA bouteille
          // Plafond de longueur par forme : bouchon compris, la bouteille ne doit
          // jamais déborder de la planche (profondeur 4.0, marge 0.02)
          // v7.1.0 : la flûte (4.07 u) peut déborder légèrement de la clayette
          // (4.0 u) comme en vraie cave — le clamp ne bride plus que les
          // grands formats (magnum et au-delà)
          const scL = Math.min(sc.l, 4.40 / (set.tip + set.half));
          g.scale.set(sc.r, sc.r, scL);
          // Alignement au bord avant de la clayette (z = +2) : pointe du bouchon au
          // bord pour les bouteilles à l'endroit, culot au bord pour les tête-bêche.
          // Le pivot du roulis étant le point de contact (l'axe est à y = rest·sc.r),
          // on compense x et y pour que l'axe reste à l'aplomb exact de l'emplacement
          g.position.set(
            x + set.rest * sc.r * Math.sin(roll),
            shelfY + set.rest * sc.r * (1 - Math.cos(roll)),
            stag + (parity === 1 ? 2.0 - set.half * scL : 2.0 - set.tip * scL)
          );
          if (tilt) {
            // Semi-couché : bouteille couchée inclinée ~32°. L'extrémité choisie est
            // posée EN BAS À L'AVANT, l'autre relevée vers l'arrière.
            //  - "piqûre en bas" (parity 1) → piqûre/cul au sol devant, goulot en l'air
            //  - "goulot en bas" (parity 0) → goulot au sol devant, piqûre en l'air
            const TILT = 0.56;                              // ~32°
            const puntDown = (parity === 1);
            g.rotation.set(0, 0, 0);
            if (puntDown) g.rotation.y = Math.PI;           // amène la piqûre vers l'avant
            g.rotation.x = TILT;                            // bascule l'extrémité avant vers le bas
            const half = set.half * scL;
            // Distance du centre à l'extrémité BASSE selon l'orientation (la pointe
            // du bouchon est un peu plus longue que la piqûre) → levage exact pour
            // que cette extrémité repose sur la planche sans passer dessous.
            const downDist = (puntDown ? set.half : set.tip) * scL;
            g.position.set(
              x,
              shelfY + downDist * Math.sin(TILT) + 0.02,
              stag + (puntDown ? 2.0 - set.half * scL : 2.0 - set.tip * scL)
            );
          }
          g.userData = {
            wineId: wine.id, slotIdx: entry.slotIdx, slot: i, rackId: rack.id,
            // Pour la dépose optimiste exacte : coordonnées du slot + paramètres
            // de placement de CETTE bouteille (forme/format)
            base: { x, shelfY, fi, i, parity },
            rest: set.rest, tip: set.tip, half: set.half, scR: sc.r, scL,
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

      const yBot = yTop - (physShelves - 1) * shelfStep - (levels - 1) * LAYER_DY;

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
      const bubbleReserve = (this._labelMode === "bubble" || this._labelMode === "both") ? 1.25 : 0;
      const markReserve = Math.max(plateReserve, bubbleReserve);
      // Si le PROCHAIN casier est semi-couché, ses bouteilles montent ~2 unités
      // au-dessus de sa planche → on réserve de l'espace au-dessus de lui (sous CE
      // casier) pour qu'elles ne percutent pas la clayette/les repères du dessus.
      const nextRack = racks[fi + 1];
      const nextTilted = nextRack && (nextRack.layout || "side_by_side") === "semi_lying";
      const tiltReserve = nextTilted ? 1.60 : 0;   // v7.1.0 : marge élargie (flûte semi-couchée plus haute)
      yCursor = yBot - SHELF_DY - RACK_GAP - markReserve - tiltReserve;
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

    // v7.1.8 — HAUTEUR VISIBLE RÉELLE, calculée dans le repère de la CAMÉRA.
    // La caméra regarde la scène avec ~16° d'élévation : sous cette inclinaison,
    // une scène profonde occupe à l'écran PLUS de hauteur que sa hauteur monde
    // (s3.y). Le cadrage se basait pourtant sur s3.y, d'où un contenu tronqué —
    // le premier casier était rogné, et l'écart grandissait avec l'espacement
    // des clayettes (d'où le contournement « régler l'espacement à 60 % »
    // signalé par la communauté).
    // On projette donc les 8 coins de la boîte englobante dans le repère caméra
    // et on mesure l'amplitude verticale réelle. Sécurité anti-régression : on
    // ne fait qu'ÉLARGIR le cadrage — une scène déjà entièrement visible reste
    // affichée à l'identique.
    const camOffset = new THREE.Vector3(4.2, 8.0, 28);
    const _viewRot = new THREE.Matrix4().lookAt(
      camOffset, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0),
    );
    const _viewInv = new THREE.Matrix4().copy(_viewRot).invert();
    let _camMinY = Infinity, _camMaxY = -Infinity;
    for (const cx of [bbox.min.x, bbox.max.x]) {
      for (const cyy of [bbox.min.y, bbox.max.y]) {
        for (const cz of [bbox.min.z, bbox.max.z]) {
          const p = new THREE.Vector3(cx - c3.x, cyy - c3.y, cz - c3.z).applyMatrix4(_viewInv);
          if (p.y < _camMinY) _camMinY = p.y;
          if (p.y > _camMaxY) _camMaxY = p.y;
        }
      }
    }
    // Hauteur retenue : la plus grande entre la mesure monde (comportement
    // historique) et la mesure caméra (réalité de l'écran) → jamais plus petit
    const viewH = Math.max(s3.y, (_camMaxY - _camMinY) || s3.y);

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
      // v7.0.1 : TOUS les rails alignés sur le bord droit du casier le plus
      // large — avant, chaque rail suivait la largeur de SON casier, d'où des
      // menus en zigzag quand les casiers avaient des colonnes différentes.
      const maxHalfW = Math.max(0, ...rackAnchors.map(a => a.halfW));
      rackAnchors.forEach(({ rack, fi, yTop, yBot, halfW, occ, total }) => {
        const pct = Math.round((occ / total) * 100);

        if (this._labelMode === "bubble" || this._labelMode === "both") {
          // Bulle rattachée à SON casier : sous le bord avant de sa dernière étagère.
          // En mode "both", on la descend un peu plus pour passer sous la plaque.
          const bubbleY = yBot - (this._labelMode === "both" ? 0.50 : 0.32);
          const pb = toPx(0, bubbleY, 2.06);
          const badge = document.createElement("div");
          badge.className = "t3-badge";
          badge.style.left = pb.x + "px";
          badge.style.top  = pb.y + "px";
          badge.innerHTML = `<b>${fi + 1}</b> ${esc(rack.name)} <span>${pct}%</span>`;
          stage.appendChild(badge);
        }

        // Rail vertical : position horizontale COMMUNE (bord droit du plus
        // large), position verticale propre à chaque casier
        // v7.0.2 : rail ANCRÉ AU BORD DROIT de la carte (zone réservée RAIL_PX),
        // plus au bord du casier le plus large — les clayettes profitent de
        // toute la largeur. railMarginPx compense le centrage sur desktop large.
        const pr = toPx(maxHalfW, yTop + 0.7, 0);
        const rail = document.createElement("div");
        rail.className = "t3-rail";
        rail.style.top = Math.max(4, pr.y - 50) + "px";
        rail.style.right = (railMarginPx + 6) + "px";
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
    let railMarginPx = 0;                      // centrage desktop : décalage du rail (v7.0.2)
    // v7.0.2 : 48 → 40 px — réserve ajustée à la largeur réelle du rail,
    // la scène (donc les clayettes) récupère la différence
    const RAIL_PX = 40;                        // zone réservée au rail d'actions
    // Largeur de rendu PLAFONNÉE : au-delà, la scène ne s'étire plus (bouteilles
    // géantes sur desktop) — on garde l'échelle de ~MAX_W px et on CENTRE le casier
    // dans la largeur réelle. Sous MAX_W (mobile/colonne), marge = 0 → inchangé.
    const MAX_W = 780;
    // v7.1.11 — PLAFOND GPU. Une grande cave (13 casiers × 3 niveaux) demande un
    // canvas de plusieurs milliers de pixels ; multiplié par le pixelRatio du
    // mobile, le tampon de rendu dépassait la taille maximale de texture du GPU
    // (4096 px sur la quasi-totalité des appareils Android). Le navigateur
    // écrêtait alors silencieusement le tampon : les casiers du haut
    // disparaissaient, et l'image ne correspondant plus à la projection, les
    // taps et le glisser-déposer tombaient à côté. Sur PC, la limite plus élevée
    // masquait le problème — d'où un bug invisible côté développeur.
    const MAX_TEX = Math.max(2048, Math.min(
      glCtx?.getParameter?.(glCtx.MAX_TEXTURE_SIZE) || 4096, 8192));
    const SAFE_PX = Math.floor(MAX_TEX * 0.97);      // marge de sécurité
    const layout = (w) => {
      curW = w;
      const effW = Math.min(w, MAX_W);
      const usable = Math.max(120, effW - RAIL_PX);
      let pxPerUnit = usable / (s3.x * MARGIN_X);
      let h = Math.max(150, Math.round((viewH + PAD_TOP + PAD_BOT) * pxPerUnit));

      // 1) On réduit d'abord la finesse du rendu (jusqu'à 1) : la scène reste
      //    entière, seule la netteté baisse — invisible sur une cave normale.
      const wantDpr = Math.min(window.devicePixelRatio || 1, 2);
      let dpr = wantDpr;
      while (dpr > 1 && (h * dpr > SAFE_PX || w * dpr > SAFE_PX)) dpr -= 0.25;
      dpr = Math.max(1, Math.min(dpr, SAFE_PX / Math.max(h, w, 1)));
      // 2) Si la scène dépasse encore à finesse 1, on dézoome pour TOUT montrer
      //    plutôt que d'en tronquer une partie.
      if (h > SAFE_PX) {
        const k = SAFE_PX / h;
        pxPerUnit *= k;
        h = Math.max(150, Math.round(h * k));
      }
      renderer.setPixelRatio(dpr);
      const hW = (s3.x * MARGIN_X) / 2;
      const extra = RAIL_PX / pxPerUnit;       // unités monde à droite (hors clayettes)
      // Marge de centrage quand la carte dépasse MAX_W (sinon 0)
      const margin = Math.max(0, (w - effW) / (2 * pxPerUnit));
      railMarginPx = Math.round(margin * pxPerUnit);   // v7.0.2 : le rail suit le centrage
      const hH = h / (2 * pxPerUnit);
      const cy = c3.y - (PAD_BOT - PAD_TOP) / 2;
      cam.left = -(hW + margin); cam.right = hW + extra + margin; cam.top = hH; cam.bottom = -hH;
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
      // v7.1.9 : DEUX PASSES. Auparavant on révélait d'emblée les fantômes des
      // couches hautes (invisibles depuis la v7.1.2 mais devant rester
      // tappables) : un fantôme placé devant une bouteille était alors touché
      // en premier, ce qui volait le clic à la bouteille.
      // Passe 1 — ce qui est RÉELLEMENT visible a toujours la priorité.
      const hit = ray.intersectObjects(objs.filter(o => o.visible), false)[0];
      if (hit) return hit;
      // Passe 2 — rien de visible sous le curseur : on teste alors les
      // emplacements masqués, le temps de l'intersection seulement.
      const hidden = objs.filter(o => !o.visible);
      if (!hidden.length) return undefined;
      for (const o of hidden) o.visible = true;
      const hit2 = ray.intersectObjects(hidden, false)[0];
      for (const o of hidden) o.visible = o._ghUp ? _ghostsShown : false;
      return hit2;
    };

    // Clic simple : "click" est synthétisé par iOS après un vrai tap
    // et jamais après un scroll → fiable sur iPhone
    const onPick = (e) => {
      if (this._t3Suppress) return;            // un drag vient de se terminer
      const hit = pickAt(e, pickables);
      if (!hit) {
        // Toucher/clic dans le vide : referme l'aperçu épinglé éventuel
        if (this._bottlePanel) this._hideBottlePanel();
        return;
      }
      const u = hit.object.userData;
      if (u.empty) {
        this._openModal("bottle", { slot: { rack_id: u.rackId, slot: u.slot } });
        return;
      }
      const wine = wines.find((w) => w.id === u.wineId);
      if (!wine) return;
      if (this._lastPT === "touch") {
        // Tactile : 1er tap → aperçu épinglé (la fiche s'ouvre en touchant l'aperçu)
        this._showBottlePanel(wine, anchorFromEvent(e), true);
      } else {
        // Souris : ouverture directe de la fiche
        this._openModal("detail", { wine });
      }
    };
    renderer.domElement.addEventListener("click", onPick);

    // Drag & drop : déplacer vers un slot vide, permuter sur un slot occupé
    let drag = null;          // { ud, obj, group, orig, sx, sy, active }
    let hoverTarget = null;   // userData du slot survolé pendant le drag
    let hoverObj = null;      // objet 3D correspondant (pour le placement optimiste)

    const onDown = (e) => {
      if (!e.isPrimary) return;
      // v7.1.9 CORRECTIF : ne chercher QUE parmi les bouteilles.
      // pickAt révèle temporairement les emplacements vides des couches hautes
      // (pour qu'ils restent tappables malgré visible=false). En superposition,
      // un de ces fantômes pouvait se trouver DEVANT une bouteille : le rayon le
      // touchait en premier, il n'a pas de wineId, et la fonction sortait —
      // rendant tout déplacement impossible alors que le simple tap marchait.
      const hit = pickAt(e, pickables.filter(o => o.userData && o.userData.wineId));
      if (!hit) return;
      drag = {
        ud: hit.object.userData, obj: hit.object,
        group: hit.object.parent, orig: hit.object.parent.position.clone(),
        sx: e.clientX, sy: e.clientY, active: false,
      };
    };

    // ── Défilement automatique pendant le glisser (v7.1.11) ──────────────────
    // Sur une grande cave, la scène 3D mesure plusieurs milliers de pixels : on
    // ne voit que deux ou trois étages à la fois. Le glisser-déposer exigeant
    // que la source ET la destination soient visibles en même temps, déplacer
    // une bouteille vers un autre étage était tout simplement IMPOSSIBLE.
    // En approchant du haut ou du bas de l'écran, la page défile donc d'elle-même.
    const EDGE_PX = 90;          // zone sensible en bord d'écran
    const SPEED_MAX = 22;        // pixels par image, au contact du bord
    let _scrollRAF = null, _scrollV = 0, _lastPtrEvt = null;
    const scroller = () => {
      if (!drag || !drag.active || !_scrollV) { _scrollRAF = null; return; }
      const before = window.scrollY;
      window.scrollBy(0, _scrollV);
      // Le contenu suit le curseur pendant le défilement (sinon la bouteille
      // resterait figée à l'écran alors que la scène bouge sous elle)
      if (window.scrollY !== before && _lastPtrEvt) onMove(_lastPtrEvt);
      _scrollRAF = requestAnimationFrame(scroller);
    };
    const updateAutoScroll = (e) => {
      if (!drag || !drag.active) { _scrollV = 0; return; }
      const vh = window.innerHeight || 800;
      const top = e.clientY, bottom = vh - e.clientY;
      // Vitesse minimale de 1 px : sans elle, l'arrondi créait une bande morte à
      // l'entrée de la zone où le défilement ne démarrait pas.
      const spd = (d) => Math.max(1, Math.round(SPEED_MAX * (1 - d / EDGE_PX)));
      if (top < EDGE_PX)          _scrollV = -spd(top);
      else if (bottom < EDGE_PX)  _scrollV =  spd(bottom);
      else                        _scrollV = 0;
      if (_scrollV && !_scrollRAF) _scrollRAF = requestAnimationFrame(scroller);
    };

    const onMove = (e) => {
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 7) return;
        drag.active = true;
        showUpperGhosts(true);   // v7.1.0 : cibles des couches hautes visibles pendant le drag
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
      _lastPtrEvt = e;            // v7.1.11 : mémorisé pour le défilement auto
      updateAutoScroll(e);
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
        base.parity === 1 ? 2.0 - ud.half * ud.scL : 2.0 - ud.tip * ud.scL
      );
    };

    const endDrag = (commit) => {
      if (!drag) return;
      _scrollV = 0; _lastPtrEvt = null;        // v7.1.11 : stoppe le défilement auto
      if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
      showUpperGhosts(false);   // v7.1.0 : les cibles des couches hautes se rangent
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
        const gdz = srcBase.parity === 1 ? GHOST_DZ_PUNT : GHOST_DZ_NECK;
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

    // ── Panneau d'infos 3D : survol (souris) + appui long (iPhone) ──
    // On réutilise le raycaster : la bouteille survolée → panneau positionné près du curseur.
    const wineAt = (e) => {
      const hit = pickAt(e, pickables);
      const u = hit?.object?.userData;
      if (!u || u.empty || !u.wineId) return null;
      return wines.find((w) => w.id === u.wineId) || null;
    };
    // Ancre virtuelle = position du curseur (le panneau se place juste au-dessus)
    const anchorFromEvent = (e) => ({
      getBoundingClientRect: () => ({
        left: e.clientX, right: e.clientX, width: 0,
        top: e.clientY, bottom: e.clientY, height: 0,
      }),
    });
    // Survol SOURIS uniquement : aperçu qui suit le curseur (sans gêner le drag)
    let hoverWineId = null;
    renderer.domElement.addEventListener("mousemove", (e) => {
      if (this._lastPT === "touch") return;           // le tactile passe par onPick (aperçu épinglé)
      if (drag && drag.active) { this._hideBottlePanel(); hoverWineId = null; return; }
      const wine = wineAt(e);
      if (wine) {
        if (wine.id !== hoverWineId) { hoverWineId = wine.id; this._showBottlePanel(wine, anchorFromEvent(e)); }
        else if (this._bottlePanel) {  // suit le curseur
          const r = anchorFromEvent(e).getBoundingClientRect();
          const p = this._bottlePanel;
          let left = r.left - p.offsetWidth / 2;
          let top = r.top - p.offsetHeight - 12;
          left = Math.max(8, Math.min(left, window.innerWidth - p.offsetWidth - 8));
          if (top < 8) top = r.bottom + 12;
          p.style.left = left + "px"; p.style.top = top + "px";
        }
      } else { hoverWineId = null; this._hideBottlePanel(); }
    });
    renderer.domElement.addEventListener("mouseleave", () => {
      if (this._lastPT === "touch") return;
      hoverWineId = null; this._hideBottlePanel();
    });

    // ── Redimensionnement (largeur uniquement) ──
    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth || curW;
      if (Math.abs(w - curW) > 1) layout(w);
    });
    ro.observe(stage);

    // ── Mobile : perte de contexte WebGL & bascule d'orientation ──
    // (porté de la PR #6, crédit Pulpyyyy — unifié avec notre remontage
    //  idempotent : _mount3D() commence par _unmount3D() + token _mountTok,
    //  donc onCtxRestored ne peut pas provoquer de double montage)
    // 1) La WebView peut perdre le contexte WebGL (arrière-plan, mémoire,
    //    rotation). Sans preventDefault sur "webglcontextlost", le navigateur
    //    ne restaure JAMAIS le contexte : canvas vide définitivement. On accepte
    //    la restauration puis on remonte toute la scène (textures, géométries et
    //    framebuffers GPU sont invalidés par la perte).
    const canvas3d = renderer.domElement;
    const onCtxLost     = (e) => e.preventDefault();
    const onCtxRestored = () => {
      if (this._view === "3d") requestAnimationFrame(() => this._mount3D());
    };
    canvas3d.addEventListener("webglcontextlost", onCtxLost, false);
    canvas3d.addEventListener("webglcontextrestored", onCtxRestored, false);
    // 2) Certaines WebView vident le back-buffer SANS émettre "webglcontextlost" :
    //    au changement d'orientation, on remesure et on redessine une fois la
    //    nouvelle taille stabilisée (double rAF). Couvre aussi le cas où la
    //    largeur reste identique (le ResizeObserver ne se déclencherait pas).
    const onOrient = () => requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this._view !== "3d" || !this._three) return;
        const w = stage.clientWidth || curW;
        if (w > 0 && Math.abs(w - curW) > 1) layout(w); else draw();
      }));
    window.addEventListener("orientationchange", onOrient);

    this._three = { renderer, scene, cam, ro, canvas3d, onCtxLost, onCtxRestored, onOrient, onPick, onDown, onMove, onUp, onCancel };
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

    // Mémorise le type de pointeur (souris vs tactile) pour adapter le comportement
    // des bouteilles : tactile = aperçu épinglé, souris = survol + clic direct.
    // Attaché UNE seule fois (le shadowRoot survit aux re-renders, sinon accumulation).
    if (!this._ptTracked) {
      this._ptTracked = true;
      s.addEventListener("pointerdown", (e) => { this._lastPT = e.pointerType || "mouse"; }, true);
    }

    s.getElementById("btn-history")?.addEventListener("click", () => this._openModal("history"));

    // Bouton « À ouvrir » → ouvre la page modale de sélection d'occasion
    s.getElementById("btn-open-page")?.addEventListener("click", () => this._openModal("openpage"));
    s.getElementById("env-temp")?.addEventListener("click", () => {
      const ent = this._data?.cellar?.temp_entity;
      if (ent) this._openModal("envhistory", { entity: ent, kind: "temperature" });
    });
    s.getElementById("env-humid")?.addEventListener("click", () => {
      const ent = this._data?.cellar?.humid_entity;
      if (ent) this._openModal("envhistory", { entity: ent, kind: "humidity" });
    });

    // v7.0.1 : le sélecteur de vue vit dans ⚙️ Options ; le header ouvre le Sommelier IA
    s.getElementById("btn-sommelier-top")?.addEventListener("click", () => this._openModal("sommelier"));
    s.getElementById("btn-options")?.addEventListener("click", () => this._openModal("options"));
    s.getElementById("btn-bottlelist")?.addEventListener("click", () => this._openModal("bottlelist"));
    s.getElementById("btn-racklist")?.addEventListener("click", () => this._openModal("racklist"));
    s.getElementById("btn-journal")?.addEventListener("click", () => this._openModal("journal"));
    // v7.1.0 : menu « ➕ Ajouter » (fusion + Casier / + Vin) — les items gardent
    // leurs ids historiques, donc leurs handlers d'ouverture restent inchangés.
    const addMenu = s.getElementById("add-menu");
    s.getElementById("btn-add-main")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (addMenu) addMenu.hidden = !addMenu.hidden;
    });
    addMenu?.querySelectorAll(".add-mi").forEach(mi =>
      mi.addEventListener("click", () => { addMenu.hidden = true; }));
    s.addEventListener("click", (e) => {
      if (addMenu && !addMenu.hidden && !e.composedPath().includes(s.getElementById("btn-add-main")))
        addMenu.hidden = true;
    });
    s.getElementById("sel-cellar")?.addEventListener("change", (e) => this._switchCellar(e.target.value));
    s.getElementById("btn-add-rack")?.addEventListener("click",   () => this._openModal("rack"));

    s.getElementById("btn-add-bottle")?.addEventListener("click", () => {
      if (!data.cellar.racks.length) {
        this._showToast("error", "Créez d'abord un casier !");
        return;
      }
      this._openModal("bottle");
    });

    s.querySelectorAll(".dot").forEach((dot) => {
      const wineId = dot.dataset.wineId;
      const wine = wineId ? wines.find(w => w.id === wineId) : null;
      const slot   = parseInt(dot.dataset.slot);
      const rackId = dot.dataset.rackId;

      dot.addEventListener("click", () => {
        // Un glisser tactile vient de se terminer → on neutralise le click induit
        if (this._suppressClick) { this._suppressClick = false; return; }
        // Case vide → formulaire d'ajout (souris comme tactile)
        if (!wine) { this._openModal("bottle", { slot: { rack_id: rackId, slot } }); return; }
        if (this._lastPT === "touch") {
          // Tactile : 1er tap → aperçu épinglé (la fiche s'ouvre en touchant l'aperçu)
          this._showBottlePanel(wine, dot, true);
        } else {
          // Souris : ouvre la fiche directement
          this._openModal("detail", { wine });
        }
      });

      // Survol souris (desktop uniquement) → aperçu non épinglé
      if (wine) {
        dot.removeAttribute("title");   // évite le doublon avec le panneau
        dot.addEventListener("mouseenter", () => { if (this._lastPT !== "touch") this._showBottlePanel(wine, dot); });
        dot.addEventListener("mouseleave", () => { if (this._lastPT !== "touch") this._hideBottlePanel(); });
      }
    });

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

    // ── Glisser-déposer TACTILE (mobile) ───────────────────────────────────────
    // Le DnD HTML5 natif (souris, ci-dessus) ne s'arme pas au toucher : on l'assure
    // en touch events. Appui maintenu (~260 ms) pour « saisir » (distingue du tap
    // d'aperçu et du défilement), puis on suit le doigt jusqu'au dépôt.
    const allDots   = Array.from(s.querySelectorAll(".dot"));
    const dotAtPoint = (x, y) => allDots.find((d) => {
      const r = d.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    const clearOver = () => s.querySelectorAll(".dot--drag-over").forEach((d) => d.classList.remove("dot--drag-over"));

    s.querySelectorAll(".dot--filled").forEach((dot) => {
      let td = null;   // état du geste : {x0, y0, timer, active}
      const stop = () => {
        if (td?.timer) clearTimeout(td.timer);
        td = null;
        dot.classList.remove("dot--grab");
        clearOver();
      };
      dot.addEventListener("touchstart", (e) => {
        if (!dot.dataset.wineId || e.touches.length !== 1) return;
        const t = e.touches[0];
        td = { x0: t.clientX, y0: t.clientY, timer: null, active: false };
        td.timer = setTimeout(() => {
          if (!td) return;
          td.active = true;
          dot.classList.add("dot--grab");
          try { navigator.vibrate?.(15); } catch (_) { /* noop */ }
        }, 260);
      }, { passive: true });
      dot.addEventListener("touchmove", (e) => {
        if (!td) return;
        const t = e.touches[0];
        if (!td.active) {
          // Bougé avant l'appui long = défilement : on abandonne (laisse scroller)
          if (Math.hypot(t.clientX - td.x0, t.clientY - td.y0) > 10) stop();
          return;
        }
        e.preventDefault();                 // drag armé → on bloque le défilement
        clearOver();
        const over = dotAtPoint(t.clientX, t.clientY);
        if (over && over !== dot) over.classList.add("dot--drag-over");
      }, { passive: false });
      dot.addEventListener("touchend", async (e) => {
        if (!td) return;
        const active = td.active;
        const t = e.changedTouches[0];
        stop();
        if (!active) return;                // simple appui → on laisse le click agir
        // Neutralise le click synthétique qui suit (sécurité : auto-reset)
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 500);
        const tgt = dotAtPoint(t.clientX, t.clientY);
        if (!tgt || tgt === dot) return;
        const src = {
          wineId: dot.dataset.wineId, slotIdx: parseInt(dot.dataset.slotIdx),
          rackId: dot.dataset.rackId,  slot: parseInt(dot.dataset.slot),
        };
        if (tgt.classList.contains("dot--filled") && tgt.dataset.wineId && tgt.dataset.wineId !== src.wineId) {
          await this._swapViaTemp(src, {
            wineId: tgt.dataset.wineId, slotIdx: parseInt(tgt.dataset.slotIdx),
            rackId: tgt.dataset.rackId,  slot: parseInt(tgt.dataset.slot),
          });
        } else if (tgt.classList.contains("dot--empty")) {
          await this._callService("move_slot", {
            wine_id: src.wineId, slot_idx: src.slotIdx,
            rack_id: tgt.dataset.rackId, slot: parseInt(tgt.dataset.slot),
          });
        }
      }, { passive: false });
      dot.addEventListener("touchcancel", stop, { passive: true });
    });
  }

  connectedCallback() {
    // Lovelace détache la carte lors d'un changement de vue (subview) puis la
    // ré-attache au retour : disconnectedCallback a démonté la 3D et coupé les
    // abonnements. On remonte tout ici. Le tout premier attachement, lui, reste
    // géré par `set hass` (sinon on créerait des abonnements en double).
    if (!this._hass || !this._wasDisconnected) return;
    this._wasDisconnected = false;
    this._subscribeUpdates();
    this._fetchData();   // recharge les données puis re-render → remonte la vue 3D
  }

  disconnectedCallback() {
    this._unsubs.forEach((f) => { try { f(); } catch (e) { /* déjà fermé */ } });
    this._unsubs = [];
    this._wasDisconnected = true;
    this._closeModal();
    this._unmount3D();
    this._hideBottlePanel();
    document.querySelector("#mm-toast-css")?.remove();
    document.querySelector("#mm-bpanel-css")?.remove();
    this._aiProgressClose();                          // fenêtre de progression IA
    document.querySelector("#mm-aiprog-css")?.remove();
  }
}

// ── Utilitaires ────────────────────────────────────────────────────────────────

const DEFAULT_DATA = () => ({ cellar: { id: "main", name: "Millésime", racks: [] }, cellars: [{ id: "main", name: "Millésime", racks: [] }], wines: [], tasting_log: [] });

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
  display: block; position: relative; font-size: var(--fs-base, 13px);
  /* Défaut FLUIDE de la base typographique posé ici (feuille de style) et non plus
     en inline → un override card-mod « :host { --fs-base: … } » peut le surcharger.
     Seule la config YAML font_size: repasse en inline (choix explicite, prioritaire). */
  --fs-base: clamp(13px, 3.1cqi, 18px);
  /* Le responsive est piloté par la largeur de la CARTE (container query), pas du
     viewport : une carte dans une colonne étroite se compacte même sur grand écran. */
  container-type: inline-size; container-name: mm;
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

/* Base de police appliquée ici (descendant du conteneur :host) pour que le clamp
   en cqi de --fs-base se mesure sur la largeur de la CARTE, pas du viewport. */
.card { background:var(--bg-0); border-radius:18px; overflow:hidden; border:1px solid var(--border); font-size:var(--fs-base, 13px); }

.loading-state { display:flex; align-items:center; justify-content:center; height:180px; }
.loading-glass { width:36px; opacity:0.5; animation:pulse-anim 1.4s ease-in-out infinite; }
@keyframes pulse-anim { 0%,100%{opacity:0.3} 50%{opacity:0.8} }

.header {
  display:flex; align-items:center; gap:clamp(10px,1.5cqi,14px);
  padding:clamp(12px,1.7cqi,16px) clamp(14px,2.4cqi,22px) clamp(10px,1.4cqi,13px);
  background:linear-gradient(160deg,color-mix(in srgb,var(--card-background-color,#111) 75%,var(--header-accent,#C0392B) 25%) 0%,var(--card-background-color,#111) 100%);
  border-bottom:1px solid var(--border); position:relative;
}
.header::after {
  content:''; position:absolute; bottom:0; left:14px; right:14px; height:1px;
  background:linear-gradient(90deg,transparent,var(--header-accent,var(--red))44,transparent);
}
/* Logo + nom empilés à gauche, centrés verticalement sur la hauteur des deux lignes */
.header-left { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; flex-shrink:0; }
.header-glass {
  width:clamp(28px,3.7cqi,34px);
  filter:drop-shadow(0 0 8px rgba(192,57,43,0.7));
  animation:float-anim 3s ease-in-out infinite;
}
@keyframes float-anim { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
.header-meta { text-align:center; }
.header-name { font-family:var(--font-serif); font-size:clamp(0.85em,2.4cqi,1.25em); color:var(--cream); line-height:1.2; }
.cellar-select {
  font-family:var(--font-serif); font-size:clamp(0.85em,2.4cqi,1.25em); color:var(--cream); line-height:1.2;
  background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.25);
  padding:0 2px 1px 0; cursor:pointer; max-width:180px;
}
.cellar-select:focus { outline:none; border-bottom-color:var(--accent); }
.cellar-select option { background:#241a1a; color:#f0e6d2; }
.header-tagline { font-size:clamp(0.55em,1.3cqi,0.74em); color:var(--red); text-transform:uppercase; letter-spacing:1.5px; margin-top:1px; }
/* Colonne droite : stats en haut, boutons en dessous */
.header-right { display:flex; flex-direction:column; gap:7px; flex:1; min-width:0; }
/* Stats et actions : MÊME grille (3 colonnes égales + colonne icône à droite) → alignement parfait */
/* v7.1.0 : hauteur de référence UNIQUE pour les DEUX rangées du header — la
   rangée d'actions se cale sur la hauteur des pilules de compteurs. */
.header-right { --hdrh: clamp(40px, 7.2cqi, 46px); }
.header-stats   { display:grid; grid-template-columns:1fr 1fr 1fr 40px; gap:5px; align-items:stretch; grid-auto-rows:var(--hdrh); }
.header-actions { display:grid; grid-template-columns:1fr 1fr 1fr 40px; gap:5px; align-items:stretch; grid-auto-rows:var(--hdrh); }
.header-stats > *, .header-actions > * { height:var(--hdrh); box-sizing:border-box; }
.btn-options-top, .btn-journal-top { width:40px; display:flex; align-items:center; justify-content:center; font-size:clamp(1.0em,2cqi,1.25em); }
.stat { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px 6px; background:var(--bg-2); border-radius:8px; border:1px solid var(--border); }
.stat-value { font-size:clamp(1.05em,2.1cqi,1.5em); font-weight:700; color:var(--cream); font-family:var(--font-serif); line-height:1; }
.stat-label { font-size:clamp(0.54em,0.95cqi,0.66em); color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
.stat-clickable { cursor:pointer; transition:all 0.15s; }
.stat-clickable:hover { background:var(--bg-3); border-color:var(--header-accent,var(--red)); }
.stat-clickable:active { transform:scale(0.97); }
.btn-rack {
  height:var(--hdrh); box-sizing:border-box; width:100%; min-width:0;
  display:flex; align-items:center; justify-content:center; gap:5px;
  background:#2BA5C7; color:#fff; border:none; border-radius:8px;
  font-size:clamp(0.82em,1.4cqi,1.0em); font-weight:600; padding:0 6px; white-space:nowrap; cursor:pointer;
  transition:filter 0.15s;
}
.btn-rack:hover { filter:brightness(1.1); }
.hdr-ico { flex:0 0 auto; width:clamp(14px,2.6cqi,17px); height:auto; }
/* v7.1.0 : la couleur signe les FONCTIONS DU VIN — À ouvrir et Sommelier en
   rouge Millésime, Ajouter (action générique) en gris moyen */
.btn-open-top { background:#7B1D2E; }
.btn-open-top--active { box-shadow:inset 0 0 0 2px #d8b25c; }   /* filtre occasion actif */
.btn-sommelier { background:#7B1D2E; }
.add-wrap { position:relative; min-width:0; }
.btn-add { background:#4a4f57; }
.add-menu {
  position:absolute; top:calc(var(--hdrh) + 5px); right:0; z-index:30; min-width:150px;
  background:var(--bg-2); border:1px solid var(--border); border-radius:11px; padding:5px;
  box-shadow:0 10px 26px rgba(0,0,0,0.45);
}
.add-mi {
  display:flex; align-items:center; gap:8px; width:100%; padding:11px 12px; border:none;
  background:transparent; color:var(--cream); font-size:0.92em; border-radius:8px; cursor:pointer; text-align:left;
}
.add-mi:hover { background:var(--bg-3); }

/* ── Ligne d'options repliable (sous le verre du logo) ── */
/* Zone de progression « Compléter les fiches » (sous l'en-tête) */
#refresh-progress-zone { padding:0 14px; }
#refresh-progress-zone .refresh-progress { margin:8px 0; }
.seg3 { display:flex; flex:1; min-width:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--bg-2); }
.seg3-btn {
  flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:4px;
  padding:7px 4px; border:none; background:transparent; color:var(--muted);
  font-size:clamp(0.76em,1.4cqi,0.95em); cursor:pointer; transition:all 0.13s; border-right:1px solid var(--border);
}
.seg3-btn:last-child { border-right:none; }
.seg3-btn:hover { background:var(--bg-3); color:var(--cream); }
.seg3-btn.active { background:var(--accent); color:#fff; font-weight:600; }
.seg3-lbl { font-size:clamp(0.82em,1.5cqi,1.0em); }
.header-glass.active { filter:drop-shadow(0 0 11px rgba(192,57,43,1)); transform:scale(1.08); }

.mm-empty-hint { text-align:center; color:var(--muted); padding:24px 0; font-size:0.85em; }
.mm-hint { font-size:0.66em; font-style:italic; color:#c8c8c8; margin-top:9px; line-height:1.4; }
.btn-primary, .btn-secondary {
  padding:clamp(7px,1.2cqi,9px) clamp(12px,2cqi,15px); border-radius:8px; border:none;
  font-family:var(--font-sans); font-size:clamp(0.85em,1.6cqi,1.05em); font-weight:600;
  cursor:pointer; transition:all 0.15s; white-space:nowrap;
}
.btn-primary { background:var(--accent); color:#fff; }
.btn-primary:hover { background:var(--accent-h); transform:translateY(-1px); }
.btn-secondary { background:var(--bg-3); color:var(--cream); border:1px solid var(--border); }
.btn-secondary:hover { background:var(--bg-4); }

.btn-icon {
  padding:0; min-width:clamp(32px,5cqi,40px); border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-size:clamp(1.08em,2.1cqi,1.25em); cursor:pointer; transition:all 0.15s;
}
.btn-icon:hover { background:var(--bg-3); }
.view-select {
  flex:1.8; min-width:0; padding:0 4px; border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-family:var(--font-sans); font-size:clamp(0.8em,1.6cqi,1.0em);
  cursor:pointer; transition:all 0.15s;
}
.view-select:hover { background:var(--bg-3); }

.env-row {
  display:flex; gap:clamp(6px,1.2cqi,10px); align-items:stretch;
  padding:clamp(6px,1.1cqi,9px) clamp(14px,2.4cqi,22px);
  background:var(--bg-1); border-bottom:1px solid var(--border);
}
.env-box {
  flex:1; display:flex; align-items:center; justify-content:center; gap:5px;
  padding:7px 8px; min-height:34px; box-sizing:border-box;
  background:var(--bg-2); border-radius:8px; border:1px solid var(--border);
}
.env-value { font-size:clamp(0.92em,1.7cqi,1.1em); font-weight:700; color:var(--cream); font-family:var(--font-serif); line-height:1; white-space:nowrap; }
.env-clickable { cursor:pointer; transition:all 0.15s; }
.env-clickable:hover { background:var(--bg-3); border-color:var(--header-accent,var(--red)); }
.env-clickable:active { transform:scale(0.97); }
.env-empty { opacity:0.5; }
/* Bouton « À ouvrir » (même gabarit que les zones T°/hygro) */
.env-open-active .env-open-label { color:#fff; }
.filters {
  display:flex; gap:clamp(8px,1.5cqi,14px); padding:clamp(8px,1.5cqi,11px) clamp(14px,2.4cqi,22px);
  background:var(--bg-1); border-bottom:1px solid var(--border);
}
.filter-group { display:flex; flex-direction:column; gap:4px; flex:1; }
.filter-label {
  font-size:clamp(0.7em,1.5cqi,0.95em); color:var(--muted); text-transform:uppercase;
  letter-spacing:1.5px; text-align:center;
}
.filter-select {
  width:100%; padding:6px 28px 6px 10px; border-radius:8px;
  border:1px solid var(--border); background:var(--bg-2);
  color:var(--cream); font-family:var(--font-sans); font-size:clamp(0.92em,1.7cqi,1.12em);
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
.empty-title { font-family:var(--font-serif); color:var(--cream); font-size:clamp(1.15em,2.5cqi,1.6em); margin-bottom:5px; }
.empty-sub { font-size:clamp(0.92em,1.6cqi,1.1em); color:var(--muted); }

.rack { margin-bottom:10px; animation:slide-in 0.3s ease-out both; }
@keyframes slide-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

.rack-frame {
  display:flex; align-items:center; gap:6px;
  background:var(--bg-1); border:1px solid var(--border); border-bottom:none;
  border-radius:10px 10px 0 0; padding:8px 9px; min-height:0;
}
.rack-counters { display:flex; flex-direction:column; align-items:flex-end; gap:1px; min-width:24px; }
.type-count { font-size:clamp(0.69em,1.1cqi,0.85em); font-weight:700; display:block; }
.rack-actions { display:flex; flex-direction:column; gap:3px; margin-left:2px; }
.icon-btn { background:none; border:none; cursor:pointer; font-size:clamp(0.85em,1.5cqi,1.05em); padding:2px; opacity:0.3; color:var(--cream); transition:opacity 0.15s; line-height:1; }
.icon-btn:hover { opacity:1; }

.rack-dots { display:grid; flex:1; gap:4px 3px; align-items:stretch; overflow:visible; }
/* Le .dot occupe toute la cellule (cible tactile pleine largeur) ; le SVG à
   l'intérieur est plafonné et centré. Plus de hauteur fixe : elle suit la
   bouteille (fluide). */
.dot { width:100%; cursor:pointer; transition:transform 0.12s, filter 0.12s; display:flex; align-items:flex-end; justify-content:center; }
/* Taille FLUIDE et progressive : le plafond grandit/diminue avec la largeur de la
   CARTE (cqi) ; sous ce plafond, la largeur suit la colonne (1fr) → jamais de
   débordement, quel que soit le nombre de colonnes ou la largeur d'écran. */
.dot-svg-b { width:100%; max-width:clamp(17px, 5.6cqi, 34px); height:auto; }
.dot-svg-c { width:100%; max-width:clamp(20px, 6.4cqi, 42px); height:auto; }
.dot--c-alt .dot-svg-c { max-width:clamp(14px, 4.4cqi, 29px); }  /* tête-bêche pastille : plus petit */
.dot--empty { opacity:0.3; }
.dot--empty:hover { opacity:0.55; transform:scale(1.08); }
.dot--filled { filter:drop-shadow(0 2px 4px var(--dot-glow,rgba(192,57,43,0.35))); }
.dot--filled:hover { transform:scale(1.12) translateY(-2px); filter:drop-shadow(0 4px 8px var(--dot-glow,rgba(192,57,43,0.6))); }
.dot--selected { filter:drop-shadow(0 0 5px var(--gold)) drop-shadow(0 2px 5px var(--dot-glow,rgba(192,57,43,0.4))); transform:scale(1.1); }
@keyframes bottle-flash {
  0%, 100% { filter:drop-shadow(0 0 4px var(--gold)); }
  50% { filter:drop-shadow(0 0 14px var(--gold)) drop-shadow(0 0 22px var(--gold)); }
}
.bottle-flash { animation:bottle-flash 0.5s ease-in-out 4; z-index:5; }
/* Barre de progression « Compléter les fiches » (dans le menu options) */
.refresh-progress {
  margin-top:10px;
  background:var(--bg-2); border:1px solid var(--border); border-radius:10px;
  padding:9px 11px;
}
.rp-label { font-size:clamp(0.78em,1.4cqi,0.92em); color:var(--cream); margin-bottom:6px; font-weight:600; }
.rp-track { height:7px; background:var(--bg-1); border-radius:4px; overflow:hidden; }
.rp-fill { height:100%; width:0; background:linear-gradient(90deg,#2BA5C7,#1E88C7); border-radius:4px; transition:width 0.3s ease; }
.dot--alt { transform:rotate(180deg); }
.dot--alt:hover { transform:rotate(180deg) scale(1.12) translateY(2px); }
.dot--alt.dot--selected { transform:rotate(180deg) scale(1.1); }
.dot--dragging { opacity:0.25 !important; cursor:grabbing !important; }
.dot--grab { transform:scale(1.3) translateY(-3px) !important; filter:drop-shadow(0 0 9px var(--gold)) !important; opacity:1 !important; position:relative; z-index:6; cursor:grabbing; }
.dot--filled[draggable="true"] { cursor:grab; }
.dot--drag-over { filter:drop-shadow(0 0 6px var(--accent)) !important; transform:scale(1.18) translateY(-2px); opacity:1 !important; }

/* ─── Scène 3D (Three.js) ─── */
.view3d-stage {
  position:relative; background:linear-gradient(180deg,#15100C 0%,#0C0A08 100%);
  border:1px solid var(--border); border-radius:12px; overflow:hidden;
}
.three-loading {
  display:flex; align-items:center; justify-content:center; gap:8px;
  height:170px; color:var(--muted); font-size:clamp(0.92em,1.6cqi,1.1em);
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
  border-radius:8px; padding:3px 10px; font-size:clamp(0.77em,1.4cqi,0.98em); color:var(--cream);
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
  font-size:clamp(0.69em,1.4cqi,0.92em); font-weight:600; color:var(--gold); letter-spacing:2px; text-transform:uppercase;
}
.rack-pct { color:var(--wood-lt); font-size:clamp(0.62em,1.0cqi,0.78em); }

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

/* ─── Responsive : container queries (largeur de la CARTE, pas du viewport) ─── */
/* Palier « étroit » : carte compacte (téléphone plein écran, demi-colonne…) */
@container mm (max-width: 500px) {
  .cellar { padding:6px 5px; }
  .rack-frame { padding:4px 5px; }
  .rack-dots { gap:2px !important; }
  /* Les bouteilles/pastilles se réduisent désormais en continu (clamp cqi) :
     plus besoin de forcer une hauteur en pixels par palier. */
  .dot-lbl { font-size:0.69em; letter-spacing:0; }
  .header { padding:7px 8px 6px; gap:7px; }
  .env-row { padding:5px 8px; gap:5px; }
  .env-value { font-size:0.85em; }
  .header-glass { width:22px; }
  .header-name { font-size:0.69em; }
  .stat-value { font-size:0.92em; }
  .stat { padding:3px 4px; }
  .btn-primary, .btn-secondary { font-size:0.77em; padding:5px 7px; }
  .filter-select { font-size:0.85em; min-height:30px; padding:4px 24px 4px 8px; }
  .rack-label { font-size:0.54em; letter-spacing:1px; padding:3px 8px; }
}
/* Palier « très étroit » : petits téléphones / colonnes serrées */
@container mm (max-width: 360px) {
  .cellar { padding:5px 4px; }
  .header { padding:6px 7px 5px; gap:5px; }
  .env-row { padding:4px 7px; gap:4px; }
  .env-open-label { font-size:0.72em; }
  .header-tagline { display:none; }            /* gain de hauteur, le nom suffit */
  .header-glass { width:20px; }
  .header-name { font-size:0.62em; }
  .stat-value { font-size:0.82em; }
  .stat-label { font-size:0.5em; }
  .stat { padding:3px; }
  .ha-icons { gap:3px; }
  .btn-icon { min-width:28px; font-size:1em; }
  .btn-primary, .btn-secondary { font-size:0.72em; padding:5px; }
  .filters { padding:6px 8px; gap:6px; }
}
/* Transitions douces : l'en-tête, les filtres et les boutons grandissent en
   continu avec la largeur de la carte via clamp(em, …cqi, em) sur les règles de
   base — plus de palier-saut « large », et les bornes em respectent font_size. */
</style>`;

// ── CSS du modal ────────────────────────────────────────────────────────────────

const MODAL_CSS = `
@keyframes mm-fade  { from{opacity:0} to{opacity:1} }
@keyframes mm-slide { from{opacity:0;transform:translateY(-18px)} to{opacity:1;transform:translateY(0)} }
@keyframes mm-spin  { to{transform:rotate(360deg)} }

/* box-sizing universel, scopé au modal (monté dans document.body, hors shadow
   root : la règle * de la carte ne s'y applique pas). Sans lui, les <div> en
   width:100% + padding débordent à droite — les <button> non, car la feuille
   de style des navigateurs les met déjà en border-box. Corrige le décalage de
   la tuile « Repères 3D » dans la fenêtre Options. */
.mm-overlay, .mm-overlay * { box-sizing:border-box; }

.mm-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:99999;
  display:flex; align-items:flex-start; justify-content:center;
  padding-top:max(8px, env(safe-area-inset-top));
  padding-bottom:env(safe-area-inset-bottom);
  animation:mm-fade 0.15s ease; font-family:var(--font-sans); font-size:var(--fs-base, 13px);
  --mm-bg0: var(--primary-background-color, #080808);
  --mm-bg1: var(--card-background-color, #111);
  --mm-bg2: var(--secondary-background-color, #181818);
  --mm-bg3: color-mix(in srgb, var(--card-background-color, #1A1A1A) 80%, var(--primary-text-color, white) 20%);
  --mm-text: var(--primary-text-color, #EDE0CC);
  --mm-muted: var(--secondary-text-color, #555);
  --mm-border: var(--divider-color, #222);
  --mm-accent: var(--header-accent, #7B1D2E);
  --mm-red: var(--primary-color, #C0392B);
  --mm-red-h: var(--secondary-color, #E74C3C);
}
.mm-box {
  background:var(--mm-bg1); border:1px solid var(--mm-border); border-top:none;
  border-radius:0 0 20px 20px;
  width:100%; max-width:520px; overflow-x:hidden;
  /* dvh = hauteur de vue dynamique : tient compte des barres mobiles (Safari iOS) */
  max-height:calc(100dvh - max(16px, env(safe-area-inset-top)) - env(safe-area-inset-bottom));
  display:flex; flex-direction:column;
  animation:mm-slide 0.22s ease-out; color:var(--mm-text);
  overflow:hidden;
}
/* Liste des bouteilles : occupe toute la largeur dispo (PC comme mobile) */
.mm-box-wide { max-width:min(680px, 95vw); }
/* ── Liste des bouteilles : arborescence Couleur → Région → Châteaux ── */
.vlist { display:flex; flex-direction:column; }
.vlist-color-head { display:flex; align-items:center; gap:10px; padding:11px 2px 7px; margin-top:6px;
  border-bottom:2px solid var(--c, var(--mm-accent,#7B1D2E)); }
.vlist-color-head:first-child { margin-top:0; }
.vlist-swatch { width:13px; height:13px; border-radius:50%; box-shadow:0 0 5px rgba(0,0,0,0.35); flex-shrink:0; }
.vlist-color-name { font-family:var(--font-serif,Georgia,serif); font-size:0.98em; font-weight:bold;
  letter-spacing:1px; color:var(--mm-text); text-transform:uppercase; }
.vlist-count { margin-left:auto; font-size:0.78em; color:var(--c, var(--mm-accent,#7B1D2E)); }
.vlist-region-head { font-size:0.84em; color:var(--mm-muted); padding:11px 0 4px 2px; }
.vlist-wine { padding:7px 10px 8px; margin-left:14px; border-left:2px solid var(--mm-border);
  cursor:pointer; transition:background 0.12s; }
.vlist-wine:hover { background:var(--mm-bg3); }
.vlist-wine-top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.vlist-wine-name { font-size:0.92em; color:var(--mm-text); min-width:0; overflow:hidden; text-overflow:ellipsis; }
.vlist-wine-name i { color:var(--mm-muted); font-style:italic; font-family:var(--font-serif,Georgia,serif); }
.vfav { color:#E0A82E; }
/* Queue de ligne : quantité AVANT le prix */
.vlist-wine-tail { display:flex; align-items:baseline; gap:8px; white-space:nowrap; flex-shrink:0; }
.vlist-wine-qty { font-size:0.78em; color:var(--mm-muted); font-variant-numeric:tabular-nums; }
.vlist-wine-price { font-size:0.86em; font-weight:600; color:var(--mm-text); white-space:nowrap; font-variant-numeric:tabular-nums; }
.vlist-wine-meta { display:flex; gap:14px; flex-wrap:wrap; margin-top:4px; }
.vlist-wine-meta .vm { font-size:0.74em; color:var(--mm-muted); white-space:nowrap; }
/* Colonnes alignées : apogée | occasion (grille fixe → alignement vertical) */
.vlist-wine-cols { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px; }
.vlist-wine-cols .vcol { font-size:0.74em; color:var(--mm-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* Liste des casiers : en-tête de casier + lignes de vins */
.rk-head { display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:11px 2px 7px; margin-top:10px; border-bottom:2px solid var(--mm-accent,#7B1D2E); }
.rk-head:first-child { margin-top:0; }
.rk-name { font-family:var(--font-serif,Georgia,serif); font-size:0.98em; font-weight:bold;
  letter-spacing:0.5px; color:var(--mm-text); }
.rk-stat { font-size:0.78em; color:var(--mm-accent,#7B1D2E); font-variant-numeric:tabular-nums; white-space:nowrap; }
.rk-empty { font-size:0.8em; color:var(--mm-muted); font-style:italic; padding:6px 0 6px 16px; }
.rk-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:middle; box-shadow:0 0 4px rgba(0,0,0,0.4); }
.rk-slot { font-size:0.76em; color:var(--mm-muted); font-variant-numeric:tabular-nums; }
.env-range-btn {
  flex:1; padding:6px 4px; border-radius:7px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-muted); font-size:0.82em; cursor:pointer;
  font-family:var(--font-sans); transition:all 0.13s;
}
.env-range-btn:hover { color:var(--mm-text); }
.env-range-btn.active { background:var(--mm-accent); color:#fff; border-color:var(--mm-accent); }
.vlist-search-wrap { padding:10px 20px 0; }
.vlist-search {
  width:100%; box-sizing:border-box; padding:9px 12px; border-radius:9px;
  border:1px solid var(--mm-border); background:var(--mm-bg2); color:var(--mm-text);
  font-size:0.92em; font-family:var(--font-sans,Inter,sans-serif); outline:none;
}
.vlist-search:focus { border-color:var(--mm-accent); }
.vlist-search::placeholder { color:var(--mm-muted); }
/* Page « À ouvrir » : sous-onglets + boutons occasion (dans le modal) */
.sub-tabs { display:flex; gap:5px; margin-bottom:14px; }
.sub-tab {
  flex:1; padding:9px 4px; border-radius:8px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-muted); font-size:0.78em; font-weight:600;
  cursor:pointer; transition:all 0.13s; white-space:nowrap;
}
.sub-tab:hover { color:var(--mm-text); }
.sub-tab.active { background:var(--mm-accent); color:#fff; border-color:var(--mm-accent); }
.sub-panel { display:none; }
.sub-panel.active { display:block; }
.sub-soon { text-align:center; padding:30px 8px; color:var(--mm-muted); font-size:0.9em; font-style:italic; }
.occ-hint { font-size:0.82em; color:var(--mm-muted); margin-bottom:12px; line-height:1.4; }
.occ-btns { display:flex; flex-wrap:wrap; gap:8px; }
.occ-btn {
  padding:10px 16px; border-radius:18px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-text); font-size:0.86em; font-weight:500;
  cursor:pointer; transition:all 0.13s;
}
.occ-btn:hover { border-color:var(--mm-accent); }
.occ-btn.active { background:var(--mm-accent); color:#fff; border-color:var(--mm-accent); }
/* Apogée */
/* Profil de garde (v7) : dépliant + graphique en segments */
.apo-chart { border:1px solid var(--mm-border); border-radius:10px; background:var(--mm-bg2); margin-bottom:10px; overflow:hidden; }
.apo-chart-summary { cursor:pointer; padding:10px 12px; font-weight:600; color:var(--mm-text); font-size:0.9em; list-style:none; user-select:none; }
.apo-chart-summary::-webkit-details-marker { display:none; }
.apo-chart-summary::before { content:"▸ "; color:#d8b25c; transition:transform 0.15s; display:inline-block; }
.apo-chart[open] .apo-chart-summary::before { transform:rotate(90deg); }
.apo-chart-body { padding:4px 8px 10px; max-height:420px; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.apo-chart-svg { display:block; }
.apo-chart-legend { font-size:0.68em; color:var(--mm-muted); margin-top:6px; line-height:1.4; text-align:center; }
.apo-chart-empty { padding:14px; color:var(--mm-muted); font-size:0.8em; text-align:center; }
.apo-seg:hover line, .apo-seg:active line { opacity:1 !important; }
/* Top 10 des priorités */
.apo-top { border:1px solid var(--mm-border); border-radius:10px; background:var(--mm-bg2); margin-bottom:10px; padding:8px 10px 6px; }
.apo-top-title { font-weight:700; color:#d8b25c; font-size:0.86em; margin-bottom:5px; }
.apo-top-row { display:grid; grid-template-columns:22px 1fr auto; align-items:center; gap:7px; width:100%; padding:6px 4px; background:none; border:none; border-top:1px solid var(--mm-border); color:var(--mm-text); font-size:0.84em; cursor:pointer; text-align:left; }
.apo-top-row:first-of-type { border-top:none; }
.apo-top-row:hover { background:var(--mm-bg1); }
.apo-top-rank { color:var(--mm-muted); font-weight:700; }
.apo-top-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.apo-top-name i { color:var(--mm-muted); font-style:normal; }
.apo-top-until { color:var(--mm-accent); font-weight:600; white-space:nowrap; font-size:0.88em; }
.apo-hint, .acc-hint { font-size:0.82em; color:var(--mm-muted); margin-bottom:12px; line-height:1.4; }
.apo-states { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.apo-state {
  display:flex; align-items:center; gap:8px; padding:12px 10px;
  border-radius:10px; border:1px solid var(--mm-border); background:var(--mm-bg2);
  color:var(--mm-text); font-size:0.86em; cursor:pointer; transition:all 0.13s; text-align:left;
}
.apo-state:hover { border-color:var(--mm-accent); }
.apo-state.active { background:var(--mm-accent); color:#fff; border-color:var(--mm-accent); }
.apo-emoji { font-size:1.1em; }
.apo-label { flex:1; font-weight:600; line-height:1.2; }
.apo-count { font-weight:700; font-variant-numeric:tabular-nums; min-width:1.5em; text-align:right; }
.apo-none-note, .acc-approx { font-size:0.76em; color:var(--mm-muted); font-style:italic; margin-top:10px; }
.apo-list, .acc-list { margin-top:6px; }
.ap-wine { cursor:pointer; }
/* Accords */
.acc-selects { display:flex; flex-direction:column; gap:8px; }
.acc-sel { width:100%; }
.acc-empty { text-align:center; padding:20px 8px; color:var(--mm-muted); font-style:italic; font-size:0.85em; }
.acc-badge {
  font-size:0.66em; font-weight:700; padding:2px 7px; border-radius:10px;
  background:var(--mm-bg3); color:var(--mm-text); white-space:nowrap;
}
.acc-badge.acc-top { background:#C9A84C; color:#1a1206; }
.acc-badge.acc-ok  { background:#3a6b4a; color:#fff; }
.acc-badge.acc-low { background:var(--mm-bg2); color:var(--mm-muted); }
/* Recherche libre + IA */
.acc-searchwrap { display:flex; gap:8px; margin-bottom:10px; }
.acc-search { flex:1; }
.acc-go {
  padding:0 16px; border-radius:10px; border:none; background:var(--mm-accent);
  color:#fff; font-size:0.86em; font-weight:600; cursor:pointer; white-space:nowrap;
}
.acc-go:hover { filter:brightness(1.1); }
.acc-or { text-align:center; font-size:0.72em; color:var(--mm-muted); margin:4px 0 10px; letter-spacing:1px; }
.acc-ai-btn {
  display:block; width:100%; margin-top:12px; padding:11px;
  border-radius:10px; border:1px solid #C9A84C; background:transparent;
  color:#C9A84C; font-size:0.86em; font-weight:600; cursor:pointer; transition:all 0.13s;
}
.acc-ai-btn:hover { background:#C9A84C; color:#1a1206; }
.acc-aibadge { font-size:0.78em; color:#C9A84C; font-weight:600; margin-bottom:10px; }
.acc-reason { font-size:0.74em; color:var(--mm-muted); font-style:italic; margin:-4px 0 8px 4px; line-height:1.35; }
.acc-loading { display:flex; align-items:center; gap:10px; justify-content:center; padding:24px 8px; color:var(--mm-muted); font-size:0.86em; }
/* Fenêtre Options */
.mm-opt-list { display:flex; flex-direction:column; gap:10px; }
.mm-opt-item {
  box-sizing:border-box; /* explicite : la tuile Repères 3D est une <div>, pas un <button> */
  display:flex; align-items:center; gap:13px; width:100%; text-align:left;
  padding:13px 14px; border-radius:12px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-text); cursor:pointer; transition:border-color 0.13s;
}
.mm-opt-item:hover { border-color:var(--mm-accent); }
.mm-opt-static { cursor:default; flex-direction:column; align-items:stretch; gap:11px; }
.mm-opt-static:hover { border-color:var(--mm-border); }
/* v7.0.2 : espacement des clayettes — sous le sélecteur de vue, visible en 3D */
.opt-gap { padding-top:10px; border-top:1px dashed #5a2a33; }
.opt-gap--hidden { display:none; }
.opt-gap-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; font-size:0.84em; color:var(--mm-text); }
.opt-gap-head b { color:#C0392B; font-variant-numeric:tabular-nums; }
.opt-gap input[type="range"] { width:100%; accent-color:#7B1D2E; }
.opt-gap-hint { display:block; margin-top:5px; font-size:0.68em; color:var(--mm-muted); }
.mm-opt-row { display:flex; align-items:center; gap:13px; min-width:0; }
.mm-opt-tokens { font-size:0.72em; color:var(--mm-muted); text-align:center; padding:2px 4px 0; font-variant-numeric:tabular-nums; }
/* Profil aromatique (fiche du vin) */
/* v7.0.1 : seg3 GÉNÉRIQUE dans toute fenêtre — les sélecteurs « Un plat /
   Menu complet » et « Conseil d'achat / Opportunité » n'avaient aucun style
   propre dans les modales (le CSS de la carte ne s'y applique pas) et
   n'étaient donc pas au format des autres boutons. */
.mm-body .seg3 { display:flex; width:100%; border:1px solid var(--mm-border); border-radius:10px; overflow:hidden; background:var(--mm-bg2); box-sizing:border-box; }
.mm-body .seg3-btn {
  flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px;
  padding:11px 4px; border:none; border-right:1px solid var(--mm-border);
  background:transparent; color:var(--mm-muted); font-size:0.84em; cursor:pointer; transition:all 0.13s;
}
.mm-body .seg3-btn:last-child { border-right:none; }
.mm-body .seg3-btn:hover { color:var(--mm-text); }
.mm-body .seg3-btn.active { background:var(--mm-accent); color:#fff; font-weight:600; }
.mm-body .seg3-lbl { font-size:0.92em; }
/* Sous-menus (choix de mode DANS une page) : teinte rouge Millésime distinctive (v7.0.2) */
.mm-body .seg3--sub { border-color:#5a2a33; background:rgba(123,29,46,0.10); }
.mm-body .seg3--sub .seg3-btn { border-right-color:#5a2a33; }
.mm-body .seg3--sub .seg3-btn.active { background:#7B1D2E; }
/* ── Menus déroulants du référentiel (v7.1.10) ── */
/* La flèche est le repère visuel qui manquait en 7.1.9 : elle signale
   immédiatement qu'une liste existe, sans avoir à deviner qu'il faut taper. */
select.mm-pick {
  appearance:none; -webkit-appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,var(--mm-muted) 50%),
                   linear-gradient(135deg,var(--mm-muted) 50%,transparent 50%);
  background-position:calc(100% - 17px) 50%, calc(100% - 12px) 50%;
  background-size:5px 5px, 5px 5px;
  background-repeat:no-repeat;
  padding-right:32px; cursor:pointer;
}
select.mm-pick:focus { border-color:var(--mm-red); }
.mm-pick-free { font-style:italic; }
/* ── Vérification des contradictions IA (v7.1.9) ── */
.cf-overlay {
  position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,0.62); padding:14px; animation:mm-fade 0.15s ease;
}
.cf-box { width:100%; max-width:440px; max-height:88vh; display:flex; flex-direction:column;
  border-radius:16px; border:1px solid var(--mm-border); }
.cf-intro { font-size:0.87em; line-height:1.6; margin-bottom:12px; }
.cf-ok { font-size:0.79em; color:#8c8; background:rgba(46,92,59,0.15);
  border-radius:8px; padding:8px 11px; margin-bottom:13px; line-height:1.5; }
.cf-row { border:1px solid var(--mm-border); border-radius:11px; padding:11px;
  margin-bottom:11px; background:var(--mm-bg2); }
.cf-lbl { font-size:0.74em; color:var(--mm-muted); text-transform:uppercase;
  letter-spacing:0.7px; margin-bottom:9px; }
.cf-opts { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.cf-opt { display:flex; flex-direction:column; gap:4px; text-align:left;
  border:1.5px solid var(--mm-border); border-radius:9px; padding:9px;
  background:var(--mm-bg0); color:var(--mm-text); cursor:pointer; font-family:inherit; }
.cf-opt.sel { border-color:var(--mm-accent); background:rgba(123,29,46,0.17); }
.cf-t { font-size:0.66em; color:var(--mm-muted); text-transform:uppercase; letter-spacing:0.5px; }
.cf-v { font-size:0.93em; line-height:1.35; word-break:break-word; }
.cf-flag { font-size:0.71em; color:#d98; margin-top:7px; line-height:1.45; }
/* ── Retrait ciblé d'une bouteille (v7.1.7) ── */
.rp-list { display:flex; flex-direction:column; gap:7px; }
.rp-item {
  display:flex; align-items:center; gap:10px; width:100%; padding:13px 14px;
  background:var(--mm-bg2); border:1px solid var(--mm-border); border-radius:10px;
  color:var(--mm-text); font-size:0.92em; cursor:pointer; text-align:left; transition:all 0.13s;
}
.rp-item:hover { border-color:#8c0a0a; background:rgba(140,10,10,0.14); }
.rp-loc { font-weight:600; }
.rp-meta { color:var(--mm-muted); font-size:0.82em; }
.rp-act { margin-left:auto; color:#ff6b6b; font-size:0.84em; font-weight:600; }
/* Filtres du Profil de garde (v7.0.1) */
.apo-filters { display:flex; gap:8px; margin-bottom:12px; }
/* ── Personnalisation des icônes (v7.1.0) ── */
.ico-grp { font-size:0.78em; color:var(--mm-muted); letter-spacing:0.4px; margin:14px 0 7px; }
.ico-choices { display:flex; gap:8px; }
.ico-choice {
  position:relative; flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:13px 4px 9px; border:1.5px solid var(--mm-border); border-radius:11px;
  background:var(--mm-bg2); color:var(--mm-text); cursor:pointer; transition:all 0.13s;
}
.ico-choice:hover { border-color:#7B1D2E; }
.ico-choice.sel { border-color:#7B1D2E; background:rgba(123,29,46,0.16); }
.ico-choice .ico-check { position:absolute; top:4px; right:7px; color:#C0392B; font-size:0.72em; visibility:hidden; }
.ico-choice.sel .ico-check { visibility:visible; }
.ico-lbl { font-size:0.68em; color:var(--mm-muted); }
/* ── Glossaires ℹ️ (v7.1.0) ── */
.gl-info {
  display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px;
  margin-left:6px; border-radius:50%; border:1px solid var(--mm-muted); background:transparent;
  color:var(--mm-muted); font-size:0.68em; font-style:italic; font-family:serif; cursor:pointer; vertical-align:middle;
}
.gl-info.on { border-color:#7B1D2E; background:#7B1D2E; color:#fff; }
.gl-panel { background:var(--mm-bg0); border:1px solid #5a2a33; border-radius:9px; padding:8px 11px; margin:6px 0 10px; }
.gl-row { font-size:0.74em; line-height:1.55; color:var(--mm-muted); margin:3px 0; }
.gl-row b { color:var(--mm-text); }
/* ── Structure en bouche (v7.1.0) ── */
.st-row { display:flex; align-items:center; gap:9px; margin:7px 0; }
.st-lbl { flex:0 0 82px; font-size:0.8em; color:var(--mm-text); text-align:right; }
.st-trk { flex:1; height:9px; background:var(--mm-border); border-radius:5px; overflow:hidden; opacity:0.9; }
.st-fil { height:100%; border-radius:5px; }
.st-val { flex:0 0 26px; font-size:0.72em; color:var(--mm-muted); font-variant-numeric:tabular-nums; }
/* ── Chips « Envie de… » : classe autonome (v7.1.0, ex .occ-btn) ── */
.envie-grp { font-size:0.8em; color:var(--mm-muted); letter-spacing:0.3px; margin:12px 0 7px; display:flex; align-items:center; }
.envie-chip {
  border:1px solid var(--mm-border); border-radius:17px; padding:7px 13px;
  background:var(--mm-bg2); color:var(--mm-muted); font-size:0.82em; cursor:pointer; transition:all 0.13s;
}
.envie-chip:hover { border-color:#7B1D2E; color:var(--mm-text); }
.envie-chip.active { background:#7B1D2E; border-color:#7B1D2E; color:#fff; }
.apo-fsel { flex:1; min-width:0; }
.apo-top-until--past { color:#e05a5a; font-weight:700; }
/* Envie de… (v7.0.1) */
.envie-chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.envie-color { margin-bottom:12px; }
/* v7.0.2 : boutons d'action PLEINE LARGEUR harmonisés (Envie de…, Choisir dans
   ma cave, audits Sommelier) — même gabarit partout : 42 px, rayon 10, rouge
   Millésime, contenu centré */
.envie-go, .acc-menu-go {
  width:100%; height:42px; display:flex; align-items:center; justify-content:center;
  gap:7px; background:#7B1D2E; font-size:0.92em; border-radius:10px;
}
.envie-go:hover { filter:brightness(1.1); }
.envie-card { border:1px solid #5a2a33; border-radius:12px; background:rgba(123,29,46,0.08); padding:12px 14px; margin-top:12px; }
.envie-card-head { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:1.02em; }
.envie-price { margin-left:auto; font-weight:800; color:#d8b25c; font-size:1.08em; white-space:nowrap; }
.envie-card-meta { font-size:0.78em; color:var(--mm-muted); margin:5px 0 8px; }
.envie-card-line { font-size:0.86em; color:var(--mm-text); margin:4px 0; line-height:1.4; }
.envie-card .envie-locate { margin-top:8px; }
/* Barre de consommation IA quotidienne (v7.0.1) */
.mm-tokbar-label { font-size:0.78em; color:var(--mm-text); margin-bottom:5px; text-align:left; }
.mm-tokbar-track { position:relative; height:14px; background:var(--mm-bg0); border:1px solid var(--mm-border); border-radius:7px; overflow:hidden; }
.mm-tokbar-fill { height:100%; background:linear-gradient(90deg,#2E5C3B,#3f7a50); border-radius:7px; transition:width 0.4s ease; }
.mm-tokbar-fill--warn { background:linear-gradient(90deg,#7B1D2E,#C0392B); }
.mm-tokbar-pct { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.68em; font-weight:700; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.7); }
.mm-tokbar-hint { font-size:0.64em; color:var(--mm-muted); margin-top:4px; line-height:1.35; text-align:left; }
.aroma-box { border:1px solid var(--mm-border); border-radius:10px; background:var(--mm-bg2); margin:10px 0; overflow:hidden; }
.aroma-summary { cursor:pointer; padding:9px 12px; font-weight:600; color:var(--mm-text); font-size:0.88em; list-style:none; user-select:none; }
.aroma-summary::-webkit-details-marker { display:none; }
.aroma-summary::before { content:"▸ "; color:#d8b25c; transition:transform 0.15s; display:inline-block; }
.aroma-box[open] .aroma-summary::before { transform:rotate(90deg); }
/* v7.0.1 : profil toujours visible — titre statique, sans chevron */
.aroma-summary--static { cursor:default; }
.aroma-summary--static::before { content:""; }
.aroma-body { padding:2px 10px 10px; }
.aroma-svg { display:block; width:100%; max-width:420px; margin:0 auto; }
.aroma-legend { font-size:0.66em; color:var(--mm-muted); text-align:center; margin-top:5px; line-height:1.35; }
/* Accords v7 : modes + menu complet */
.acc-mode, .som-mode { margin-bottom:12px; }
.acc-ai-hint { display:flex; align-items:center; gap:8px; padding:9px 4px 2px; color:var(--mm-muted); font-size:0.8em; }
.acc-menu-fields { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.acc-menu-lbl { font-size:0.72em; color:var(--mm-muted); font-weight:600; margin-top:6px; }
.acc-menu-go { margin-bottom:10px; }
.menu-choice { border:1px solid var(--mm-border); border-radius:10px; background:var(--mm-bg2); padding:10px 12px; margin-bottom:8px; }
.menu-choice-head { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:0.92em; }
.menu-choice-head i { color:var(--mm-muted); font-style:normal; }
.menu-covers { margin-left:auto; font-size:0.72em; color:#d8b25c; border:1px solid #d8b25c55; border-radius:6px; padding:1px 6px; white-space:nowrap; }
.menu-choice-reason { font-size:0.8em; color:var(--mm-muted); margin:6px 0; line-height:1.4; }
.menu-locate { font-size:0.78em; padding:6px 10px; }
.menu-service, .menu-note { font-size:0.8em; color:var(--mm-text); background:var(--mm-bg2); border:1px dashed var(--mm-border); border-radius:8px; padding:8px 10px; margin-top:6px; line-height:1.45; }
/* Sommelier */
.som-fields { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.som-balance { font-size:0.84em; color:var(--mm-text); background:var(--mm-bg2); border:1px solid var(--mm-border); border-radius:10px; padding:9px 11px; margin-bottom:9px; line-height:1.45; }
.som-rank { color:var(--mm-muted); font-weight:700; }
.som-sug-meta { display:flex; flex-wrap:wrap; gap:5px 12px; font-size:0.74em; color:var(--mm-muted); margin-top:5px; }
.som-verdict { font-size:0.95em; padding:10px 12px; border-radius:10px; border:1px solid var(--mm-border); background:var(--mm-bg2); margin-bottom:9px; }
.som-verdict--ok  { border-color:#2E5C3B; }
.som-verdict--mid { border-color:#b8860b; }
.som-verdict--no  { border-color:var(--mm-accent); }
.som-opp-rows { display:flex; flex-direction:column; gap:7px; }
.som-opp-row { font-size:0.82em; color:var(--mm-text); line-height:1.45; }
.som-opp-row small { color:var(--mm-muted); }
/* Fenêtre Gérer les caves */
.mm-cave-list { display:flex; flex-direction:column; gap:10px; }
.mm-cave-row {
  display:grid; grid-template-columns:1fr auto auto auto; align-items:center; gap:8px;
  padding:10px 12px; border:1px solid var(--mm-border); border-radius:12px; background:var(--mm-bg2);
}
.mm-cave-row .mm-cave-name { min-width:0; }
.mm-cave-meta { font-size:0.74em; color:var(--mm-muted); white-space:nowrap; }
.mm-cave-btn { background:none; border:1px solid var(--mm-border); border-radius:8px; padding:6px 8px; cursor:pointer; font-size:1em; transition:border-color 0.13s; }
.mm-cave-btn:hover { border-color:var(--mm-accent); }
.mm-cave-btn--off { opacity:0.3; cursor:not-allowed; }
.mm-opt-emoji { font-size:1.35em; flex-shrink:0; }
.mm-opt-txt { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.mm-opt-txt b { font-size:0.92em; }
.mm-opt-txt small { font-size:0.74em; color:var(--mm-muted); line-height:1.3; }
.mm-opt-list .seg3 { display:flex; width:100%; border:1px solid var(--mm-border); border-radius:10px; overflow:hidden; background:var(--mm-bg2); }
.mm-opt-list .seg3-btn {
  flex:1; display:flex; align-items:center; justify-content:center; gap:6px;
  padding:11px 4px; border:none; border-right:1px solid var(--mm-border);
  background:transparent; color:var(--mm-muted); font-size:0.84em; cursor:pointer; transition:all 0.13s;
}
.mm-opt-list .seg3-btn:last-child { border-right:none; }
.mm-opt-list .seg3-btn:hover { color:var(--mm-text); }
.mm-opt-list .seg3-btn.active { background:var(--mm-accent); color:#fff; font-weight:600; }
.mm-opt-list .seg3-lbl { font-size:0.92em; }
/* Description sous les menus (disposition, orientation) : petit, gris clair, italique */
.mm-hint { font-size:0.74em; font-style:italic; color:#c8c8c8; margin-top:7px; line-height:1.4; }
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
/* Photo de la bouteille — bandeau en haut de la fiche */
.mm-detail-photo {
  margin:0 auto 18px; max-width:200px; border-radius:14px; overflow:hidden;
  background:linear-gradient(180deg,#241b16,#15100d);
  box-shadow:0 6px 22px rgba(0,0,0,0.55); border:1px solid #2E2620;
}
.mm-detail-photo img { display:block; width:100%; max-height:340px; object-fit:contain; }
/* Étiquette générée sur la fiche (grand format) */
.mm-detail-label { max-width:165px; margin:0 auto 16px; font-size:11px; }
/* Bloc photo dans le formulaire */
.mm-photo-box { display:flex; gap:12px; align-items:center; margin-bottom:8px; }
.mm-photo-thumb {
  width:64px; height:64px; flex-shrink:0; border-radius:10px; overflow:hidden;
  background:var(--mm-bg2); border:1px solid var(--mm-border);
  display:flex; align-items:center; justify-content:center;
}
.mm-photo-thumb img { width:100%; height:100%; object-fit:cover; }
.mm-photo-thumb.empty { border-style:dashed; }
.mm-photo-ph { font-size:0.62em; color:var(--mm-muted); text-align:center; padding:4px; }
.mm-photo-actions { display:flex; flex-wrap:wrap; gap:6px; }
.mm-photo-btn {
  padding:8px 12px; border-radius:8px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-text); font-size:0.82em; cursor:pointer;
  white-space:nowrap; transition:border-color 0.13s;
}
.mm-photo-btn:hover { border-color:var(--mm-accent); }
.mm-photo-btn-rm { color:#E06B6B; }
/* Choix appareil photo / galerie pour le scan d'étiquette (mobile) */
.mm-scan-choice { display:flex; gap:8px; margin:8px 0 4px; }
.mm-scan-btn {
  flex:1; padding:10px 8px; border-radius:9px; border:1px solid var(--mm-border);
  background:var(--mm-bg2); color:var(--mm-text); font-size:0.84em; font-weight:600;
  cursor:pointer; transition:border-color 0.13s;
}
.mm-scan-btn:hover { border-color:var(--mm-accent); }
.mm-photo-url { margin-top:4px; font-size:0.84em; }
.mm-photo-hint { font-size:0.72em; color:var(--mm-muted); margin-top:5px; line-height:1.35; }
.hidden { display:none !important; }
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
