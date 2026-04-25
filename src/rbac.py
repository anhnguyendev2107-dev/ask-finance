"""Role-based access control for Ask Finance.

Every data access is mediated through `RBACContext`. A wildcard ("*") in a scope
field means "any value". Anything else is an exact match list.

Roles implemented (see data/users.json):

    Group CFO             → full access, all BUs + regions + projects
    BU General Manager    → single BU, all regions within that BU
    Regional Finance BP   → single region, all BUs within that region
    BU Finance BP         → single BU × single region
    Analyst               → single BU × single region, projects read-only

RBAC is defence-in-depth: the LLM can see the scope in the system prompt, but
enforcement happens in Python at the data layer, never in the model.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import pandas as pd

from .config import DATA_DIR


# Role → capability matrix. Keeping this explicit makes audits trivial.
ROLE_CAPABILITIES: dict[str, dict[str, bool]] = {
    "Group CFO":            {"read_actuals": True, "read_budget": True, "read_projects": True, "export": True},
    "BU General Manager":   {"read_actuals": True, "read_budget": True, "read_projects": True, "export": True},
    "Regional Finance BP":  {"read_actuals": True, "read_budget": True, "read_projects": True, "export": True},
    "BU Finance BP":        {"read_actuals": True, "read_budget": True, "read_projects": True, "export": True},
    "Analyst":              {"read_actuals": True, "read_budget": False, "read_projects": True, "export": False},
}


@dataclass
class RBACContext:
    user_id: str
    name: str
    email: str
    role: str
    bu_scope: str        # "*" or BU name
    region_scope: str    # "*" or region name
    capabilities: dict[str, bool] = field(default_factory=dict)

    # --- Capability checks ----------------------------------------------------
    def require(self, capability: str) -> None:
        if not self.capabilities.get(capability, False):
            raise PermissionError(
                f"Access denied: role '{self.role}' lacks capability '{capability}'."
            )

    def can(self, capability: str) -> bool:
        return self.capabilities.get(capability, False)

    # --- Scope filters --------------------------------------------------------
    def allowed_bus(self, all_bus: Iterable[str]) -> list[str]:
        return list(all_bus) if self.bu_scope == "*" else [self.bu_scope]

    def allowed_regions(self, all_regions: Iterable[str]) -> list[str]:
        return list(all_regions) if self.region_scope == "*" else [self.region_scope]

    def filter_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply scope filters to any dataframe with bu / region columns."""
        out = df
        if "bu" in out.columns and self.bu_scope != "*":
            out = out[out["bu"] == self.bu_scope]
        if "region" in out.columns and self.region_scope != "*":
            out = out[out["region"] == self.region_scope]
        return out.reset_index(drop=True)

    # --- Serialisation --------------------------------------------------------
    def scope_description(self) -> str:
        bu = "all BUs" if self.bu_scope == "*" else f"BU={self.bu_scope}"
        rg = "all regions" if self.region_scope == "*" else f"region={self.region_scope}"
        return f"{bu}, {rg}"

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id, "name": self.name, "email": self.email,
            "role": self.role, "bu_scope": self.bu_scope,
            "region_scope": self.region_scope, "capabilities": self.capabilities,
        }


def load_users(path: Path | None = None) -> list[dict]:
    path = path or (DATA_DIR / "users.json")
    return json.loads(Path(path).read_text())


def get_context(user_id: str) -> RBACContext:
    users = {u["user_id"]: u for u in load_users()}
    if user_id not in users:
        raise ValueError(f"Unknown user_id: {user_id}")
    u = users[user_id]
    role = u["role"]
    caps = ROLE_CAPABILITIES.get(role, {}).copy()
    return RBACContext(
        user_id=u["user_id"], name=u["name"], email=u["email"], role=role,
        bu_scope=u["bu_scope"], region_scope=u["region_scope"], capabilities=caps,
    )
