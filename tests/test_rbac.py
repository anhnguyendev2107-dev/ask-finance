"""RBAC enforcement tests — the most important security-relevant checks."""
from __future__ import annotations

import pandas as pd
import pytest

from src.rbac import get_context
from src.data_loader import actuals_for, budget_for, projects_for


def test_cfo_sees_all_bus_and_regions():
    ctx = get_context("u001")   # Group CFO
    df = actuals_for(ctx)
    assert set(df["bu"].unique()) == {"Electronics", "Automotive", "Healthcare"}
    assert set(df["region"].unique()) == {"APAC", "EMEA", "Americas"}


def test_bu_gm_restricted_to_own_bu():
    ctx = get_context("u002")   # BU GM Electronics
    df = actuals_for(ctx)
    assert set(df["bu"].unique()) == {"Electronics"}


def test_regional_bp_restricted_to_own_region():
    ctx = get_context("u003")   # Regional BP APAC
    df = actuals_for(ctx)
    assert set(df["region"].unique()) == {"APAC"}


def test_bu_finance_bp_restricted_to_bu_and_region():
    ctx = get_context("u004")   # Automotive-Americas BP
    df = actuals_for(ctx)
    assert set(df["bu"].unique()) == {"Automotive"}
    assert set(df["region"].unique()) == {"Americas"}


def test_analyst_cannot_read_budget():
    ctx = get_context("u005")   # Analyst Healthcare-APAC
    with pytest.raises(PermissionError):
        budget_for(ctx)


def test_non_cfo_cannot_see_projects_outside_scope():
    ctx = get_context("u004")   # Automotive-Americas BP
    df = projects_for(ctx)
    # Orion is Electronics-APAC → must not appear
    assert "Project Orion" not in df["project_name"].tolist()


def test_bu_gm_electronics_sees_orion():
    ctx = get_context("u002")
    df = projects_for(ctx)
    assert "Project Orion" in df["project_name"].tolist()


def test_unknown_user_rejected():
    with pytest.raises(ValueError):
        get_context("does-not-exist")
