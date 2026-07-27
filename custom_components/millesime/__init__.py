"""Millésime v7.1.6 — Cave à Vin pour Home Assistant.

Modèles Gemini  : découverts dynamiquement au démarrage (GET /models sur la clé
                  de l'utilisateur), avec repli sur les modèles stables 2.5 flash.
                  Évite les 404 quand un nom « de pointe » n'existe pas sur la clé.
Sans clé        : Open Food Facts (illimité)

Modèle de données : cellars[] (multi-caves) + wines[] + slots[] + racks[].
Le journal de dégustation (tasting_log) est global ; l'historique de valeur
(value_history) et les capteurs T°/hygro sont propres à chaque cave.
Fonctions issues d'une contribution communautaire (fork v5.5.1) fusionnées.
"""
from __future__ import annotations

import asyncio
import base64
import csv
import json
import logging
import os
import re
import time
import unicodedata
import uuid
from datetime import datetime

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

DOMAIN    = "millesime"
PLATFORMS = ["sensor"]
DATA_FILE = "millesime_data.json"
VERSION   = "7.1.6"

OFF_UA       = f"Millesime-HA/{VERSION} (github.com/Redsklns/ha-millesime)"
# Deux modèles séparés = deux pools de quota indépendants (free tier)
# Texte  : gemini-3.1-flash-lite — léger, rapide (tier gratuit)
# Photo  : gemini-3-flash        — meilleur en vision (tier gratuit)
# Repli automatique sur la génération 2.5 si le modèle 3 est indisponible (404).
# ── Modèles Gemini : découverte dynamique (v7.1.3) ───────────────────────────
# PROBLÈME résolu : coder en dur des noms « de pointe » (gemini-3-flash…) casse
# le scan avec un 404 chez les comptes qui n'y ont pas accès. SOLUTION : au
# démarrage on interroge l'API pour la liste RÉELLE des modèles de la clé, et on
# choisit automatiquement les meilleurs. Ces constantes ne sont plus que le
# REPLI si la découverte échoue — volontairement des modèles STABLES et
# largement disponibles (2.5), pas des noms fragiles.
GEMINI_TEXT_MODEL      = "gemini-2.5-flash"       # repli texte (stable, dispo free tier)
GEMINI_VISION_MODEL    = "gemini-2.5-flash"       # repli vision (stable, multimodal)
GEMINI_TEXT_FALLBACK   = "gemini-2.5-flash-lite"  # repli léger
GEMINI_VISION_FALLBACK = "gemini-2.5-flash-lite"
GEMINI_BASE_URL    = "https://generativelanguage.googleapis.com/v1beta/models/"
# Alias pour compatibilité
GEMINI_MODEL = GEMINI_TEXT_MODEL

# Ordre de PRÉFÉRENCE (du meilleur au plus léger) : à la découverte, on retient
# le 1er modèle réellement disponible correspondant à chaque catégorie. On liste
# plusieurs générations pour survivre aux évolutions de nommage de Google —
# celles qui n'existent pas sont simplement ignorées.
_PREF_TEXT = [
    "gemini-3.5-flash", "gemini-3.1-flash", "gemini-3-flash",
    "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite",
]
_PREF_VISION = [   # modèles multimodaux (lecture d'étiquette)
    "gemini-3.5-flash", "gemini-3.1-flash", "gemini-3-flash",
    "gemini-2.5-flash", "gemini-2.5-flash-lite",
]
# Résultat de la découverte, rempli au démarrage (None = pas encore fait)
# Chaîne unique de résolution utilisée par tous les appels.
_GEMINI_MODELS: dict = {"text": None, "vision": None, "discovered": False}


async def _discover_gemini_models(hass: HomeAssistant, api_key: str) -> None:
    """Interroge GET /models pour la clé donnée et sélectionne les meilleurs
    modèles texte et vision RÉELLEMENT disponibles. Silencieux et non bloquant :
    en cas d'échec, les listes de repli stables (2.5) restent en vigueur."""
    if not api_key:
        return
    session = async_get_clientsession(hass)
    try:
        async with session.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key, "pageSize": "200"},
            timeout=15,
        ) as resp:
            if resp.status != 200:
                _LOGGER.warning("Millésime — découverte modèles Gemini : HTTP %s, repli sur modèles stables", resp.status)
                return
            data = await resp.json(content_type=None)
    except Exception as exc:
        _LOGGER.warning("Millésime — découverte modèles Gemini impossible (%s), repli stable", exc)
        return

    # Modèles supportant generateContent (on ignore embeddings, imagen, veo…)
    available: set[str] = set()
    for m in data.get("models", []):
        name = (m.get("name") or "").split("/")[-1]
        methods = m.get("supportedGenerationMethods") or m.get("supportedActions") or []
        if name and (not methods or "generateContent" in methods):
            available.add(name)
    if not available:
        _LOGGER.warning("Millésime — découverte modèles : liste vide, repli stable")
        return

    def _pick(prefs: list[str], fallback: str) -> list[str]:
        # Modèles préférés réellement présents, dans l'ordre ; + repli garanti
        chosen = [m for m in prefs if m in available]
        if fallback in available and fallback not in chosen:
            chosen.append(fallback)
        # Filet ultime : au moins un flash 2.5 quelconque présent
        if not chosen:
            chosen = [m for m in sorted(available) if "flash" in m][:2] or sorted(available)[:1]
        return chosen

    _GEMINI_MODELS["text"] = _pick(_PREF_TEXT, GEMINI_TEXT_FALLBACK)
    _GEMINI_MODELS["vision"] = _pick(_PREF_VISION, GEMINI_VISION_FALLBACK)
    _GEMINI_MODELS["discovered"] = True
    _LOGGER.info(
        "Millésime — modèles Gemini découverts : texte=%s | vision=%s",
        _GEMINI_MODELS["text"], _GEMINI_MODELS["vision"],
    )


def _thinking_cfg(model: str) -> dict:
    """Réglage du « raisonnement » (thinking) selon la famille de modèle (v7.1.5).

    POURQUOI C'EST CRITIQUE : depuis la v7.1.3, le modèle par défaut est
    gemini-2.5-flash, dont le thinking DYNAMIQUE est actif par défaut. Or les
    tokens de réflexion sont décomptés de maxOutputTokens ET rallongent
    fortement la réponse : nos appels (estimation de prix à 32 tokens, sommelier
    à 512-1536) se retrouvaient tronqués ou en timeout → « IA indisponible ».
    Millésime n'a besoin d'aucun raisonnement long : ce sont des extractions
    structurées courtes. On désactive donc le thinking partout où c'est permis.

    - gemini-2.5-*  : thinkingBudget = 0 → thinking désactivé (documenté)
    - gemini-3*     : thinkingLevel = "low" (la famille 3 ne permet pas l'arrêt
                      complet, on demande le niveau minimal)
    - autre/inconnu : rien (on n'envoie jamais un champ non supporté)
    """
    m = (model or "").lower()
    if "2.5" in m:
        return {"thinkingConfig": {"thinkingBudget": 0}}
    if m.startswith("gemini-3"):
        return {"thinkingConfig": {"thinkingLevel": "low"}}
    return {}


def _gen_cfg(model: str, base: dict) -> dict:
    """generationConfig complet pour un modèle donné (base + réglage thinking)."""
    return {**base, **_thinking_cfg(model)}


def _text_models() -> list[str]:
    """Chaîne de modèles texte à essayer (découverte si dispo, sinon repli stable)."""
    return _GEMINI_MODELS["text"] or [GEMINI_TEXT_MODEL, GEMINI_TEXT_FALLBACK]


def _vision_models() -> list[str]:
    """Chaîne de modèles vision à essayer (découverte si dispo, sinon repli stable)."""
    return _GEMINI_MODELS["vision"] or [GEMINI_VISION_MODEL, GEMINI_VISION_FALLBACK]

# ── Cache ─────────────────────────────────────────────────────────────────────
# Clé texte : évite de refrapper Gemini sur chaque frappe clavier
# Clé photo : une image = une requête, pas de cache utile
_SEARCH_CACHE: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 300  # 5 minutes

# ── Codes d'erreur retournés au frontend ─────────────────────────────────────
# Le frontend affiche un message adapté à chaque code.
ERR_QUOTA_EXCEEDED = "quota_exceeded"   # HTTP 429
ERR_INVALID_KEY    = "invalid_key"      # HTTP 400/401/403
ERR_UNAVAILABLE    = "service_unavailable"  # HTTP 5xx
ERR_PARSE_ERROR    = "parse_error"      # JSON invalide dans la réponse
# v7.1.5 : « service_unavailable » masquait trois pannes très différentes
# (aucun modèle utilisable, délai dépassé, panne serveur) — impossible à
# diagnostiquer pour l'utilisateur comme pour le support. On les sépare.
ERR_NO_MODEL       = "no_model"         # tous les modèles ont répondu 404
ERR_TIMEOUT        = "timeout"          # délai dépassé sur tous les modèles
ERR_TRUNCATED      = "truncated"        # réponse coupée (budget de sortie atteint)

DEFAULT_DATA: dict = {
    "cellars": [{"id": "main", "name": "Millésime", "racks": []}],
    "wines": [],
    "tasting_log": [],
}


# ── Stockage JSON ─────────────────────────────────────────────────────────────

def _path(hass: HomeAssistant) -> str:
    return hass.config.path(DATA_FILE)


def _migrate(data: dict) -> dict:
    """Migre l'ancien format bottles[] vers wines[]+slots[]."""
    if "bottles" not in data or "wines" in data:
        return data
    seen: dict = {}  # (name, vintage, type) -> index dans wines
    wines: list = []
    for b in data.get("bottles", []):
        key = (b.get("name", ""), b.get("vintage", ""), b.get("type", "red"))
        # L'ancien format bottles[] utilisait la clé floor_id
        sl  = {"rack_id": b.get("floor_id", b.get("rack_id", "")), "slot": b.get("slot", 0)}
        if key in seen:
            wines[seen[key]]["slots"].append(sl)
        else:
            seen[key] = len(wines)
            wines.append({
                "id":           b.get("id", _uid()),
                "name":         b.get("name", ""),
                "vintage":      b.get("vintage", ""),
                "type":         b.get("type", "red"),
                "producer":     b.get("producer", ""),
                "appellation":  b.get("appellation", ""),
                "region":       b.get("region", ""),
                "country":      b.get("country", ""),
                "price":        float(b.get("price", 0)),
                "drink_from":   b.get("drink_from", ""),
                "drink_until":  b.get("drink_until", ""),
                "notes":        b.get("notes", ""),
                "tasting_notes":b.get("tasting_notes", ""),
                "food_pairing": b.get("food_pairing", ""),
                "vivino_rating":float(b.get("vivino_rating", 0)),
                "image_url":    b.get("image_url", ""),
                "vivino_url":   b.get("vivino_url", ""),
                "event":        b.get("event", ""),
                "added_date":   b.get("added_date", datetime.now().strftime("%Y-%m-%d")),
                "slots":        [sl],
            })
    data["wines"] = wines
    del data["bottles"]
    _LOGGER.info("Millésime — migration bottles→wines : %d références", len(wines))
    return data


def _migrate_cellars(data: dict) -> bool:
    """Migre le format mono-cave (cellar: {...}) vers le multi-caves (cellars: [...]).

    - L'ancienne cave devient cellars[0] (id « main » conservé pour les capteurs).
    - Le journal de dégustation, global par nature, remonte à la racine.
    Retourne True si les données ont été modifiées."""
    changed = False
    if "cellars" not in data:
        old = data.pop("cellar", None) or {}
        old.setdefault("id", "main")
        old.setdefault("name", "Millésime")
        old.setdefault("racks", [])
        data["cellars"] = [old]
        changed = True
        _LOGGER.info("Millésime — migration mono-cave → multi-caves effectuée")
    for c in data["cellars"]:
        if "id" not in c:
            c["id"] = _uid()
            changed = True
        c.setdefault("name", "Cave")
        c.setdefault("racks", [])
    # Journal de dégustation : global (les dégustations ne dépendent pas d'une cave)
    if "tasting_log" not in data:
        log: list = []
        for c in data["cellars"]:
            log.extend(c.pop("tasting_log", []))
        data["tasting_log"] = sorted(log, key=lambda t: t.get("drunk_date", ""))[-1000:]
        changed = True
    return changed


def _migrate_racks(data: dict) -> bool:
    """Migre la nomenclature héritée floors/rows/floor_id vers racks/shelves/rack_id.

    Retourne True si les données ont été modifiées."""
    changed = False
    for cellar in data.get("cellars", []):
        if "floors" in cellar:
            cellar["racks"] = cellar.pop("floors")
            changed = True
        for r in cellar.get("racks", []):
            if "rows" in r:
                r["shelves"] = r.pop("rows")
                changed = True
    for w in data.get("wines", []):
        for s in w.get("slots", []):
            if "floor_id" in s:
                s["rack_id"] = s.pop("floor_id")
                changed = True
    if changed:
        _LOGGER.info("Millésime — migration nomenclature floors→racks effectuée")
    return changed


def _load(hass: HomeAssistant) -> dict:
    try:
        p = _path(hass)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            changed = False
            if "bottles" in data:
                data = _migrate(data)
                changed = True
            if _migrate_cellars(data):
                changed = True
            if _migrate_racks(data):
                changed = True
            if changed:
                _save(hass, data)
            return data
    except Exception as exc:
        _LOGGER.error("Millésime — erreur lecture : %s", exc)
    return json.loads(json.dumps(DEFAULT_DATA))


