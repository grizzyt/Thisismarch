"""
Maps Odds API team names (e.g. "Auburn Tigers") to BartTorvik names (e.g. "Auburn").

Strategy:
1. Strip common mascot suffixes and try exact match
2. Try known alias mappings for tricky names
3. Fuzzy substring match as last resort
"""

# Odds API name → BartTorvik name (only for names that don't auto-resolve)
ALIASES = {
    "Michigan State Spartans": "Michigan St.",
    "Michigan Wolverines": "Michigan",
    "Bethune-Cookman Wildcats": "Bethune Cookman",
    "Ole Miss Rebels": "Mississippi",
    "UConn Huskies": "Connecticut",
    "Connecticut Huskies": "Connecticut",
    "Loyola (Chi) Ramblers": "Loyola Chicago",
    "Loyola Chicago Ramblers": "Loyola Chicago",
    "St. John's Red Storm": "St. John's",
    "Saint John's Red Storm": "St. John's",
    "St. Bonaventure Bonnies": "St. Bonaventure",
    "Saint Bonaventure Bonnies": "St. Bonaventure",
    "Miami (FL) Hurricanes": "Miami FL",
    "Miami Hurricanes": "Miami FL",
    "Miami (OH) RedHawks": "Miami OH",
    "San José St Spartans": "San Jose St.",
    "San Jose State Spartans": "San Jose St.",
    "UTSA Roadrunners": "UT San Antonio",
    "UT-Arlington Mavericks": "UT Arlington",
    "UNC Asheville Bulldogs": "UNC Asheville",
    "UNC Greensboro Spartans": "UNC Greensboro",
    "UNC Wilmington Seahawks": "UNC Wilmington",
    "UMBC Retrievers": "UMBC",
    "VCU Rams": "VCU",
    "UCF Knights": "UCF",
    "SMU Mustangs": "SMU",
    "LSU Tigers": "LSU",
    "USC Trojans": "USC",
    "UCLA Bruins": "UCLA",
    "UNLV Rebels": "UNLV",
    "BYU Cougars": "BYU",
    "TCU Horned Frogs": "TCU",
    "GW Revolutionaries": "George Washington",
    "NC State Wolfpack": "N.C. State",
    "Pitt Panthers": "Pittsburgh",
    "UMass Minutemen": "Massachusetts",
    "Massachusetts Minutemen": "Massachusetts",
    "Sam Houston St Bearkats": "Sam Houston St.",
    "Stephen F. Austin Lumberjacks": "Stephen F. Austin",
    "Prairie View Panthers": "Prairie View A&M",
    "Florida Atlantic Owls": "Florida Atlantic",
    "Middle Tennessee Blue Raiders": "Middle Tennessee",
    "Western Kentucky Hilltoppers": "Western Kentucky",
    "Bowling Green Falcons": "Bowling Green",
    "Kent State Golden Flashes": "Kent St.",
    "Kennesaw St Owls": "Kennesaw St.",
    "Colorado St Rams": "Colorado St.",
    "Florida St Seminoles": "Florida St.",
    "Oklahoma St Cowboys": "Oklahoma St.",
    "Mississippi St Bulldogs": "Mississippi St.",
    "Iowa State Cyclones": "Iowa St.",
    "Texas Tech Red Raiders": "Texas Tech",
    "New Mexico St Aggies": "New Mexico St.",
    "Boise State Broncos": "Boise St.",
    "Fresno St Bulldogs": "Fresno St.",
    "Norfolk St Spartans": "Norfolk St.",
    "Delaware St Hornets": "Delaware St.",
    "Jackson St Tigers": "Jackson St.",
    "Morgan St Bears": "Morgan St.",
    "Missouri St Bears": "Missouri St.",
    "Boston Univ. Terriers": "Boston University",
    "Tarleton State Texans": "Tarleton St.",
    "Southern Utah Thunderbirds": "Southern Utah",
    "North Carolina Central Eagles": "N.C. Central",
    "Alabama A&M Bulldogs": "Alabama A&M",
    "Arkansas-Pine Bluff Golden Lions": "Arkansas Pine Bluff",
    "Florida A&M Rattlers": "Florida A&M",
    "South Carolina St Bulldogs": "South Carolina St.",
    "Maryland-Eastern Shore Hawks": "Maryland Eastern Shore",
    "Texas Southern Tigers": "Texas Southern",
    "Southern Jaguars": "Southern",
    "Abilene Christian Wildcats": "Abilene Christian",
    "Louisiana Tech Bulldogs": "Louisiana Tech",
    "McNeese Cowboys": "McNeese",
    "Cal Poly Mustangs": "Cal Poly",
    "UC Davis Aggies": "UC Davis",
    "UC San Diego Tritons": "UC San Diego",
    "UC Santa Barbara Gauchos": "UC Santa Barbara",
    "Air Force Falcons": "Air Force",
    "Lehigh Mountain Hawks": "Lehigh",
}

import json, os

_CUSTOM_PATH = os.path.join(os.path.dirname(__file__), "custom_aliases.json")
_cache = {}


def _load_custom() -> dict:
    if os.path.exists(_CUSTOM_PATH):
        try:
            return json.load(open(_CUSTOM_PATH))
        except Exception:
            pass
    return {}


def save_alias(odds_name: str, torvik_name: str):
    """Persist a manual mapping and clear the cache entry so it takes effect immediately."""
    custom = _load_custom()
    custom[odds_name] = torvik_name
    json.dump(custom, open(_CUSTOM_PATH, "w"), indent=2)
    _cache.pop(odds_name, None)


def match_team(odds_name: str, torvik_teams: dict) -> str | None:
    """
    Given an Odds API team name, find the matching BartTorvik team name.
    Returns the BartTorvik key or None if no match found.
    """
    if odds_name in _cache and _cache[odds_name] is not None:
        return _cache[odds_name]

    # 0. Custom (user-saved) aliases take priority
    custom = _load_custom()
    if odds_name in custom:
        key = custom[odds_name]
        if key in torvik_teams:
            _cache[odds_name] = key
            return key

    # 1. Direct alias lookup
    if odds_name in ALIASES:
        key = ALIASES[odds_name]
        if key in torvik_teams:
            _cache[odds_name] = key
            return key

    # 2. Strip mascot (last word) and try exact match
    parts = odds_name.rsplit(" ", 1)
    base = parts[0] if len(parts) > 1 else odds_name
    if base in torvik_teams:
        _cache[odds_name] = base
        return base

    # 3. Try removing "State" → "St." convention
    st_variant = base.replace(" State", " St.").replace(" St ", " St. ")
    if st_variant in torvik_teams:
        _cache[odds_name] = st_variant
        return st_variant

    # 4. Fuzzy: check if any torvik name starts with or contains the base
    base_lower = base.lower()
    for tname in torvik_teams:
        if tname.lower() == base_lower:
            _cache[odds_name] = tname
            return tname
        if tname.lower().startswith(base_lower) or base_lower.startswith(tname.lower()):
            _cache[odds_name] = tname
            return tname

    _cache[odds_name] = None
    return None
