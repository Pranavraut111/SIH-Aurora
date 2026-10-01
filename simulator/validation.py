"""
Aurora — shared request-validation types for the unified backend's POST bodies.

Pydantic rejects anything outside these constraints with HTTP 422; unknown
station / item / alert ids are rejected by the handlers with HTTP 404.
"""

from typing import Annotated

from pydantic import StringConstraints

# Operator / author names recorded in audit fields (who acknowledged, who edited…).
OPERATOR_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9 .,'()_\-]*$"
OperatorName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60,
                                                pattern=OPERATOR_NAME_PATTERN)]

# Station ids are validated against station_config by require_station(); this only bounds the string.
StationIdStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]

# Identifiers such as inventory item ids, scenario ids, command names.
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64,
                                              pattern=r"^[A-Za-z0-9_.\-]+$")]

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