def _save(hass: HomeAssistant, data: dict) -> None:
    try:
        with open(_path(hass), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        _LOGGER.error("Millésime — erreur sauvegarde : %s", exc)


def _uid() -> str:
    return str(uuid.uuid4())[:8]


# ── Helpers multi-caves ───────────────────────────────────────────────────────

def _cellars(d: dict) -> list[dict]:
    """Liste des caves ; garantit qu'il en existe toujours au moins une."""
    cs = d.setdefault("cellars", [])
    if not cs:
        cs.append({"id": "main", "name": "Millésime", "racks": []})
    return cs


def _cellar(d: dict, cellar_id: str | None = None) -> dict:
    """Cave d'identifiant donné, ou la première cave à défaut."""
    cs = _cellars(d)
    if cellar_id:
        for c in cs:
            if c.get("id") == cellar_id:
                return c
    return cs[0]


def _all_racks(d: dict) -> list[dict]:
    """Tous les casiers, toutes caves confondues (les rack_id restent uniques)."""
    return [r for c in _cellars(d) for r in c.get("racks", [])]


def _rack_capacity(rk: dict) -> int:
    """Capacité d'un casier : colonnes × étagères × niveaux (superposition)."""
    levels = max(1, min(4, int(rk.get("levels", 1) or 1)))
    return rk.get("columns", 8) * rk.get("shelves", 2) * levels


def _slot_taken(d: dict, rack_id: str, slot: int,
                exclude_wine_id: str | None = None,
                exclude_slot_idx: int | None = None) -> bool:
    """Retourne True si l'emplacement est déjà occupé dans ce casier."""
    for w in d.get("wines", []):
        for i, s in enumerate(w.get("slots", [])):
            if s["rack_id"] == rack_id and s["slot"] == slot:
                if w["id"] == exclude_wine_id and exclude_slot_idx is not None and i == exclude_slot_idx:
                    continue
                return True
    return False


def _call_rack_id(call: "ServiceCall", default: str = "") -> str:
    """rack_id depuis l'appel de service ; floor_id accepté en alias déprécié."""
    v = call.data.get("rack_id", call.data.get("floor_id"))
    return default if v is None else v


def _mk_slot(rack_id: str, slot: int, comment=None, size=None) -> dict:
    """Construit un emplacement ; commentaire et format optionnels, propres à la bouteille."""
    s = {"rack_id": rack_id, "slot": slot}
    if comment:
        s["comment"] = str(comment)
    if size:
        s["size"] = str(size)
    return s


# ── Import Vinotag (fichier millesime_import.csv) ─────────────────────────────

VINOTAG_TYPES = {
    "wine_red": "red", "wine_white": "white", "wine_rose": "rose",
    "wine_white_sweet": "dessert", "wine_red_sweet": "dessert",
    "wine_sparkling": "sparkling", "champagne": "sparkling",
}
VINOTAG_COUNTRIES = {
    "fr": "France", "it": "Italie", "es": "Espagne", "pt": "Portugal",
    "de": "Allemagne", "ch": "Suisse", "us": "États-Unis", "ar": "Argentine",
    "cl": "Chili", "au": "Australie", "za": "Afrique du Sud", "nz": "Nouvelle-Zélande",
}
VINOTAG_REGIONS = {
    "vallee_du_rhone": "Vallée du Rhône", "sud_ouest": "Sud-Ouest",
    "val_de_loire": "Val de Loire", "bourgogne": "Bourgogne", "bordeaux": "Bordeaux",
    "provence": "Provence", "alsace": "Alsace", "champagne": "Champagne",
    "languedoc_roussillon": "Languedoc-Roussillon", "beaujolais": "Beaujolais",
    "jura": "Jura", "savoie": "Savoie", "corse": "Corse",
}
_VT_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
              "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _vt_year(value) -> str:
    """Extrait l'année d'une date Vinotag (« Mon Mar 03 2031 » → « 2031 »)."""
    m = re.findall(r"\d{4}", str(value or ""))
    return m[-1] if m else ""


def _vt_date(value) -> str:
    """« Fri Jan 12 2024 » → « 2024-01-12 » (sans dépendre de la locale)."""
    m = re.match(r"^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})$", str(value or "").strip())
    if not m:
        return ""
    mo = _VT_MONTHS.get(m.group(1).lower())
    return f"{m.group(3)}-{mo:02d}-{int(m.group(2)):02d}" if mo else ""


def _vt_num(*values) -> float:
    """Premier nombre valable parmi les valeurs (virgule décimale acceptée)."""
    for v in values:
        try:
            f = float(str(v).replace(",", ".").strip())
            if f > 0:
                return f
        except (TypeError, ValueError):
            continue
    return 0.0


def _normalize(text: str) -> str:
    t = "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )
    t = re.sub(r"\b(19|20)\d{2}\b", "", t)
    return re.sub(r"\s+", " ", t).strip()


# ── Prompt Gemini (partagé texte + photo) ────────────────────────────────────

_GEMINI_SYSTEM = """\
Tu es un expert mondial en vins et sommelière.
Retourne UNIQUEMENT un tableau JSON valide [], sans markdown ni backticks.
Chaque objet doit avoir exactement ces champs (string, jamais null) :
  name, vintage, type, shape, appellation, region, country, producer,
  tasting_notes, food_pairing, drink_from, drink_until, vivino_rating, price,
  aroma_profile, structure_profile
Règles :
- type : "red" | "white" | "rose" | "sparkling" | "dessert" uniquement
- shape : forme de la bouteille, "bordeaux" | "bourgogne" | "champagne" | "flute" | "rose" | "loire" | "" (vide si incertain). Bordeaux=épaules marquées ; bourgogne=épaules tombantes ; champagne=épaisse à base large ; flute=fine et haute (Alsace) ; rose=type Provence ; loire=ligérienne
- vintage / drink_from / drink_until : "YYYY" ou ""
- drink_from / drink_until : fenêtre d'apogée RESSERRÉE et réaliste, calculée depuis
  le millésime selon le potentiel de garde réel (appellation, classement, millésime).
  Largeur typique 3 à 6 ans (vins courants), 6 à 10 ans (grands vins de garde),
  1 à 3 ans (primeurs, rosés, blancs vifs). JAMAIS plus de 12 ans d'écart.
  Exemples : Beaujolais 2023 → 2024-2026 ; Chablis 1er cru 2020 → 2023-2028 ;
  Margaux grand cru 2015 → 2025-2035. Éviter les fenêtres vagues type 2025-2045.
- vivino_rating : décimal 0.0–5.0 (0 si inconnu)
- price : prix moyen constaté en euros, UNIQUEMENT le nombre décimal (ex: 18.5). 0.0 si inconnu. Jamais de texte.
- tasting_notes : 1–2 phrases en français (arômes, texture, finale)
- food_pairing : 2–3 accords en français séparés par des virgules
- aroma_profile : répartition aromatique du vin sur EXACTEMENT ces 11 séries
  aromatiques œnologiques (dans cet ordre, séparées par |, total = 100, familles à 0 omises) :
  Fruité, Floral, Végétal, Minéral, Épicé, Boisé, Empyreumatique, Animal, Fermentaire, Sous-bois, Évolution.
  Format STRICT "Famille:NN" — exemple : "Fruité:45|Boisé:20|Épicé:15|Minéral:10|Évolution:10".
  Estimation typique du profil au stade actuel du vin ; "" si vraiment inconnu.
- structure_profile : profil de STRUCTURE en bouche sur EXACTEMENT ces 6 axes
  de dégustation, chacun noté de 0 à 100 indépendamment (PAS un total de 100),
  séparés par |, dans cet ordre : Tanins, Corps, Acidité, Gras, Alcool, Persistance.
  Format STRICT "Axe:NN" — exemple : "Tanins:70|Corps:65|Acidité:48|Gras:40|Alcool:60|Persistance:55".
  Tanins ≤ 15 pour les blancs/effervescents. Estimation au stade actuel ; "" si inconnu.
- Couvrir différents millésimes si possible
- Priorité : vins français > européens > mondiaux\
"""


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", ".")) if value else default
    except (ValueError, TypeError):
        return default


def _gemini_text(data: dict) -> tuple[str, str]:
    """Texte utile d'une réponse Gemini + finishReason (v7.1.6).

    POURQUOI : le code lisait `parts[0].text`, ce qui est faux dès que le modèle
    raisonne. L'API peut placer en première position une partie de RÉFLEXION
    (marquée `thought: true`) ou une partie au texte VIDE portant la signature
    de raisonnement — on récupérait alors une chaîne vide et tout finissait en
    « parse_error ». On parcourt donc TOUTES les parties, on écarte celles de
    réflexion, et on concatène le reste.
    """
    cand = (data.get("candidates") or [{}])[0] or {}
    finish = cand.get("finishReason") or ""
    parts = (cand.get("content") or {}).get("parts") or []
    chunks = []
    for p in parts:
        if not isinstance(p, dict) or p.get("thought"):
            continue                       # partie de raisonnement → jamais la réponse
        t = p.get("text")
        if isinstance(t, str) and t.strip():
            chunks.append(t)
    return "".join(chunks), finish


def _gemini_payload(data: dict):
    """JSON d'une réponse Gemini, tolérant aux enrobages (v7.1.6).

    Gère les cas réels observés : blocs ```json, préfixe « THOUGHT: » laissé
    dans le texte par certains modèles, et texte parasite avant/après l'objet.
    Lève ValueError avec un motif exploitable dans les logs.
    """
    raw, finish = _gemini_text(data)
    if not raw.strip():
        raise ValueError(f"réponse vide (finishReason={finish or '?'})")
    txt = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    txt = re.sub(r"\s*```$", "", txt).strip()
    if "THOUGHT:" in txt:                  # raisonnement laissé en clair
        txt = txt.split("THOUGHT:")[-1].strip()
    try:
        return json.loads(txt)
    except Exception:
        pass
    # Dernier recours : isoler le plus grand bloc { … } ou [ … ]
    for op, cl in (("{", "}"), ("[", "]")):
        i, j = txt.find(op), txt.rfind(cl)
        if i != -1 and j > i:
            try:
                return json.loads(txt[i:j + 1])
            except Exception:
                continue
    raise ValueError(f"JSON introuvable (finishReason={finish or '?'}, {len(raw)} car.)")


def _parse_gemini_response(raw: str, source: str) -> tuple[list[dict], str | None]:
    """Parse la réponse JSON de Gemini.

    Retourne (résultats, code_erreur_ou_None).
    """
    if not raw:
        return [], ERR_PARSE_ERROR

    # Nettoyer les backticks résiduels
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        _LOGGER.warning("Gemini — JSON invalide (%s) : %.200s", source, raw)
        return [], ERR_PARSE_ERROR

    if not isinstance(parsed, list):
        parsed = [parsed]

    results = []
    valid_types = {"red", "white", "rose", "sparkling", "dessert"}
    for w in parsed:
        if not isinstance(w, dict) or not str(w.get("name", "")).strip():
            continue
        results.append({
            "name":          str(w.get("name", "")).strip(),
            "vintage":       str(w.get("vintage", "") or ""),
            "type":          w.get("type") if w.get("type") in valid_types else "red",
            "shape":         (w.get("shape") if w.get("shape") in ("bordeaux","bourgogne","champagne","flute","rose","loire") else ""),
            "appellation":   str(w.get("appellation", "") or ""),
            "region":        str(w.get("region", "") or ""),
            "country":       str(w.get("country", "") or ""),
            "producer":      str(w.get("producer", "") or ""),
            "tasting_notes": str(w.get("tasting_notes", "") or ""),
            "food_pairing":  str(w.get("food_pairing", "") or ""),
            "drink_from":    str(w.get("drink_from", "") or ""),
            "drink_until":   str(w.get("drink_until", "") or ""),
            "aroma_profile": str(w.get("aroma_profile", "") or ""),
            "structure_profile": str(w.get("structure_profile", "") or ""),
            "vivino_rating": round(_safe_float(w.get("vivino_rating")), 1),
            "price":         round(_safe_float(w.get("price")), 2),
            "image_url":     "",
            "vivino_url":    "",
        })
    return results, None


def _bump_ai_usage(hass: HomeAssistant, api_data: dict | None) -> dict:
    """Cumule la consommation de tokens Gemini du jour (usageMetadata) dans le
    fichier de données, SANS émettre d'événement (pas de re-rendu de la carte).
    Remise à zéro automatique au changement de date. Retourne le cumul du jour
    et l'usage de l'appel courant, pour affichage dans la fenêtre de progression."""
    meta = (api_data or {}).get("usageMetadata", {}) or {}
    call_usage = {
        "prompt": int(meta.get("promptTokenCount", 0) or 0),
        "output": int(meta.get("candidatesTokenCount", 0) or 0),
    }
    today = datetime.now().strftime("%Y-%m-%d")
    day = {"date": today, "prompt": 0, "output": 0, "calls": 0}
    try:
        for v in (hass.data.get(DOMAIN) or {}).values():
            if isinstance(v, dict) and "data" in v:
                d = v["data"]
                au = d.setdefault("ai_usage", {})
                if au.get("date") != today:
                    au.clear()
                    au.update({"date": today, "prompt": 0, "output": 0, "calls": 0})
                au["prompt"] += call_usage["prompt"]
                au["output"] += call_usage["output"]
                au["calls"]  += 1
                day = dict(au)
                # Persistance silencieuse (fréquence faible : appels manuels)
                hass.async_create_task(hass.async_add_executor_job(_save, hass, d))
                break
    except Exception as exc:  # le compteur ne doit jamais casser un appel IA
        _LOGGER.debug("Millésime — compteur tokens: %s", exc)
    return {"call": call_usage, "day": day}


def _gemini_error_code(status: int) -> str:
    """Convertit un code HTTP Gemini en code d'erreur Millésime."""
    if status == 429:
        return ERR_QUOTA_EXCEEDED
    if status in (400, 401, 403):
        return ERR_INVALID_KEY
    return ERR_UNAVAILABLE


async def _gemini_call(
    hass: HomeAssistant, api_key: str, models: list[str], body_base: dict,
    gen_cfg: dict, timeout: int, label: str, session=None,
) -> tuple[dict | None, str | None]:
    """Appel Gemini UNIFIÉ pour toutes les fonctions IA (v7.1.5).

    Auparavant, chaque fonction dupliquait sa propre boucle de repli, avec des
    comportements divergents et un « service_unavailable » fourre-tout. Cette
    fonction centralise :
      • le réglage du thinking adapté au modèle (voir _thinking_cfg) ;
      • le repli de modèle en modèle sur 404 (modèle absent) et sur 5xx ;
      • le réessai SANS thinking si un modèle refuse ce réglage (HTTP 400) —
        sans quoi l'utilisateur verrait à tort « clé invalide » ;
      • l'arrêt immédiat sur 429 / clé invalide (insister est inutile) ;
      • un code d'erreur PRÉCIS : no_model, timeout, quota, clé, ou 5xx.

    Ne comptabilise PAS les tokens : chaque appelant garde son _bump_ai_usage
    (certains ont besoin de la valeur retournée).
    Retourne (data_json | None, code_erreur | None).
    """
    session = session or async_get_clientsession(hass)
    saw_404 = saw_timeout = saw_other = False

    for model in models:
        # tentative 0 = avec le réglage thinking ; tentative 1 = sans (si 400)
        for attempt in (0, 1):
            cfg = _gen_cfg(model, gen_cfg) if attempt == 0 else dict(gen_cfg)
            body = {**body_base, "generationConfig": cfg}
            try:
                async with session.post(
                    f"{GEMINI_BASE_URL}{model}:generateContent",
                    params={"key": api_key},
                    json=body,
                    headers={"Content-Type": "application/json"},
                    timeout=timeout,
                ) as resp:
                    status = resp.status
                    if status == 200:
                        data = await resp.json(content_type=None)
                        _LOGGER.debug("%s : réponse de %s", label, model)
                        return data, None
                    if status == 400 and attempt == 0 and _thinking_cfg(model):
                        # Ce modèle n'accepte peut-être pas le réglage thinking :
                        # on retente une fois sans, avant de conclure à une erreur.
                        _LOGGER.debug("%s : 400 avec thinkingConfig (%s), réessai sans", label, model)
                        continue
                    if status == 404:
                        saw_404 = True
                        _LOGGER.warning("%s : modèle %s indisponible (404), repli", label, model)
                        break                      # → modèle suivant
                    if status in (429, 400, 401, 403):
                        saw_other = True
                        _LOGGER.warning("%s : HTTP %s sur %s", label, status, model)
                        return None, _gemini_error_code(status)
                    saw_other = True               # 5xx : panne passagère
                    _LOGGER.warning("%s : HTTP %s sur %s, repli", label, status, model)
                    break                          # → modèle suivant
            except asyncio.TimeoutError:
                saw_timeout = True
                _LOGGER.warning("%s : délai dépassé (%s, %ss)", label, model, timeout)
                break
            except Exception as exc:
                saw_other = True
                _LOGGER.warning("%s : erreur (%s) %s", label, model, exc)
                break

    if saw_404 and not saw_other and not saw_timeout:
        _LOGGER.error(
            "%s : AUCUN modèle utilisable (%s). Vérifiez l'accès de votre clé "
            "Gemini aux modèles sur aistudio.google.com.", label, ", ".join(models))
        # Auto-récupération : si la découverte n'a jamais abouti (coupure réseau
        # au démarrage, clé ajoutée depuis…), on la relance en tâche de fond.
        # Le prochain essai de l'utilisateur utilisera alors les VRAIS modèles
        # de sa clé au lieu du repli codé en dur.
        if not _GEMINI_MODELS["discovered"] and api_key:
            _LOGGER.info("%s : redécouverte des modèles Gemini programmée", label)
            hass.async_create_task(_discover_gemini_models(hass, api_key))
        return None, ERR_NO_MODEL
    if saw_timeout and not saw_other:
        return None, ERR_TIMEOUT
    return None, ERR_UNAVAILABLE


# ── Recherche Gemini par texte ────────────────────────────────────────────────

async def _gemini_search_text(
    hass: HomeAssistant, query: str, api_key: str
) -> tuple[list[dict], str | None]:
    """Recherche Gemini via texte.

    Retourne (résultats, code_erreur_ou_None).
    """
    body_base = {
        "system_instruction": {"parts": [{"text": _GEMINI_SYSTEM}]},
        "contents": [{"parts": [{"text": (
            f'Recherche de vin : "{query}"\n'
            f"Retourne jusqu'à 6 vins correspondants."
        )}]}],
    }
    # v7.1.5 : appel unifié (thinking désactivé, repli de modèle, erreurs précises).
    # Délai porté à 30 s : la marge de 15 s était trop juste dès que le modèle
    # prenait le temps de répondre, d'où de faux « service indisponible ».
    data, code = await _gemini_call(
        hass, api_key, _text_models(), body_base,
        {"temperature": 0.2, "maxOutputTokens": 2048, "responseMimeType": "application/json"},
        30, f"Gemini texte '{query}'",
    )
    if data is None:
        return [], code or ERR_UNAVAILABLE
    _bump_ai_usage(hass, data)
    try:
        raw, _finish = _gemini_text(data)          # v7.1.6 : toutes les parties
        results, err = _parse_gemini_response(raw, f"texte:'{query}'")
        _LOGGER.info("Gemini texte: %d résultat(s) pour '%s'", len(results), query)
        return results, err

    except asyncio.TimeoutError:
        _LOGGER.warning("Gemini texte timeout pour '%s'", query)
        return [], ERR_UNAVAILABLE
    except Exception as exc:
        _LOGGER.warning("Gemini texte erreur pour '%s': %s", query, exc)
        return [], ERR_UNAVAILABLE


# ── Sommelier IA : helper générique + accord menu, audit, opportunité (v7.0.0),
#    « Envie de… » (v7.0.1) ──────────────────────────────────────────────────
# Concepts inspirés du projet ha-cellier-ia d'aldoushx (prompts réécrits) ;
# aucune consultation de site externe : connaissance du modèle uniquement,
# les prix sont donc INDICATIFS et présentés comme tels côté carte.

async def _gemini_json(
    hass: HomeAssistant, api_key: str, system: str, user_text: str,
    *, temperature: float = 0.3, max_tokens: int = 2048, timeout: int = 40,
) -> tuple[dict | None, dict, str | None]:
    """Appel Gemini générique en JSON strict, avec repli de modèle 3 → 2.5 et
    comptage de tokens. Retourne (objet_json | None, usage, code_erreur | None)."""
    body_base = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"parts": [{"text": user_text}]}],
    }
    # v7.1.5 : appel unifié. Le thinking est désactivé — il était décompté de
    # maxOutputTokens (512 à 1536 ici), ce qui tronquait les réponses sommelier.
    data, code = await _gemini_call(
        hass, api_key, _text_models(), body_base,
        {"temperature": temperature, "maxOutputTokens": max_tokens,
         "responseMimeType": "application/json"},
        timeout, "Gemini sommelier",
    )
    if data is None:
        return None, {}, code or ERR_UNAVAILABLE
    usage = _bump_ai_usage(hass, data)
    try:
        return _gemini_payload(data), usage, None   # v7.1.6 : lecture robuste
    except Exception as exc:
        _, finish = _gemini_text(data)
        _LOGGER.warning("Gemini sommelier : réponse illisible (%s)", exc)
        if finish == "MAX_TOKENS":
            return None, usage, ERR_TRUNCATED
        return None, usage, ERR_PARSE_ERROR


