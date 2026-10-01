"""
Aurora — dependency-cascade alert analysis.

Originally ported from the legacy ai-service. The building graph and names now
come from station_config.json (single source of truth): if an upstream
building is in warning/critical, its direct dependents (and second-order
dependents) are reported as at-risk.
"""

import station_config


def analyze_dependency_cascade(building_alerts: dict, station_id: str) -> list:
    """
    Given current building alert states ({buildingId: "normal"|"warning"|"critical"}),
    identify cascade risks. If an upstream system is degraded, warn about
    downstream impact (first- and second-order), deduplicated by
    (sourceBuilding, affectedBuilding).
    """
    graph = station_config.dependency_graph(station_id)
    names = station_config.building_names(station_id)
    cascades = []

    for building_id, alert_level in building_alerts.items():
        if alert_level not in ("warning", "critical"):
            continue
        source_name = names.get(building_id, building_id)
        for dep_id in graph.get(building_id, {}).get("dependents", []):
            dep_name = names.get(dep_id, dep_id)
            cascades.append({
                "sourceBuilding": building_id,
                "sourceName": source_name,
                "affectedBuilding": dep_id,
                "affectedName": dep_name,
                "severity": "critical" if alert_level == "critical" else "warning",
                "message": (
                    f"⚠️ {dep_name} at risk: depends on {source_name} "
                    f"which is in {alert_level.upper()} state"
                ),
                "chain": [building_id, dep_id],
            })

            # Second-order cascades (e.g., generator → heating → living quarters)
            for second_dep_id in graph.get(dep_id, {}).get("dependents", []):
                if second_dep_id != building_id:
                    second_name = names.get(second_dep_id, second_dep_id)
                    cascades.append({
                        "sourceBuilding": building_id,
                        "sourceName": source_name,
                        "affectedBuilding": second_dep_id,
                        "affectedName": second_name,
                        "severity": "warning",
                        "message": f"⚡ Cascade risk: {source_name} → {dep_name} → {second_name}",
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
