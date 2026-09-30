"""
Aurora — dependency-cascade alert analysis.

Ported from the legacy ai-service (legacy/ai-service/ai_service.py,
DEPENDENCY_GRAPH / BUILDING_NAMES / analyze_dependency_cascade) so the unified
backend keeps the cascade feature. Logic is unchanged: if an upstream building
is in warning/critical, its direct dependents (and second-order dependents)
are reported as at-risk.

NOTE: this is one of three dependency graphs in the repo (see PROJECT_CONTEXT.md
§14, P1-2: consolidate into a single source of truth).
"""

# Station topology (hardcoded, same for both stations).
DEPENDENCY_GRAPH = {
    "generator": {
        "dependents": ["heating", "heatingB", "waterTank", "commsMast", "livingQuarters"],
        "critical_sensors": ["gen_power", "gen_rpm"],
        "description": "Primary power source for all station systems",
    },
    "heating": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters"],
        "critical_sensors": ["heat_a_temp", "heat_a_flow"],
        "description": "Heating Zone A — feeds living quarters",
    },
    "heatingB": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters"],
        "critical_sensors": ["heat_b_temp"],
        "description": "Heating Zone B — backup heating circuit",
    },
    "waterTank": {
        "depends_on": ["generator"],
        "dependents": ["livingQuarters", "lab"],
        "critical_sensors": ["water_level"],
        "description": "Water treatment and storage",
    },
    "commsMast": {
        "depends_on": ["generator"],
        "dependents": [],
        "critical_sensors": ["comms_signal", "comms_uptime"],
        "description": "Satellite communications tower",
    },
    "livingQuarters": {
        "depends_on": ["heating", "heatingB", "waterTank", "generator"],
        "dependents": [],
        "critical_sensors": ["lq_temp", "lq_co2"],
        "description": "Crew living quarters — most occupied building",
    },
    "storage": {
        "depends_on": [],
        "dependents": [],
        "critical_sensors": ["store_fuel", "store_food"],
        "description": "Logistics and supply storage",
    },
    "lab": {
        "depends_on": ["waterTank", "generator"],
        "dependents": [],
        "critical_sensors": ["env_temp"],
        "description": "Research laboratory and weather station",
    },
}

BUILDING_NAMES = {
    "generator": "Generator Shed",
    "heating": "Heating Zone A",
    "heatingB": "Heating Zone B",
    "waterTank": "Water Treatment",
    "commsMast": "Comms Tower",
    "livingQuarters": "Living Quarters",
    "storage": "Logistics Store",
    "lab": "Research Lab",
}


def analyze_dependency_cascade(building_alerts: dict) -> list:
    """
    Given current building alert states ({buildingId: "normal"|"warning"|"critical"}),
    identify cascade risks. If an upstream system is degraded, warn about
    downstream impact (first- and second-order), deduplicated by
    (sourceBuilding, affectedBuilding).
    """
    cascades = []

    for building_id, alert_level in building_alerts.items():
        if alert_level in ("warning", "critical"):
            node = DEPENDENCY_GRAPH.get(building_id, {})
            dependents = node.get("dependents", [])

            for dep_id in dependents:
                dep_name = BUILDING_NAMES.get(dep_id, dep_id)
                source_name = BUILDING_NAMES.get(building_id, building_id)

                severity = "critical" if alert_level == "critical" else "warning"
                cascades.append({
                    "sourceBuilding": building_id,
                    "sourceName": source_name,
                    "affectedBuilding": dep_id,
                    "affectedName": dep_name,
                    "severity": severity,
                    "message": (
                        f"⚠️ {dep_name} at risk: depends on {source_name} "
                        f"which is in {alert_level.upper()} state"
                    ),
                    "chain": [building_id, dep_id],
                })

                # Second-order cascades (e.g., generator → heating → living quarters)
                dep_node = DEPENDENCY_GRAPH.get(dep_id, {})
                for second_dep_id in dep_node.get("dependents", []):
                    if second_dep_id != building_id:
                        second_name = BUILDING_NAMES.get(second_dep_id, second_dep_id)
                        cascades.append({
                            "sourceBuilding": building_id,
                            "sourceName": source_name,
                            "affectedBuilding": second_dep_id,
                            "affectedName": second_name,
                            "severity": "warning",
                            "message": (
                                f"⚡ Cascade risk: {source_name} → {dep_name} → {second_name}"
                            ),
                            "chain": [building_id, dep_id, second_dep_id],
                        })

    # Deduplicate by (source, affected) building
    seen = set()
    unique_cascades = []
    for c in cascades:
        key = (c["sourceBuilding"], c["affectedBuilding"])
        if key not in seen:
            seen.add(key)
            unique_cascades.append(c)

    return unique_cascades