def _cellar_ai_summary(wines: list[dict]) -> list[dict]:
    """Résumé compact de la cave pour les prompts sommelier : une entrée par vin,
    uniquement les champs utiles au raisonnement (limite la taille des requêtes)."""
    out = []
    for w in wines:
        qty = len(w.get("slots", []))
        if qty <= 0:
            continue
        out.append({
            "id":          w.get("id"),
            "name":        w.get("name", ""),
            "vintage":     w.get("vintage", ""),
            "type":        w.get("type", ""),
            "appellation": w.get("appellation", ""),
            "region":      w.get("region", ""),
            "price":       w.get("price", 0),
            "qty":         qty,
            "apogee":      f"{w.get('drink_from','?')}-{w.get('drink_until','?')}",
            "aromas":      w.get("aroma_profile", ""),
            "structure":   w.get("structure_profile", ""),
        })
    return out


async def _gemini_pair_menu(
    hass: HomeAssistant, api_key: str, menu: dict, wines: list[dict]
) -> tuple[dict | None, dict, str | None]:
    """Accord sur un REPAS complet : choisit 1 à 2 bouteilles DE LA CAVE qui
    couvrent au mieux l'ensemble du menu, avec conseils de service."""
    sys = (
        "Tu es sommelier de la maison : tu composes avec la cave EXISTANTE, pour un repas complet. "
        "On te donne un menu (certains services peuvent être vides) et la liste des vins disponibles avec leur id. "
        "Choisis 1 bouteille si un vin polyvalent couvre bien l'ensemble, 2 au maximum si l'écart entre services l'exige "
        "(petit repas = éviter d'ouvrir trop de bouteilles). Privilégie, à accord équivalent, les vins DANS leur fenêtre "
        "d'apogée, surtout ceux proches de la fin de fenêtre. N'invente aucun vin : uniquement les id fournis. "
        "Réponds STRICTEMENT en JSON : "
        '{"choices":[{"id":"...","covers":"entrée + plat","reason":"une phrase"}],'
        '"service":"ordre de service, carafage et températures en 1-2 phrases",'
        '"note":"1 phrase si un service reste mal couvert, sinon \"\""}'
    )
    user = (
        f"Menu :\n- Entrée : {menu.get('starter') or '(aucune)'}\n"
        f"- Plat : {menu.get('main') or '(aucun)'}\n"
        f"- Dessert : {menu.get('dessert') or '(aucun)'}\n\n"
        f"Vins disponibles (JSON) :\n{json.dumps(_cellar_ai_summary(wines), ensure_ascii=False)}"
    )
    return await _gemini_json(hass, api_key, sys, user, temperature=0.3, max_tokens=2048)


async def _gemini_craving(
    hass: HomeAssistant, api_key: str, wants: list[str], wants_structure: list[str],
    color: str, wines: list[dict]
) -> tuple[dict | None, dict, str | None]:
    """« Envie de… » (v7.0.1, enrichie v7.1.0) : l'utilisateur veut simplement
    boire un bon vin. Il donne le profil aromatique et/ou la structure
    recherchés (+ couleur éventuelle) ; l'IA choisit UNE bouteille de la cave
    au bon profil ET à la bonne apogée."""
    sys = (
        "Tu es sommelier de la maison. L'utilisateur veut simplement boire un BON vin de sa cave, "
        "sans occasion ni plat particulier : il indique le profil aromatique recherché "
        "(séries : Fruité, Floral, Végétal, Minéral, Épicé, Boisé, Empyreumatique, Animal, Fermentaire, "
        "Sous-bois, Évolution) et/ou la structure souhaitée en bouche (tannique, souple, corsé, léger, "
        "vif, rond, puissant, long en bouche), et éventuellement une couleur. "
        "Choisis UNE SEULE bouteille parmi les vins fournis (id obligatoire, n'invente rien) : "
        "le meilleur compromis entre le profil demandé (champs aromas et structure de chaque vin) et la "
        "fenêtre d'apogée — privilégie ABSOLUMENT un vin à boire maintenant, surtout proche de la fin de sa "
        "fenêtre ; jamais un vin trop jeune si une alternative prête existe. "
        "Réponds STRICTEMENT en JSON : "
        '{"id":"...","match":"en quoi le profil correspond à l\'envie, 1 phrase",'
        '"apogee":"pourquoi c\'est le bon moment pour l\'ouvrir, 1 phrase",'
        '"serve":"température de service et carafage éventuel, 1 phrase"}'
    )
    color_lbl = {"red": "rouge", "white": "blanc", "rose": "rosé",
                 "sparkling": "effervescent", "dessert": "liquoreux"}.get(color or "", "")
    user = (
        f"Profil aromatique recherché : {', '.join(wants) or 'indifférent'}\n"
        f"Structure recherchée : {', '.join(wants_structure) or 'indifférente'}\n"
        f"Couleur souhaitée : {color_lbl or 'indifférent'}\n\n"
        f"Vins disponibles (JSON) :\n{json.dumps(_cellar_ai_summary(wines), ensure_ascii=False)}"
    )
    return await _gemini_json(hass, api_key, sys, user, temperature=0.3, max_tokens=1024)


