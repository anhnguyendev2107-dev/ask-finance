"""Streamlit web app for Ask Finance.

Run:
    streamlit run src/app.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Support running `streamlit run src/app.py` from project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st

from src.agent import ask
from src.config import OUTPUT_DIR
from src.data_loader import data_catalog
from src.rbac import get_context, load_users


st.set_page_config(page_title="Ask Finance", page_icon="💰", layout="wide")
st.title("💰 Ask Finance")
st.caption("Your AI Finance Business Partner — powered by Claude + mock SAP/HFM data")

# --- Sidebar: user picker + scope summary -----------------------------------
with st.sidebar:
    st.header("👤 Sign in as")
    users = load_users()
    uid = st.selectbox(
        "User",
        [u["user_id"] for u in users],
        format_func=lambda x: f"{next(u['name'] for u in users if u['user_id']==x)} — "
                               f"{next(u['role'] for u in users if u['user_id']==x)}",
    )
    ctx = get_context(uid)
    cat = data_catalog(ctx)

    st.markdown(f"**{ctx.name}**")
    st.markdown(f"_{ctx.role}_")
    st.markdown(f"**Scope:** {ctx.scope_description()}")
    st.markdown("---")
    st.markdown("**Visible BUs:**")
    st.write(cat["actuals"]["business_units"] or "—")
    st.markdown("**Visible regions:**")
    st.write(cat["actuals"]["regions"] or "—")
    st.markdown("**Visible projects:**")
    st.write(cat["projects"]["projects"] or "—")
    st.markdown(f"**Budget access:** {'✅' if cat['budget_access'] else '❌'}")
    st.markdown("---")
    st.caption(
        "LLM provider: **Anthropic Claude**" if st.session_state.get("has_key")
        or __import__("os").getenv("ANTHROPIC_API_KEY")
        else "LLM provider: **mock** (set `ANTHROPIC_API_KEY` for live Claude)"
    )


# --- Main panel: chat history -----------------------------------------------
if "history" not in st.session_state:
    st.session_state.history = []
if "last_uid" not in st.session_state:
    st.session_state.last_uid = uid
# Reset history if user switches persona
if st.session_state.last_uid != uid:
    st.session_state.history = []
    st.session_state.last_uid = uid


# Example queries
st.markdown("#### Example queries")
cols = st.columns(3)
examples = [
    "What was our Opex variance for Q2 FY2024 in Electronics?",
    "Show me the ROI trend of Project Orion over the last 3 years.",
    "Summarize the FY2024 P&L highlights for my region.",
    "What's our EBIT margin trend for FY2023–FY2025?",
    "What is EBITDA?",
    "Compare Revenue for Electronics vs Automotive in FY2024",
]
for i, ex in enumerate(examples):
    if cols[i % 3].button(ex, key=f"ex{i}", use_container_width=True):
        st.session_state.pending_query = ex

# Render history
for msg in st.session_state.history:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg.get("trace"):
            with st.expander("🔍 Tool calls & raw data"):
                for tc in msg["trace"]["tool_calls"]:
                    st.markdown(f"**→ {tc['name']}**")
                    st.json({"input": tc["input"], "result": tc["result"]}, expanded=False)

# Input box
query = st.chat_input("Ask a finance question…")
if st.session_state.get("pending_query") and not query:
    query = st.session_state.pop("pending_query")

if query:
    st.session_state.history.append({"role": "user", "content": query})
    with st.chat_message("user"):
        st.markdown(query)
    with st.chat_message("assistant"):
        with st.spinner("Thinking…"):
            trace = ask(ctx, query)
        st.markdown(trace.final_text or "_(no response)_")
        if trace.error:
            st.warning(trace.error)
        with st.expander("🔍 Tool calls & raw data"):
            for tc in trace.tool_calls:
                st.markdown(f"**→ {tc['name']}**")
                st.json({"input": tc["input"], "result": tc["result"]}, expanded=False)
        # Surface any generated files
        for tc in trace.tool_calls:
            res = tc.get("result", {})
            if "generated_file" in res:
                fpath = Path(res["generated_file"])
                if fpath.suffix.lower() == ".png" and fpath.exists():
                    st.image(str(fpath))
                elif fpath.exists():
                    st.download_button(
                        f"📥 Download {fpath.name}",
                        data=fpath.read_bytes(),
                        file_name=fpath.name,
                    )
    st.session_state.history.append({
        "role": "assistant",
        "content": trace.final_text,
        "trace": trace.to_dict(),
    })