async def _gemini_audit_cellar(
    hass: HomeAssistant, api_key: str, wines: list[dict],
    budget: float, region: str,
) -> tuple[dict | None, dict, str | None]:
    """Audit stratégique : équilibre de la cave + 5 suggestions d'achat pour
    combler les trous d'apogée et de style, sous contrainte de budget/région."""
    sys = (
        "Tu es sommelier-conseil : tu audites une cave et tu recommandes des ACHATS pour l'équilibrer. "
        "Analyse la répartition (couleurs, styles, régions) et surtout l'ÉCHELONNEMENT DES APOGÉES : "
        "repère les années sans rien à boire (trous) et les années surchargées (embouteillages). "
        "Propose exactement 5 achats précis et achetables en France, chacun comblant un manque identifié. "
        "Les prix sont des estimations de ta connaissance générale, PAS des cotations : reste prudent et arrondi. "
        "Réponds STRICTEMENT en JSON : "
        '{"balance":"bilan de la cave en 2-3 phrases (équilibre, trous d\'apogée, styles manquants)",'
        '"suggestions":[{"name":"...","appellation":"...","color":"red|white|rose|sparkling|dessert",'
        '"price":"prix indicatif €","vintages":"millésimes à viser","qty":2,"reason":"le manque comblé, 1 phrase"}]}'
    )
    user = (
        f"Budget maximum par bouteille : {budget:.0f} €\n"
        f"Région prioritaire : {region or 'toutes régions'}\n\n"
        f"Cave actuelle (JSON) :\n{json.dumps(_cellar_ai_summary(wines), ensure_ascii=False)}"
    )
    return await _gemini_json(hass, api_key, sys, user, temperature=0.4, max_tokens=2560)


async def _gemini_opportunity(
    hass: HomeAssistant, api_key: str, wine_text: str, wines: list[dict]
) -> tuple[dict | None, dict, str | None]:
    """Analyse d'opportunité en magasin : le vin repéré est-il un doublon, un
    vrai manque, un risque d'embouteillage d'apogée ? Verdict et quantité."""
    sys = (
        "Tu es sommelier-conseil : l'utilisateur est EN MAGASIN devant un vin et hésite à l'acheter. "
        "Confronte ce vin à sa cave : ressemblances de style, redondance, échelonnement des apogées "
        "(si plusieurs vins de la cave culminent les mêmes années, oriente vers un millésime décalé). "
        "Le prix indiqué est une estimation de ta connaissance générale, PAS une cotation en direct. "
        "Réponds STRICTEMENT en JSON : "
        '{"closest":"le vin de la cave le plus proche et en quoi (1 phrase, \"aucun\" si rien de proche)",'
        '"redundant":true,'
        '"verdict":"achat conseillé|achat possible|achat déconseillé",'
        '"price_hint":"prix indicatif raisonnable en €",'
        '"vintage_advice":"millésime(s) à viser compte tenu des apogées de la cave",'
        '"qty":2,'
        '"reason":"justification en 2 phrases maximum"}'
    )
    user = (
        f'Vin repéré en magasin : "{wine_text}"\n\n'
        f"Cave actuelle (JSON) :\n{json.dumps(_cellar_ai_summary(wines), ensure_ascii=False)}"
    )
    return await _gemini_json(hass, api_key, sys, user, temperature=0.3, max_tokens=1536)


# ── Lecture d'étiquette par photo ─────────────────────────────────────────────

async def _gemini_analyze_photo(
    hass: HomeAssistant, image_b64: str, mime_type: str, api_key: str
) -> tuple[list[dict], str | None]:
    """Analyse une photo d'étiquette via Gemini Vision.

    image_b64 : image encodée en base64
    mime_type : "image/jpeg" | "image/png" | "image/webp"
    Retourne (résultats, code_erreur_ou_None).
    """
    photo_prompt = (
        "Analyse cette étiquette de bouteille de vin. "
        "Identifie le vin et retourne UN objet JSON avec les informations du vin. "
        "Si l'image n'est pas une étiquette de vin, retourne []."
    )

    body = {
        "system_instruction": {"parts": [{"text": _GEMINI_SYSTEM}]},
        "contents": [{
            "parts": [
                {"text": photo_prompt},
                {"inline_data": {"mime_type": mime_type, "data": image_b64}},
            ]
        }],
    }
    # v7.1.5 : appel unifié sur les modèles VISION (thinking désactivé : il
    # consommait le budget de sortie et allongeait la lecture d'étiquette).
    # Le réessai temporisé sur panne passagère est conservé, mais on ne réessaie
    # QUE ce qui a une chance d'aboutir (5xx / délai), pas un quota ni un 404.
    gen = {"temperature": 0.1, "maxOutputTokens": 2048, "responseMimeType": "application/json"}
    data, last_code = None, ERR_UNAVAILABLE
    for attempt in range(2):
        data, last_code = await _gemini_call(
            hass, api_key, _vision_models(), body, gen, 45, "Gemini photo",
        )
        if data is not None or last_code not in (ERR_UNAVAILABLE, ERR_TIMEOUT):
            break
        if attempt == 0:
            await asyncio.sleep(3.0)

    if data is None:
        _LOGGER.warning("Gemini photo : échec sur tous les modèles (%s)", last_code)
        return [], last_code or ERR_UNAVAILABLE
    _bump_ai_usage(hass, data)

    # Parsing de la réponse (v7.1.6 : lecture de TOUTES les parties)
    raw, finish = _gemini_text(data)
    if finish == "MAX_TOKENS":
        _LOGGER.warning("Gemini photo : réponse tronquée (MAX_TOKENS)")
    # Réparation d'un tableau JSON coupé net par la limite de tokens
    raw = raw.strip()
    if raw.startswith("[") and not raw.endswith("]"):
        raw = raw.rstrip(",").rstrip() + ("}]" if not raw.endswith("}") else "]")
    try:
        results, err = _parse_gemini_response(raw, "photo")
    except Exception as exc:
        _LOGGER.warning("Gemini photo : erreur de lecture (%s)", exc)
        return [], ERR_TRUNCATED if finish == "MAX_TOKENS" else ERR_PARSE_ERROR
    _LOGGER.info("Gemini photo: %d vin(s) identifie(s)", len(results))
    return results, err


# ── Accords mets/vin par IA : Gemini choisit parmi les vins de la cave ────────

async def _gemini_pair_food(
    hass: HomeAssistant, dish: str, wines: list[dict], api_key: str
) -> tuple[list[dict], str | None]:
    """Demande à Gemini de choisir, PARMI les vins fournis, les meilleurs accords
    pour un plat donné. Retourne ([{id, reason, rank}], code_erreur_ou_None)."""
    # On envoie une liste compacte des vins de la cave (id + infos utiles)
    catalogue = []
    for w in wines:
        catalogue.append({
            "id":          w.get("id"),
            "name":        w.get("name", ""),
            "type":        w.get("type", ""),
            "vintage":     w.get("vintage", ""),
            "region":      w.get("region", ""),
            "appellation": w.get("appellation", ""),
            "food_pairing":w.get("food_pairing", ""),
        })
    sys = (
        "Tu es sommelier. On te donne un plat et une liste de vins disponibles (avec leur id). "
        "Choisis UNIQUEMENT parmi ces vins ceux qui s'accordent le mieux avec le plat. "
        "Classe-les du meilleur au moins bon (max 8). Pour chacun, donne une raison courte (une phrase). "
        "Réponds STRICTEMENT en JSON : "
        '{"results":[{"id":"...","reason":"...","rank":1}]} '
        "N'invente aucun vin : n'utilise que les id fournis. Si rien ne convient vraiment, "
        "propose quand même les moins mauvais."
    )
    body = {
        "system_instruction": {"parts": [{"text": sys}]},
        "contents": [{"parts": [{"text": (
            f'Plat : "{dish}"\n\n'
            f"Vins disponibles (JSON) :\n{json.dumps(catalogue, ensure_ascii=False)}"
        )}]}],
    }
    # v7.1.5 : appel unifié. C'est LA fonction qui échouait en « service
    # indisponible » : le thinking de gemini-2.5-flash allongeait la réponse
    # au-delà des 20 s de délai. Thinking désactivé + délai porté à 45 s
    # (l'accord sur un menu complet envoie tout le catalogue de la cave).
    data, code = await _gemini_call(
        hass, api_key, _text_models(), body,
        {"temperature": 0.3, "maxOutputTokens": 2048, "responseMimeType": "application/json"},
        45, f"Gemini accords '{dish}'",
    )
    if data is None:
        return [], code or ERR_UNAVAILABLE
    _bump_ai_usage(hass, data)
    try:
        parsed = _gemini_payload(data)              # v7.1.6 : lecture robuste
        results = parsed.get("results", []) if isinstance(parsed, dict) else []
        # garde uniquement les id réellement présents dans la cave
        valid_ids = {w.get("id") for w in wines}
        clean = [r for r in results if isinstance(r, dict) and r.get("id") in valid_ids]
        _LOGGER.info("Gemini accords : %d vin(s) pour '%s'", len(clean), dish)
        return clean, None
    except Exception as exc:
        _LOGGER.warning("Gemini accords parse erreur pour '%s': %s", dish, exc)
        return [], ERR_PARSE_ERROR



# ── Open Food Facts (fallback texte) ─────────────────────────────────────────

_WINE_TYPE_MAP: dict[str, str] = {
    "en:red-wines": "red",       "fr:vins-rouges": "red",
    "en:white-wines": "white",   "fr:vins-blancs": "white",
    "en:rose-wines": "rose",     "fr:vins-roses": "rose",
    "en:sparkling-wines": "sparkling", "en:champagnes": "sparkling",
    "fr:champagnes": "sparkling",      "fr:cremants": "sparkling",
    "en:dessert-wines": "dessert",     "fr:vins-liquoreux": "dessert",
}
_APPELLATION_MAP: dict[str, str] = {
    "bordeaux": "Bordeaux",       "bourgogne": "Bourgogne",
    "burgundy": "Bourgogne",      "champagne": "Champagne",
    "alsace": "Alsace",           "loire": "Vallée de la Loire",
    "rhone": "Vallée du Rhône",   "cotes-du-rhone": "Côtes du Rhône",
    "provence": "Provence",       "languedoc": "Languedoc",
    "beaujolais": "Beaujolais",   "saint-emilion": "Saint-Émilion",
    "pomerol": "Pomerol",         "medoc": "Médoc",
    "pauillac": "Pauillac",       "sauternes": "Sauternes",
    "chablis": "Chablis",         "roussillon": "Roussillon",
    "minervois": "Minervois",     "corbieres": "Corbières",
    "fitou": "Fitou",             "bergerac": "Bergerac",
    "cahors": "Cahors",           "madiran": "Madiran",
    "bandol": "Bandol",           "banyuls": "Banyuls",
    "gigondas": "Gigondas",       "chateauneuf": "Châteauneuf-du-Pape",
    "chinon": "Chinon",           "sancerre": "Sancerre",
    "vouvray": "Vouvray",         "muscadet": "Muscadet",
    "pouilly": "Pouilly-Fumé",
}
_COUNTRY_MAP: dict[str, str] = {
    "france": "France",       "fr": "France",
    "italy": "Italie",        "it": "Italie",
    "spain": "Espagne",       "es": "Espagne",
    "portugal": "Portugal",   "pt": "Portugal",
    "germany": "Allemagne",   "de": "Allemagne",
    "austria": "Autriche",    "argentina": "Argentine",
    "chile": "Chili",         "australia": "Australie",
    "united-states": "États-Unis", "us": "États-Unis",
    "south-africa": "Afrique du Sud", "new-zealand": "Nouvelle-Zélande",
}


def _parse_off_product(p: dict) -> dict | None:
    raw = (p.get("product_name") or "").strip()
    if not raw or len(raw) < 3:
        return None
    m = re.search(r"\b((19|20)\d{2})\b", raw)
    vintage = m.group(1) if m else ""
    name    = re.sub(r"\s*\b" + vintage + r"\b\s*", " ", raw).strip() if vintage else raw

    brands   = (p.get("brands") or "").split(",")
    producer = brands[0].strip() if brands else ""
    cats     = p.get("categories_tags") or []
    labels   = p.get("labels_tags") or []
    countries = p.get("countries_tags") or []
    origins  = (p.get("origins") or "").strip()
    image    = p.get("image_url") or p.get("image_front_url") or ""

    wine_type   = "red"
    appellation = ""
    for cat in cats:
        for k, v in _WINE_TYPE_MAP.items():
            if k in cat.lower():
                wine_type = v; break
    for src in labels + cats:
        s = src.lower()
        for k, v in _APPELLATION_MAP.items():
            if k in s and not appellation:
                appellation = v; break

    country = ""
    txt = " ".join(countries).lower() + " " + origins.lower()
    for k, v in _COUNTRY_MAP.items():
        if k in txt:
            country = v; break

    if producer.lower() == name.lower():
        producer = ""

    return {
        "name": name, "vintage": vintage, "type": wine_type,
        "appellation": appellation, "region": appellation,
        "country": country, "producer": producer,
        "tasting_notes": "", "food_pairing": "",
        "drink_from": "", "drink_until": "",
        "vivino_rating": 0, "image_url": image, "vivino_url": "",
    }


async def _off_get(session, params: dict) -> dict | None:
    for attempt in range(3):
        try:
            async with session.get(
                "https://world.openfoodfacts.org/cgi/search.pl",
                params=params,
                headers={"User-Agent": OFF_UA},
                timeout=14,
            ) as resp:
                if resp.status == 200:
                    return await resp.json(content_type=None)
                if resp.status == 503 and attempt < 2:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                return None
        except asyncio.TimeoutError:
            if attempt < 2:
                await asyncio.sleep(1.0)
        except Exception:
            return None
    return None


async def _off_search(hass: HomeAssistant, query: str) -> list[dict]:
    session = async_get_clientsession(hass)
    results: list[dict] = []
    seen: set[str] = set()
    plain = "".join(
        c for c in unicodedata.normalize("NFD", query)
        if unicodedata.category(c) != "Mn"
    )
    fields = (
        "product_name,brands,categories_tags,labels_tags,"
        "image_url,image_front_url,origins,countries_tags"
    )
    for q in list(dict.fromkeys([query, plain])):
        if len(results) >= 8:
            break
        data = await _off_get(session, {
            "search_terms": q, "search_simple": "1",
            "action": "process", "json": "1",
            "tagtype_0": "categories", "tag_contains_0": "contains",
            "tag_0": "wines", "sort_by": "unique_scans_n",
            "fields": fields, "page_size": "20", "lc": "fr,en",
        })
        if not data:
            continue
        for p in (data.get("products") or []):
            item = _parse_off_product(p)
            if not item:
                continue
            key = _normalize(item["name"])
            if key not in seen:
                seen.add(key)
                results.append(item)
                if len(results) >= 8:
                    break
    _LOGGER.info("OFF: %d résultat(s) pour '%s'", len(results), query)
    return results


# ── Orchestrateur principal ───────────────────────────────────────────────────

async def _search_wines(
    hass: HomeAssistant, query: str, gemini_key: str = ""
) -> dict:
    """Orchestrer la recherche texte.

    Retourne {"results": [...], "error": null|code, "source": "gemini"|"off"}.
    """
    cache_key = _normalize(query) + ("_g" if gemini_key else "_o")
    if cache_key in _SEARCH_CACHE:
        ts, cached = _SEARCH_CACHE[cache_key]
        if time.time() - ts < _CACHE_TTL:
            _LOGGER.debug("Cache hit pour '%s'", query)
            return cached

    if gemini_key:
        results, err = await _gemini_search_text(hass, query, gemini_key)
        if err == ERR_QUOTA_EXCEEDED:
            # Quota dépassé → fallback OFF + signaler l'erreur
            _LOGGER.warning("Quota Gemini dépassé, fallback OFF")
            off_results = await _off_search(hass, query)
            response = {"results": off_results, "error": ERR_QUOTA_EXCEEDED, "source": "off"}
        elif err:
            # Autre erreur Gemini → fallback OFF silencieux
            off_results = await _off_search(hass, query)
            response = {"results": off_results, "error": err, "source": "off"}
        elif not results:
            # Gemini OK mais aucun résultat → fallback OFF
            off_results = await _off_search(hass, query)
            response = {"results": off_results, "error": None, "source": "off"}
        else:
            response = {"results": results, "error": None, "source": "gemini"}
    else:
        results = await _off_search(hass, query)
        response = {"results": results, "error": None, "source": "off"}

    _SEARCH_CACHE[cache_key] = (time.time(), response)
    if len(_SEARCH_CACHE) > 200:
        oldest = min(_SEARCH_CACHE, key=lambda k: _SEARCH_CACHE[k][0])
        del _SEARCH_CACHE[oldest]

    return response


# ── Setup ─────────────────────────────────────────────────────────────────────

_CARD_URL_PATH = "/millesime/millesime-card.js"


async def _async_register_card(hass: HomeAssistant) -> None:
    """Sert millesime-card.js depuis l'intégration et l'ajoute aux ressources Lovelace.

    Robuste multi-versions HA : vue HTTP dédiée (fiable même sous Python 3.14),
    repli sur les chemins statiques ; ressource Lovelace en mode storage ou YAML.
    """
    card_path = os.path.join(os.path.dirname(__file__), "millesime-card.js")
    if not os.path.exists(card_path):
        _LOGGER.error("Millésime : millesime-card.js INTROUVABLE (%s)", card_path)
        return

    url = f"{_CARD_URL_PATH}?v={VERSION}"

    # ── 1. Servir le fichier en HTTP ──────────────────────────────────────────
    served = hass.data[DOMAIN].get("_card_http_done")
    if not served:
        ok = False
        # 1a. Vue HTTP dédiée (méthode la plus fiable, toutes versions)
        try:
            from homeassistant.components.http import HomeAssistantView
            from aiohttp import web

            class _MillesimeCardView(HomeAssistantView):
                url = _CARD_URL_PATH
                name = "millesime:card"
                requires_auth = False

                async def get(self, request):
                    return web.FileResponse(card_path)

            hass.http.register_view(_MillesimeCardView())
            ok = True
            _LOGGER.warning("Millésime : carte servie via vue HTTP sur %s", _CARD_URL_PATH)
        except Exception as exc:
            _LOGGER.warning("Millésime : vue HTTP impossible (%s), essai chemin statique", exc)
            # 1b. Repli : chemins statiques (API récente)
            try:
                from homeassistant.components.http import StaticPathConfig
                await hass.http.async_register_static_paths(
                    [StaticPathConfig(_CARD_URL_PATH, card_path, False)]
                )
                ok = True
                _LOGGER.warning("Millésime : carte servie via chemin statique")
            except Exception as exc2:
                _LOGGER.error("Millésime : impossible de servir la carte (%s)", exc2)

        if ok:
            hass.data[DOMAIN]["_card_http_done"] = True

    # ── 2. Inscrire la ressource Lovelace ─────────────────────────────────────
    try:
        lovelace = hass.data.get("lovelace")
        resources = getattr(lovelace, "resources", None) if lovelace else None

        if resources is None:
            from homeassistant.components.frontend import add_extra_js_url
            add_extra_js_url(hass, url)
            _LOGGER.warning("Millésime : carte injectée (Lovelace mode YAML) → %s", url)
            return

        if not resources.loaded:
            await resources.async_load()

        existing = [r for r in resources.async_items() if _CARD_URL_PATH in (r.get("url") or "")]
        if existing:
            for r in existing:
                if r.get("url") != url:
                    await resources.async_update_item(r["id"], {"res_type": "module", "url": url})
                    _LOGGER.warning("Millésime : ressource mise à jour → %s", url)
        else:
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.warning("Millésime : ressource créée → %s", url)
    except Exception as exc:
        _LOGGER.error("Millésime : ressource Lovelace impossible (%s) — ajoutez %s à la main",
                      exc, url)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Initialise Millésime."""
    hass.data.setdefault(DOMAIN, {})
    data = await hass.async_add_executor_job(_load, hass)

    gemini_key = (
        entry.options.get("gemini_api_key")
        or entry.data.get("gemini_api_key")
        or ""
    ).strip()

    hass.data[DOMAIN][entry.entry_id] = {
        "data":       data,
        "gemini_key": gemini_key,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    # ── Découverte dynamique des modèles Gemini (v7.1.3) ──────────────────────
    # En tâche de fond pour ne pas retarder le démarrage : tant qu'elle n'a pas
    # répondu, les appels utilisent le repli stable (2.5). Corrige le 404 en
    # cascade quand les noms de modèles codés en dur n'existent pas sur la clé.
    if gemini_key:
        hass.async_create_task(_discover_gemini_models(hass, gemini_key))

    # ── Auto-service de la carte Lovelace ─────────────────────────────────────
    # La carte est servie depuis le dossier de l'intégration (mis à jour par HACS)
    # et enregistrée comme ressource avec un cache-buster = version → mise à jour
    # automatique à chaque nouvelle version, sans copie manuelle dans www/.
    await _async_register_card(hass)

    # ── WebSocket : get_data ──────────────────────────────────────────────────

    @websocket_api.websocket_command({vol.Required("type"): "millesime/get_data"})
    @websocket_api.async_response
    async def ws_get_data(hass: HomeAssistant, connection, msg: dict) -> None:
        result = await hass.async_add_executor_job(_load, hass)
        # Copie superficielle : alias « cellar » (1re cave) pour une carte en cache
        # d'une version antérieure — jamais persisté dans le fichier de données.
        payload = dict(result)
        payload["cellar"] = _cellar(result)
        connection.send_result(msg["id"], payload)

    websocket_api.async_register_command(hass, ws_get_data)

    # ── WebSocket : lister les capteurs température / humidité disponibles ─────
    @websocket_api.websocket_command({vol.Required("type"): "millesime/list_sensors"})
    @websocket_api.async_response
    async def ws_list_sensors(hass: HomeAssistant, connection, msg: dict) -> None:
        temp, humid, other = [], [], []
        for state in hass.states.async_all("sensor"):
            dc = state.attributes.get("device_class")
            unit = state.attributes.get("unit_of_measurement", "") or ""
            entry = {
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name", state.entity_id),
                "unit": unit,
                "state": state.state,
            }
            if dc == "temperature" or "°" in unit:
                temp.append(entry)
            elif dc == "humidity" or unit == "%":
                humid.append(entry)
            else:
                other.append(entry)
        temp.sort(key=lambda e: e["name"].lower())
        humid.sort(key=lambda e: e["name"].lower())
        other.sort(key=lambda e: e["name"].lower())
        connection.send_result(msg["id"], {"temperature": temp, "humidity": humid, "other": other})

    websocket_api.async_register_command(hass, ws_list_sensors)

    # ── WebSocket : enregistrer les entités capteurs choisies ─────────────────
    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/set_sensors",
        vol.Optional("cellar_id"): vol.Any(str, None),
        vol.Optional("temp_entity"): vol.Any(str, None),
        vol.Optional("humid_entity"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_set_sensors(hass: HomeAssistant, connection, msg: dict) -> None:
        data = await hass.async_add_executor_job(_load, hass)
        cellar = _cellar(data, msg.get("cellar_id"))
        if "temp_entity" in msg:
            cellar["temp_entity"] = msg["temp_entity"] or ""
        if "humid_entity" in msg:
            cellar["humid_entity"] = msg["humid_entity"] or ""
        # Rafraîchir le cache en mémoire AVANT d'écrire : sans cela, le prochain
        # service passant par _get() repartirait d'un état antérieur au choix des
        # capteurs et l'écraserait à sa propre sauvegarde.
        hass.data[DOMAIN][entry.entry_id]["data"] = data
        await hass.async_add_executor_job(_save, hass, data)
        hass.bus.async_fire(f"{DOMAIN}_updated", {})
        connection.send_result(msg["id"], {"ok": True})

    websocket_api.async_register_command(hass, ws_set_sensors)

    # ── WebSocket : état courant des capteurs configurés ──────────────────────
    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/sensor_states",
        vol.Optional("cellar_id"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_sensor_states(hass: HomeAssistant, connection, msg: dict) -> None:
        data = await hass.async_add_executor_job(_load, hass)
        cellar = _cellar(data, msg.get("cellar_id"))
        out = {}
        for key, ent in (("temperature", cellar.get("temp_entity")), ("humidity", cellar.get("humid_entity"))):
            if ent:
                st = hass.states.get(ent)
                if st:
                    out[key] = {
                        "entity_id": ent,
                        "state": st.state,
                        "unit": st.attributes.get("unit_of_measurement", ""),
                        "name": st.attributes.get("friendly_name", ent),
                    }
        connection.send_result(msg["id"], out)

    websocket_api.async_register_command(hass, ws_sensor_states)

    # ── WebSocket : historique d'une entité (recorder) ────────────────────────
    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/entity_history",
        vol.Required("entity_id"): str,
        vol.Optional("hours", default=168): int,
    })
    @websocket_api.async_response
    async def ws_entity_history(hass: HomeAssistant, connection, msg: dict) -> None:
        from datetime import timedelta
        from homeassistant.util import dt as dt_util
        try:
            from homeassistant.components.recorder import history, get_instance
            end = dt_util.utcnow()
            start = end - timedelta(hours=msg["hours"])
            ent = msg["entity_id"]

            def _fetch():
                return history.state_changes_during_period(
                    hass, start, end, ent, include_start_time_state=True, no_attributes=True
                )

            states = await get_instance(hass).async_add_executor_job(_fetch)
            points = []
            for st in states.get(ent, []):
                try:
                    val = float(st.state)
                except (ValueError, TypeError):
                    continue
                ts = st.last_changed or st.last_updated
                points.append({"t": ts.isoformat(), "v": val})
            connection.send_result(msg["id"], {"entity_id": ent, "points": points})
        except Exception as exc:
            _LOGGER.warning("Millésime — historique %s impossible : %s", msg.get("entity_id"), exc)
            connection.send_result(msg["id"], {"entity_id": msg.get("entity_id"), "points": []})

    websocket_api.async_register_command(hass, ws_entity_history)

    # ── WebSocket : search_wine (texte) ───────────────────────────────────────

    @websocket_api.websocket_command({
        vol.Required("type"):  "millesime/search_wine",
        vol.Required("query"): str,
    })
    @websocket_api.async_response
    async def ws_search_wine(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = hass.data[DOMAIN][entry.entry_id]["gemini_key"]
        response = await _search_wines(hass, msg["query"], gkey)
        connection.send_result(msg["id"], response)

    websocket_api.async_register_command(hass, ws_search_wine)

    # ── WebSocket : analyze_photo ─────────────────────────────────────────────

    @websocket_api.websocket_command({
        vol.Required("type"):      "millesime/analyze_photo",
        vol.Required("image_b64"): str,
        vol.Required("mime_type"): str,
    })
    @websocket_api.async_response
    async def ws_analyze_photo(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = hass.data[DOMAIN][entry.entry_id]["gemini_key"]
        if not gkey:
            connection.send_result(msg["id"], {
                "results": [],
                "error":   ERR_INVALID_KEY,
                "source":  "gemini",
            })
            return
        results, err = await _gemini_analyze_photo(
            hass, msg["image_b64"], msg["mime_type"], gkey
        )
        connection.send_result(msg["id"], {
            "results": results,
            "error":   err,
            "source":  "gemini",
        })

    websocket_api.async_register_command(hass, ws_analyze_photo)

    # ── WebSocket : accords mets/vin par IA ───────────────────────────────────

    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/pair_food",
        vol.Required("dish"): str,
    })
    @websocket_api.async_response
    async def ws_pair_food(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = hass.data[DOMAIN][entry.entry_id]["gemini_key"]
        if not gkey:
            connection.send_result(msg["id"], {"results": [], "error": ERR_INVALID_KEY})
            return
        d = _load(hass)
        wines = d.get("wines", [])
        results, err = await _gemini_pair_food(hass, msg["dish"], wines, gkey)
        connection.send_result(msg["id"], {"results": results, "error": err})

    websocket_api.async_register_command(hass, ws_pair_food)

    # ── WebSockets sommelier IA : accord menu, audit, opportunité (v7.0.0),
    #    envie du moment (v7.0.1) ────────────────────────────────────────────
    def _wines_of_cellar(d: dict, cellar_id: str | None) -> list[dict]:
        """Vins de la cave donnée (mêmes règles que la projection de la carte :
        slots dans les casiers de la cave, ou vins jamais placés)."""
        cellar = _cellar(d, cellar_id)
        rack_ids = {r["id"] for r in cellar.get("racks", [])}
        out = []
        for w in d.get("wines", []):
            slots = w.get("slots", [])
            if not slots or any(s.get("rack_id") in rack_ids for s in slots):
                out.append(w)
        return out

    def _gemini_key() -> str:
        return hass.data[DOMAIN][entry.entry_id].get("gemini_key", "")

    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/pair_menu",
        vol.Optional("starter"): vol.Any(str, None),
        vol.Optional("main"): vol.Any(str, None),
        vol.Optional("dessert"): vol.Any(str, None),
        vol.Optional("cellar_id"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_pair_menu(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = _gemini_key()
        if not gkey:
            connection.send_result(msg["id"], {"error": "no_key"})
            return
        d = await hass.async_add_executor_job(_load, hass)
        wines = _wines_of_cellar(d, msg.get("cellar_id"))
        menu = {"starter": (msg.get("starter") or "").strip(),
                "main":    (msg.get("main") or "").strip(),
                "dessert": (msg.get("dessert") or "").strip()}
        if not any(menu.values()):
            connection.send_result(msg["id"], {"error": "empty_menu"})
            return
        if not wines:
            connection.send_result(msg["id"], {"error": "empty_cellar"})
            return
        result, usage, err = await _gemini_pair_menu(hass, gkey, menu, wines)
        connection.send_result(msg["id"],
            {"error": err} if err else {"result": result, "usage": usage})

    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/audit_cellar",
        vol.Optional("budget"): vol.Any(int, float, str, None),
        vol.Optional("region"): vol.Any(str, None),
        vol.Optional("cellar_id"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_audit_cellar(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = _gemini_key()
        if not gkey:
            connection.send_result(msg["id"], {"error": "no_key"})
            return
        d = await hass.async_add_executor_job(_load, hass)
        wines = _wines_of_cellar(d, msg.get("cellar_id"))
        if not wines:
            connection.send_result(msg["id"], {"error": "empty_cellar"})
            return
        try:
            budget = max(1.0, float(msg.get("budget") or 30))
        except (TypeError, ValueError):
            budget = 30.0
        result, usage, err = await _gemini_audit_cellar(
            hass, gkey, wines, budget, (msg.get("region") or "").strip())
        connection.send_result(msg["id"],
            {"error": err} if err else {"result": result, "usage": usage})

    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/opportunity",
        vol.Required("wine_text"): str,
        vol.Optional("cellar_id"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_opportunity(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = _gemini_key()
        if not gkey:
            connection.send_result(msg["id"], {"error": "no_key"})
            return
        wine_text = (msg.get("wine_text") or "").strip()
        if len(wine_text) < 3:
            connection.send_result(msg["id"], {"error": "empty_query"})
            return
        d = await hass.async_add_executor_job(_load, hass)
        wines = _wines_of_cellar(d, msg.get("cellar_id"))
        result, usage, err = await _gemini_opportunity(hass, gkey, wine_text, wines)
        connection.send_result(msg["id"],
            {"error": err} if err else {"result": result, "usage": usage})

    @websocket_api.websocket_command({
        vol.Required("type"): "millesime/craving",
        vol.Required("wants"): [str],
        vol.Optional("wants_structure"): [str],
        vol.Optional("color"): vol.Any(str, None),
        vol.Optional("cellar_id"): vol.Any(str, None),
    })
    @websocket_api.async_response
    async def ws_craving(hass: HomeAssistant, connection, msg: dict) -> None:
        """« Envie de… » (v7.0.1, structure v7.1.0) : une bouteille au profil voulu."""
        gkey = _gemini_key()
        if not gkey:
            connection.send_result(msg["id"], {"error": "no_key"})
            return
        wants = [w for w in (msg.get("wants") or []) if isinstance(w, str) and w.strip()]
        wants_s = [w for w in (msg.get("wants_structure") or []) if isinstance(w, str) and w.strip()]
        if not wants and not wants_s:
            connection.send_result(msg["id"], {"error": "empty_query"})
            return
        d = await hass.async_add_executor_job(_load, hass)
        wines = _wines_of_cellar(d, msg.get("cellar_id"))
        if not wines:
            connection.send_result(msg["id"], {"error": "empty_cellar"})
            return
        result, usage, err = await _gemini_craving(
            hass, gkey, wants, wants_s, (msg.get("color") or "").strip(), wines)
        connection.send_result(msg["id"],
            {"error": err} if err else {"result": result, "usage": usage})

    @websocket_api.websocket_command({vol.Required("type"): "millesime/ai_usage"})
    @websocket_api.async_response
    async def ws_ai_usage(hass: HomeAssistant, connection, msg: dict) -> None:
        d = await hass.async_add_executor_job(_load, hass)
        today = datetime.now().strftime("%Y-%m-%d")
        au = d.get("ai_usage", {})
        if au.get("date") != today:
            au = {"date": today, "prompt": 0, "output": 0, "calls": 0}
        connection.send_result(msg["id"], {"usage": au})

    websocket_api.async_register_command(hass, ws_pair_menu)
    websocket_api.async_register_command(hass, ws_audit_cellar)
    websocket_api.async_register_command(hass, ws_opportunity)
    websocket_api.async_register_command(hass, ws_craving)
    websocket_api.async_register_command(hass, ws_ai_usage)

    # ── WebSocket : estimate_price ────────────────────────────────────────────
    @websocket_api.websocket_command({
        vol.Required("type"):  "millesime/estimate_price",
        vol.Required("query"): str,
    })
    @websocket_api.async_response
    async def ws_estimate_price(hass: HomeAssistant, connection, msg: dict) -> None:
        gkey = hass.data[DOMAIN][entry.entry_id]["gemini_key"]
        if not gkey:
            connection.send_result(msg["id"], {"price": 0, "error": ERR_INVALID_KEY})
            return
        # Recherche Gemini ciblée prix uniquement
        price_prompt = (
            f"Quel est le prix moyen constate en euros pour ce vin : {msg['query']} ? "
            "Reponds UNIQUEMENT avec un nombre decimal (ex: 18.5). Rien d'autre."
        )
        body = {"contents": [{"parts": [{"text": price_prompt}]}]}
        # v7.1.5 : appel unifié. CAS LE PLUS CRITIQUE : la sortie était limitée à
        # 32 tokens — avec le thinking actif (défaut de gemini-2.5-flash), la
        # réflexion consommait ce budget avant même d'écrire le prix, et la
        # réponse revenait vide. Thinking désactivé + marge portée à 256 tokens.
        data_r, code = await _gemini_call(
            hass, gkey, _text_models(), body,
            {"temperature": 0.1, "maxOutputTokens": 256}, 30, "estimate_price",
        )
        if data_r is None:
            connection.send_result(msg["id"], {"price": 0, "error": code or ERR_UNAVAILABLE})
            return
        _bump_ai_usage(hass, data_r)
        try:
            raw, _f = _gemini_text(data_r)          # v7.1.6 : toutes les parties
            raw = re.sub(r"[^0-9.,]", "", raw.strip()).replace(",", ".")
            price = round(float(raw), 2) if raw else 0
            connection.send_result(msg["id"], {"price": price, "error": None})
        except Exception as exc:
            _LOGGER.warning("estimate_price : réponse illisible (%s)", exc)
            connection.send_result(msg["id"], {"price": 0, "error": ERR_PARSE_ERROR})

    websocket_api.async_register_command(hass, ws_estimate_price)

    # ── Services ──────────────────────────────────────────────────────────────

    def _get() -> dict:
        return hass.data[DOMAIN][entry.entry_id]["data"]

    async def _persist(d: dict) -> None:
        hass.data[DOMAIN][entry.entry_id]["data"] = d
        await hass.async_add_executor_job(_save, hass, d)
        hass.bus.async_fire(f"{DOMAIN}_updated", {})

    # Apparence du casier (rendu par la carte) : seules les clés connues sont
    # stockées ; un objet vide ou invalide signifie « retour au style automatique »
    _STYLE_KEYS = ("material", "posts", "feet", "cross_braces", "roof", "accent")

    def _rack_style(call: ServiceCall) -> dict | None:
        v = call.data.get("style")
        return {k: v[k] for k in _STYLE_KEYS if k in v} if isinstance(v, dict) else None

    def _call_levels(call: ServiceCall, layout: str) -> int:
        """Niveaux de superposition : 1 à 4, uniquement pour la disposition « stacked »."""
        if layout != "stacked":
            return 1
        try:
            return max(1, min(4, int(call.data.get("levels", 2))))
        except (TypeError, ValueError):
            return 2

    async def svc_add_rack(call: ServiceCall) -> None:
        d = _get()
        cellar = _cellar(d, call.data.get("cellar_id"))
        cols = int(call.data.get("columns", 8))
        shelves = int(call.data.get("shelves", call.data.get("rows", 2)))
        layout = call.data.get("layout", "side_by_side")
        levels = _call_levels(call, layout)
        rack = {
            "id":      _uid(),
            "name":    call.data.get("name", f"Casier {len(cellar['racks']) + 1}"),
            "columns": cols, "shelves": shelves, "levels": levels,
            "slots":   cols * shelves * levels,
            "layout":  layout,
            "orientation": call.data.get("orientation", "punt"),
        }
        style = _rack_style(call)
        if style:
            rack["style"] = style
        cellar["racks"].append(rack)
        await _persist(d)

    async def svc_update_rack(call: ServiceCall) -> None:
        d = _get()
        for f in _all_racks(d):
            if f["id"] == _call_rack_id(call):
                for k in ["name", "columns", "shelves", "layout", "orientation"]:
                    if k in call.data:
                        f[k] = call.data[k]
                if "rows" in call.data and "shelves" not in call.data:  # alias déprécié
                    f["shelves"] = call.data["rows"]
                if "levels" in call.data or "layout" in call.data:
                    if f.get("layout") != "stacked":
                        f["levels"] = 1
                    else:
                        try:
                            f["levels"] = max(1, min(4, int(call.data.get("levels", f.get("levels", 2)))))
                        except (TypeError, ValueError):
                            f["levels"] = max(1, min(4, int(f.get("levels", 2) or 2)))
                if "style" in call.data:
                    style = _rack_style(call)
                    if style:
                        f["style"] = style
                    else:
                        f.pop("style", None)
                f["slots"] = _rack_capacity(f)
                break
        await _persist(d)

    async def svc_remove_rack(call: ServiceCall) -> None:
        d = _get()
        fid = _call_rack_id(call)
        for c in _cellars(d):
            c["racks"] = [f for f in c["racks"] if f["id"] != fid]
        for w in d["wines"]:
            w["slots"] = [s for s in w["slots"] if s["rack_id"] != fid]
        d["wines"] = [w for w in d["wines"] if w["slots"]]
        await _persist(d)

    async def svc_add_wine(call: ServiceCall) -> None:
        """Crée un nouveau vin avec un premier emplacement."""
        d = _get()
        rack_id = _call_rack_id(call)
        slot     = int(call.data.get("slot", 0))
        if _slot_taken(d, rack_id, slot):
            raise HomeAssistantError(f"L'emplacement n°{slot + 1} est déjà occupé dans ce casier.")
        d["wines"].append({
            "id":           _uid(),
            "name":         call.data.get("name", ""),
            "vintage":      call.data.get("vintage", ""),
            "type":         call.data.get("type", "red"),
            "shape":        call.data.get("shape", ""),
            "appellation":  call.data.get("appellation", ""),
            "region":       call.data.get("region", ""),
            "producer":     call.data.get("producer", ""),
            "country":      call.data.get("country", ""),
            "price":        float(call.data.get("price", 0)),
            "drink_from":   call.data.get("drink_from", ""),
            "drink_until":  call.data.get("drink_until", ""),
            "notes":        call.data.get("notes", ""),
            "tasting_notes":call.data.get("tasting_notes", ""),
            "food_pairing": call.data.get("food_pairing", ""),
            "vivino_rating":float(call.data.get("vivino_rating", 0)),
            "image_url":    call.data.get("image_url", ""),
            "vivino_url":   call.data.get("vivino_url", ""),
            "event":        call.data.get("event", ""),
            "gifted_by":    call.data.get("gifted_by", ""),
            "size":         call.data.get("size") or "75cl",
            "favorite":     bool(call.data.get("favorite", False)),
            "added_date":   call.data.get("added_date") or datetime.now().strftime("%Y-%m-%d"),
            "slots":        [_mk_slot(rack_id, slot, call.data.get("slot_comment"))],
        })
        await _persist(d)

    async def svc_update_wine(call: ServiceCall) -> None:
        """Met à jour les métadonnées d'un vin (s'applique à tous ses emplacements)."""
        d = _get()
        updatable = [
            "name", "vintage", "type", "appellation", "region", "producer",
            "country", "price", "drink_from", "drink_until", "notes",
            "tasting_notes", "food_pairing", "event", "vivino_rating",
            "image_url", "vivino_url", "size", "favorite", "shape", "gifted_by",
        ]
        for w in d["wines"]:
            if w["id"] == call.data["wine_id"]:
                for k in updatable:
                    if k in call.data:
                        w[k] = call.data[k]
                break
        await _persist(d)

    async def svc_add_slot(call: ServiceCall) -> None:
        """Ajoute un emplacement à un vin existant."""
        d = _get()
        wine_id  = call.data["wine_id"]
        rack_id = _call_rack_id(call)
        slot     = int(call.data.get("slot", 0))
        if _slot_taken(d, rack_id, slot):
            raise HomeAssistantError(f"L'emplacement n°{slot + 1} est déjà occupé dans ce casier.")
        for w in d["wines"]:
            if w["id"] == wine_id:
                w["slots"].append(_mk_slot(rack_id, slot, call.data.get("comment"), call.data.get("size")))
                break
        await _persist(d)

    async def svc_update_slot(call: ServiceCall) -> None:
        """Met à jour les attributs d'une bouteille (format, commentaire) sans la déplacer."""
        d = _get()
        wine_id  = call.data["wine_id"]
        slot_idx = int(call.data.get("slot_idx", 0))
        for w in d["wines"]:
            if w["id"] == wine_id:
                if slot_idx >= len(w["slots"]):
                    raise HomeAssistantError(f"Index d'emplacement {slot_idx} invalide pour ce vin.")
                s = w["slots"][slot_idx]
                for k in ("size", "comment"):
                    if k in call.data:
                        v = str(call.data[k]).strip()
                        if v:
                            s[k] = v
                        else:
                            s.pop(k, None)   # champ vidé → retour à la valeur du vin
                break
        await _persist(d)

    async def svc_move_slot(call: ServiceCall) -> None:
        """Déplace un emplacement d'un vin vers une nouvelle position."""
        d = _get()
        wine_id   = call.data["wine_id"]
        slot_idx  = int(call.data.get("slot_idx", 0))
        new_rack = _call_rack_id(call)
        new_slot  = int(call.data.get("slot", 0))
        if _slot_taken(d, new_rack, new_slot, exclude_wine_id=wine_id, exclude_slot_idx=slot_idx):
            raise HomeAssistantError(f"L'emplacement n°{new_slot + 1} est déjà occupé dans ce casier.")
        for w in d["wines"]:
            if w["id"] == wine_id:
                if slot_idx >= len(w["slots"]):
                    raise HomeAssistantError(f"Index d'emplacement {slot_idx} invalide pour ce vin.")
                # Préserve les clés annexes (commentaire de bouteille…) lors du déplacement
                w["slots"][slot_idx] = {**w["slots"][slot_idx], "rack_id": new_rack, "slot": new_slot}
                break
        await _persist(d)

    async def svc_swap_slots(call: ServiceCall) -> None:
        """Permute DEUX emplacements occupés (échange de position). Atomique : ne
        nécessite AUCUN emplacement libre → fonctionne même cave pleine.
        Porté de la PR #6 (contribution Pulpyyyy)."""
        d = _get()
        wa = call.data["wine_id_a"]; ia = int(call.data.get("slot_idx_a", 0))
        wb = call.data["wine_id_b"]; ib = int(call.data.get("slot_idx_b", 0))
        sa = sb = None
        for w in d["wines"]:
            if w["id"] == wa and ia < len(w.get("slots", [])):
                sa = w["slots"][ia]
            if w["id"] == wb and ib < len(w.get("slots", [])):
                sb = w["slots"][ib]
        if sa is None or sb is None:
            raise HomeAssistantError("Emplacement introuvable pour la permutation.")
        if sa is sb:
            return  # même emplacement : rien à faire
        # Échange uniquement la POSITION (casier + numéro) ; le format/commentaire
        # propres à chaque bouteille restent sur leur bouteille.
        sa["rack_id"], sb["rack_id"] = sb["rack_id"], sa["rack_id"]
        sa["slot"], sb["slot"] = sb["slot"], sa["slot"]
        await _persist(d)

    async def svc_remove_slot(call: ServiceCall) -> None:
        """Supprime un emplacement. Supprime le vin si c'était le dernier."""
        d = _get()
        wine_id  = call.data["wine_id"]
        slot_idx = int(call.data.get("slot_idx", 0))
        for w in d["wines"]:
            if w["id"] == wine_id:
                if slot_idx >= len(w["slots"]):
                    raise HomeAssistantError(f"Index d'emplacement {slot_idx} invalide pour ce vin.")
                if len(w["slots"]) <= 1:
                    d["wines"].remove(w)
                else:
                    w["slots"].pop(slot_idx)
                break
        await _persist(d)

    async def svc_remove_wine(call: ServiceCall) -> None:
        """Supprime un vin et tous ses emplacements."""
        d = _get()
        d["wines"] = [w for w in d["wines"] if w["id"] != call.data["wine_id"]]
        await _persist(d)

    # ── Services de compatibilité (ancien format bottle_id) ───────────────────

    async def svc_add_bottle(call: ServiceCall) -> None:
        """Alias de add_wine pour compatibilité."""
        await svc_add_wine(call)

    async def svc_update_bottle(call: ServiceCall) -> None:
        """Met à jour les métadonnées et/ou déplace une bouteille (bottle_id = wine_id)."""
        d = _get()
        bottle_id = call.data["bottle_id"]
        updatable = [
            "name", "vintage", "type", "appellation", "region", "producer",
            "country", "price", "drink_from", "drink_until", "notes",
            "tasting_notes", "food_pairing", "event", "vivino_rating",
            "image_url", "vivino_url", "size", "favorite", "shape",
        ]
        new_rack = call.data.get("rack_id", call.data.get("floor_id"))
        new_slot  = call.data.get("slot")
        for w in d["wines"]:
            if w["id"] == bottle_id:
                for k in updatable:
                    if k in call.data:
                        w[k] = call.data[k]
                if new_rack is not None and new_slot is not None:
                    new_slot_int = int(new_slot)
                    if _slot_taken(d, new_rack, new_slot_int, exclude_wine_id=bottle_id, exclude_slot_idx=0):
                        raise HomeAssistantError(f"L'emplacement n°{new_slot_int + 1} est déjà occupé dans ce casier.")
                    if w["slots"]:
                        w["slots"][0] = {"rack_id": new_rack, "slot": new_slot_int}
                break
        await _persist(d)

    async def svc_remove_bottle(call: ServiceCall) -> None:
        """Supprime une bouteille par bottle_id (= wine_id). Alias de remove_wine."""
        d = _get()
        d["wines"] = [w for w in d["wines"] if w["id"] != call.data["bottle_id"]]
        await _persist(d)

    async def svc_duplicate_bottle(call: ServiceCall) -> None:
        """Duplique une bouteille vers un autre emplacement."""
        d = _get()
        bottle_id = call.data["bottle_id"]
        rack_id  = _call_rack_id(call)
        slot      = int(call.data.get("slot", 0))
        if _slot_taken(d, rack_id, slot):
            raise HomeAssistantError(f"L'emplacement n°{slot + 1} est déjà occupé dans ce casier.")
        for w in d["wines"]:
            if w["id"] == bottle_id:
                w["slots"].append({"rack_id": rack_id, "slot": slot})
                break
        await _persist(d)

    async def svc_rename_cellar(call: ServiceCall) -> None:
        d = _get()
        cellar = _cellar(d, call.data.get("cellar_id"))
        cellar["name"] = call.data.get("name", "Millésime")
        await _persist(d)

    async def svc_add_cellar(call: ServiceCall) -> None:
        """Crée une nouvelle cave (vide) dans l'instance."""
        d = _get()
        cs = _cellars(d)
        cs.append({
            "id":    _uid(),
            "name":  call.data.get("name", f"Cave {len(cs) + 1}"),
            "racks": [],
        })
        await _persist(d)

    async def svc_remove_cellar(call: ServiceCall) -> None:
        """Supprime une cave. Refusé si c'est la dernière ou si elle contient des casiers."""
        d = _get()
        cid = call.data.get("cellar_id")
        cs = _cellars(d)
        target = next((c for c in cs if c.get("id") == cid), None)
        if not target:
            raise HomeAssistantError(f"Cave introuvable : {cid}")
        if len(cs) <= 1:
            raise HomeAssistantError("Impossible de supprimer la dernière cave.")
        if target.get("racks"):
            raise HomeAssistantError(
                "Cette cave contient encore des casiers : déplacez ou supprimez-les d'abord."
            )
        d["cellars"] = [c for c in cs if c.get("id") != cid]
        await _persist(d)

    async def svc_value_snapshot(call: ServiceCall) -> None:
        """Enregistre la valeur actuelle de CHAQUE cave dans son historique."""
        d = _get()
        wines = d.get("wines", [])
        today = datetime.now().strftime("%Y-%m-%d")
        for cellar in _cellars(d):
            rack_ids = {r["id"] for r in cellar.get("racks", [])}
            value = bottles = 0
            for w in wines:
                n = sum(1 for s in w.get("slots", []) if s.get("rack_id") in rack_ids)
                bottles += n
                value   += float(w.get("price", 0)) * n
            history = [h for h in cellar.get("value_history", []) if h.get("date") != today]
            history.append({
                "date":     today,
                "value":    round(value, 2),
                "bottles":  bottles,
            })
            # Garder les 365 derniers points
            cellar["value_history"] = sorted(history, key=lambda x: x["date"])[-365:]
        await _persist(d)

    async def svc_drink_bottle(call: ServiceCall) -> None:
        """Marque une bouteille comme bue : retire un emplacement, archive au journal.

        wine_id (ou bottle_id) identifie le vin ; slot_idx l'emplacement bu (défaut 0).
        Si c'était le dernier emplacement, le vin est supprimé de la cave.
        """
        d = _get()
        wine_id = call.data.get("wine_id") or call.data.get("bottle_id")
        src = next((w for w in d["wines"] if w["id"] == wine_id), None)
        if not src:
            return
        slot_idx = int(call.data.get("slot_idx", 0))
        if slot_idx >= len(src.get("slots", [])):
            raise HomeAssistantError(f"Index d'emplacement {slot_idx} invalide pour ce vin.")
        rating = call.data.get("rating", 0)
        try:
            rating = round(float(str(rating).replace(",", ".")), 1)
        except (TypeError, ValueError):
            rating = 0
        comment  = str(call.data.get("comment", "") or "")
        drunk_on = call.data.get("drunk_date") or datetime.now().strftime("%Y-%m-%d")

        drunk_slot = src["slots"][slot_idx]
        log = d.setdefault("tasting_log", [])
        log.append({
            "id":            _uid(),
            "name":          src.get("name", ""),
            "size":          drunk_slot.get("size") or src.get("size", ""),
            "bottle_comment": drunk_slot.get("comment", ""),
            "favorite":      bool(src.get("favorite", False)),
            "vintage":       src.get("vintage", ""),
            "type":          src.get("type", "red"),
            "appellation":   src.get("appellation", ""),
            "region":        src.get("region", ""),
            "country":       src.get("country", ""),
            "producer":      src.get("producer", ""),
            "price":         src.get("price", 0),
            "tasting_notes": src.get("tasting_notes", ""),
            "food_pairing":  src.get("food_pairing", ""),
            "vivino_rating": src.get("vivino_rating", 0),
            "image_url":     src.get("image_url", ""),
            "added_date":    src.get("added_date", ""),
            "drunk_date":    drunk_on,
            "my_rating":     rating,
            "my_comment":    comment,
        })
        # Garder les 1000 dernières dégustations
        d["tasting_log"] = log[-1000:]
        # Retirer l'emplacement bu ; supprimer le vin si c'était le dernier
        if len(src["slots"]) <= 1:
            d["wines"].remove(src)
        else:
            src["slots"].pop(slot_idx)
        await _persist(d)

    async def _import_vinotag_run(cellar_id: str | None = None) -> None:
        """Importe <config>/millesime_import_vinotag.csv puis efface le fichier."""
        path = hass.config.path("millesime_import_vinotag.csv")
        if not os.path.exists(path):
            raise HomeAssistantError(
                "Fichier millesime_import_vinotag.csv introuvable dans le dossier de configuration de Home Assistant."
            )

        def _read() -> list[dict]:
            with open(path, encoding="utf-8-sig", newline="") as f:
                return list(csv.DictReader(f))

        rows = await hass.async_add_executor_job(_read)
        rows = [r for r in rows if (r.get("wine_name") or "").strip()]
        if not rows:
            raise HomeAssistantError("millesime_import_vinotag.csv : aucune ligne de vin valide (export Vinotag attendu).")

        d = _get()
        # Auto-placement : emplacements libres dans l'ordre des casiers de la cave cible
        cellar = _cellar(d, cellar_id)
        occ = {(s["rack_id"], s["slot"]) for w in d["wines"] for s in w.get("slots", [])}
        free: list[tuple[str, int]] = []
        for rk in cellar["racks"]:
            total = rk.get("slots") or _rack_capacity(rk)
            free.extend((rk["id"], i) for i in range(total) if (rk["id"], i) not in occ)
        need = sum(max(1, int(_vt_num(r.get("bottle_quantity")) or 1)) for r in rows)
        if len(free) < need:
            # Capacité insuffisante : casier « Import » créé à la volée
            cols = 8
            shelves = max(1, -(-(need - len(free)) // cols))
            rack = {"id": _uid(), "name": "Import", "columns": cols,
                    "shelves": shelves, "levels": 1,
                    "slots": cols * shelves, "layout": "side_by_side"}
            cellar["racks"].append(rack)
            free.extend((rack["id"], i) for i in range(cols * shelves))

        cursor = 0
        for r in rows:
            qty = max(1, int(_vt_num(r.get("bottle_quantity")) or 1))
            comment = (r.get("bottle_comment") or "").strip()
            slots = []
            for _ in range(qty):
                rid, sl = free[cursor]
                cursor += 1
                slots.append(_mk_slot(rid, sl, comment))
            region = (r.get("wine_region") or "").strip().lower()
            country = (r.get("wine_country") or "").strip().lower()
            d["wines"].append({
                "id":           _uid(),
                "name":         (r.get("wine_name") or "").strip(),
                "vintage":      (r.get("millesime_year") or "").strip(),
                "type":         VINOTAG_TYPES.get((r.get("wine_type") or "").strip(), "red"),
                "appellation":  "",
                "region":       VINOTAG_REGIONS.get(region, region.replace("_", " ").title()),
                "producer":     (r.get("wine_domain") or "").strip(),
                "country":      VINOTAG_COUNTRIES.get(country, country.upper()),
                # Prix retenu : valeur actuelle (bottle_real_price), sinon prix d'achat
                "price":        _vt_num(r.get("bottle_real_price"), r.get("bottle_buying_price")),
                "drink_from":   _vt_year(r.get("wine_apogee_start")),
                "drink_until":  _vt_year(r.get("wine_apogee_end")),
                "notes":        (r.get("wine_comment") or "").strip(),
                "tasting_notes": "",
                "food_pairing": "",
                "vivino_rating": _vt_num(r.get("rating")),
                "image_url":    "",
                "vivino_url":   "",
                "event":        "",
                "size":         (r.get("bottle_size") or "").strip() or "75cl",
                "favorite":     (r.get("favorite") or "").strip().lower() == "true",
                "added_date":   _vt_date(r.get("last_bottle_added")) or datetime.now().strftime("%Y-%m-%d"),
                "slots":        slots,
            })
        await _persist(d)
        # Effacé uniquement si l'import a réussi
        await hass.async_add_executor_job(os.remove, path)
        _LOGGER.info("Millésime — import Vinotag : %d vins (%d bouteilles), fichier effacé", len(rows), need)

    async def svc_import_vinotag(call: ServiceCall) -> None:
        await _import_vinotag_run(call.data.get("cellar_id"))

    async def svc_refresh_wines(call: ServiceCall) -> None:
        """Dédoublonne la cave puis complète les fiches via Gemini.

        1. Les vins identiques (nom normalisé + millésime + type) sont fusionnés :
           le premier conserve ses données, récupère les emplacements des doublons
           et leurs champs non vides manquants.
        2. Chaque vin est recherché via Gemini (fallback Open Food Facts) ; seuls
           ses CHAMPS VIDES sont complétés — aucune donnée saisie n'est écrasée.
        """
        d = _get()

        # 1) Fusion des doublons
        merged = 0
        seen: dict = {}
        keep: list = []
        for w in d["wines"]:
            key = (_normalize(w.get("name", "")), str(w.get("vintage", "")), w.get("type", "red"))
            if key in seen:
                tgt = seen[key]
                tgt.setdefault("slots", []).extend(w.get("slots", []))
                for k2, v in w.items():
                    if k2 in ("id", "slots"):
                        continue
                    if v and not tgt.get(k2):
                        tgt[k2] = v
                merged += 1
            else:
                seen[key] = w
                keep.append(w)
        d["wines"] = keep

        # 2) Enrichissement Gemini (champs vides uniquement)
        gemini_key = hass.data[DOMAIN][entry.entry_id].get("gemini_key", "")
        FIELDS = [
            "appellation", "region", "producer", "country", "tasting_notes",
            "food_pairing", "drink_from", "drink_until", "aroma_profile", "structure_profile",
            "image_url", "vivino_url", "vivino_rating",
        ]
        # Options opt-in de la popup ♻️ : ces deux réglages ÉCRASENT une donnée déjà
        # saisie (par défaut, seuls les champs VIDES sont complétés) — cochés
        # explicitement par l'utilisateur, comme convenu.
        update_prices   = bool(call.data.get("update_prices", False))
        tighten_apogee  = bool(call.data.get("tighten_apogee", False))
        # Fenêtre d'apogée « trop large » : > 12 ans, la limite que notre PROMPT
        # impose lui-même à l'IA ("JAMAIS plus de 12 ans d'écart"). Une fenêtre
        # existante plus large que ça vient forcément d'avant ce garde-fou de
        # prompt (ou d'une saisie manuelle très vague) → candidate au resserrement.
        MAX_SANE_SPAN = 12

        def _apogee_too_wide(wine: dict) -> bool:
            try:
                f, u = int(wine.get("drink_from") or 0), int(wine.get("drink_until") or 0)
            except (TypeError, ValueError):
                return False
            return bool(f and u and (u - f) > MAX_SANE_SPAN)

        updated = 0
        total = len(d["wines"])
        done = 0
        hass.bus.async_fire(f"{DOMAIN}_refresh_progress", {"done": 0, "total": total})
        for w in d["wines"]:
            done += 1
            hass.bus.async_fire(f"{DOMAIN}_refresh_progress", {"done": done, "total": total})
            needs_tighten = tighten_apogee and _apogee_too_wide(w)
            if not update_prices and not needs_tighten and not any(not w.get(f) for f in FIELDS):
                continue                        # fiche déjà complète, rien à resserrer
            query = " ".join(filter(None, [w.get("name", ""), str(w.get("vintage", ""))]))
            if len(query) < 3:
                continue
            try:
                res = await _search_wines(hass, query, gemini_key)
            except Exception as exc:            # quota, réseau… on continue
                _LOGGER.warning("Millésime — refresh '%s' ignoré : %s", query, exc)
                continue
            best = (res.get("results") or [None])[0]
            if not best:
                continue
            changed = False
            for f in FIELDS:
                if f in ("drink_from", "drink_until"):
                    continue                    # traité séparément ci-dessous
                if not w.get(f) and best.get(f):
                    w[f] = best[f]
                    changed = True
            # Fenêtre d'apogée : complétée si vide, RESSERRÉE si l'option est cochée
            # et l'ancienne fenêtre dépasse la limite — sinon jamais écrasée.
            if best.get("drink_from") and best.get("drink_until"):
                if not w.get("drink_from") or not w.get("drink_until"):
                    w["drink_from"], w["drink_until"] = best["drink_from"], best["drink_until"]
                    changed = True
                elif needs_tighten and not _apogee_too_wide({
                        "drink_from": best["drink_from"], "drink_until": best["drink_until"]}):
                    # Ne remplace que si le NOUVEAU résultat est lui-même raisonnable
                    # (évite d'échanger une fenêtre large contre une autre fenêtre large)
                    w["drink_from"], w["drink_until"] = best["drink_from"], best["drink_until"]
                    changed = True
            if update_prices:
                new_price = round(float(best.get("price") or 0), 2)
                if new_price > 0 and new_price != float(w.get("price") or 0):
                    w["price"] = new_price
                    changed = True
            if changed:
                updated += 1
            await asyncio.sleep(0.3)            # ménage le quota Gemini
        hass.bus.async_fire(f"{DOMAIN}_refresh_progress", {"done": total, "total": total, "finished": True})
        await _persist(d)
        _LOGGER.info("Millésime — refresh : %d doublon(s) fusionné(s), %d fiche(s) complétée(s)", merged, updated)

    async def svc_delete_tasting(call: ServiceCall) -> None:
        """Supprime une entrée du journal de dégustation."""
        d = _get()
        tid = call.data["tasting_id"]
        log = d.get("tasting_log", [])
        d["tasting_log"] = [t for t in log if t.get("id") != tid]
        await _persist(d)

    hass.services.async_register(DOMAIN, "add_rack",         svc_add_rack)
    hass.services.async_register(DOMAIN, "update_rack",      svc_update_rack)
    hass.services.async_register(DOMAIN, "remove_rack",      svc_remove_rack)
    hass.services.async_register(DOMAIN, "add_wine",          svc_add_wine)
    hass.services.async_register(DOMAIN, "update_wine",       svc_update_wine)
    hass.services.async_register(DOMAIN, "add_slot",          svc_add_slot)
    hass.services.async_register(DOMAIN, "move_slot",         svc_move_slot)
    hass.services.async_register(DOMAIN, "swap_slots",        svc_swap_slots)
    hass.services.async_register(DOMAIN, "remove_slot",       svc_remove_slot)
    hass.services.async_register(DOMAIN, "update_slot",       svc_update_slot)
    hass.services.async_register(DOMAIN, "remove_wine",       svc_remove_wine)
    hass.services.async_register(DOMAIN, "rename_cellar",     svc_rename_cellar)
    hass.services.async_register(DOMAIN, "add_cellar",        svc_add_cellar)
    hass.services.async_register(DOMAIN, "remove_cellar",     svc_remove_cellar)
    hass.services.async_register(DOMAIN, "value_snapshot",    svc_value_snapshot)
    hass.services.async_register(DOMAIN, "drink_bottle",      svc_drink_bottle)
    hass.services.async_register(DOMAIN, "delete_tasting",    svc_delete_tasting)
    hass.services.async_register(DOMAIN, "import_vinotag",    svc_import_vinotag)
    hass.services.async_register(DOMAIN, "refresh_wines",     svc_refresh_wines)

    # Import Vinotag AUTOMATIQUE au lancement si le fichier est présent
    if os.path.exists(hass.config.path("millesime_import_vinotag.csv")):
        try:
            await _import_vinotag_run()
        except HomeAssistantError as exc:
            _LOGGER.warning("Millésime — import Vinotag au démarrage ignoré : %s", exc)
    # Compatibilité ancien format
    hass.services.async_register(DOMAIN, "add_bottle",        svc_add_bottle)
    hass.services.async_register(DOMAIN, "update_bottle",     svc_update_bottle)
    hass.services.async_register(DOMAIN, "remove_bottle",     svc_remove_bottle)
    hass.services.async_register(DOMAIN, "duplicate_bottle",  svc_duplicate_bottle)

    # Alias dépréciés (ancienne nomenclature « étage ») — automatisations existantes
    hass.services.async_register(DOMAIN, "add_floor",          svc_add_rack)
    hass.services.async_register(DOMAIN, "update_floor",       svc_update_rack)
    hass.services.async_register(DOMAIN, "remove_floor",       svc_remove_rack)

    mode = "Gemini (modèles auto-découverts) + photo" if gemini_key else "Open Food Facts"
    _LOGGER.info("Millésime v%s démarré — %s", VERSION, mode)
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    new_key = (entry.options.get("gemini_api_key") or "").strip()
    hass.data[DOMAIN][entry.entry_id]["gemini_key"] = new_key
    _SEARCH_CACHE.clear()
    # v7.1.3 : la clé a changé → re-découvrir les modèles disponibles pour elle
    # (réinitialise la sélection ; repli stable tant que la découverte n'a pas répondu)
    _GEMINI_MODELS["text"] = _GEMINI_MODELS["vision"] = None
    _GEMINI_MODELS["discovered"] = False
    if new_key:
        hass.async_create_task(_discover_gemini_models(hass, new_key))
    _LOGGER.info("Millésime — clé Gemini mise à jour, cache vidé, modèles à redécouvrir")


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return ok
